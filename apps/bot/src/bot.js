// Telegram bot (grammY): haydovchini ro'yxatdan o'tkazish, sozlamalar, guruhdagi e'lonlarni navbatga qo'yish,
// kanalga va haydovchilarga yuk yuborish. Savol-javob mantig'i wizard.js da, xabar ko'rinishi format.js da.
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, InlineKeyboard } from "grammy";
import { DEFAULT_DEDUPE_WINDOW_MS } from "@yuk/shared";
import { formatLoad } from "./format.js";
import { applyAction, applyText, describeProfile, newDraft, profileFromDraft, renderStep } from "./wizard.js";

const HELP = [
  "🚛 <b>Yuk Ekspert</b> — katta yuk guruhlaridagi e'lonlardan faqat sizning mashinangiz va yo'nalishingizga mos yuklarni shaxsiy xabarda yuboradi.",
  "",
  "Xabardagi telefon raqamini bossangiz — qo'ng'iroq qilasiz.",
  "",
  "/sozlamalar — mashina va yo'nalishni o'zgartirish",
  "/pauza — yuk yuborishni to'xtatib turish",
  "/davom — yana yuborish",
  "/yordam — shu xabar",
].join("\n");

const COMMANDS = [
  { command: "start", description: "Boshlash" },
  { command: "sozlamalar", description: "Mashina va yo'nalishni o'zgartirish" },
  { command: "pauza", description: "Yuk yuborishni to'xtatib turish" },
  { command: "davom", description: "Yana yuborish" },
  { command: "yordam", description: "Yordam" },
];

const toKeyboard = (rows) => InlineKeyboard.from(rows.map((row) => row.map((b) => InlineKeyboard.text(b.text, b.data))));

// Guruh yoki kanal xabaridan navbat uchun e'lon
export function postFromMessage(chat, message) {
  const text = message.text ?? message.caption;
  if (!text || text.trim().length < 20) return null;
  const source = chat.username ? `@${chat.username}` : String(chat.id);
  const link = chat.username
    ? `https://t.me/${chat.username}/${message.message_id}`
    : String(chat.id).startsWith("-100")
      ? `https://t.me/c/${String(chat.id).slice(4)}/${message.message_id}`
      : null;
  return { source, messageId: message.message_id, link, text: text.trim(), postedAt: message.date * 1000 };
}

// botInfo — testda Telegram'ga ulanmasdan ishlatish uchun (odatda init() o'zi oladi)
export function createBot({ token, store, config, log = console.log, botInfo }) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  // Telegram "juda tez" (429) desa, aytilgan vaqtcha kutib qayta yuboradi
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const isChannel = (chat) =>
    config.channel && (chat.id === config.channelId || (chat.username && `@${chat.username}`.toLowerCase() === config.channel.toLowerCase()));
  const isOwnEcho = (message) =>
    message.is_automatic_forward ||
    (message.sender_chat && isChannel(message.sender_chat)) ||
    (bot.botInfo && message.from?.id === bot.botInfo.id) ||
    message.via_bot?.id === bot.botInfo?.id;

  function rememberUser(ctx) {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return store.saveDriver(ctx.chat.id, { name, username: from.username ?? null });
  }

  async function showStep(ctx, draft, { edit = false } = {}) {
    const { text, keyboard } = renderStep(draft);
    const options = { reply_markup: toKeyboard(keyboard) };
    if (edit) {
      try {
        await ctx.editMessageText(text, options);
        return;
      } catch (error) {
        // "message is not modified" — o'sha tugma ikki marta bosildi, hech narsa qilmaymiz
        if (error instanceof GrammyError && /not modified/.test(error.description)) return;
      }
    }
    await ctx.reply(text, options);
  }

  async function startWizard(ctx, profile = null) {
    const draft = newDraft(profile);
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  }

  const privateChat = bot.chatType("private");

  privateChat.command("start", async (ctx) => {
    const driver = rememberUser(ctx);
    if (driver.profile) {
      await ctx.reply(`${HELP}\n\n<b>Sizning sozlamalaringiz:</b>\n${describeProfile(driver.profile)}`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(HELP, { parse_mode: "HTML" });
    await startWizard(ctx);
  });

  privateChat.command("sozlamalar", async (ctx) => {
    const driver = rememberUser(ctx);
    await startWizard(ctx, driver.profile);
  });

  privateChat.command("pauza", async (ctx) => {
    store.saveDriver(ctx.chat.id, { active: false });
    await ctx.reply("⏸ Yuk yuborish to'xtatildi. Qayta yoqish: /davom");
  });

  privateChat.command("davom", async (ctx) => {
    const driver = rememberUser(ctx);
    if (!driver.profile) return startWizard(ctx);
    store.saveDriver(ctx.chat.id, { active: true });
    await ctx.reply("▶️ Yuk yuborish yoqildi.");
  });

  privateChat.command("yordam", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
  privateChat.command("id", (ctx) => ctx.reply(`Sizning Telegram id: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" }));

  privateChat.command("holat", async (ctx) => {
    if (!config.admins.includes(ctx.from.id)) return;
    const s = store.stats();
    await ctx.reply(
      [
        `Haydovchilar: ${s.drivers.active} faol / ${s.drivers.total}`,
        `E'lonlar: ${Object.entries(s.posts).map(([k, v]) => `${k} ${v}`).join(", ") || "yo'q"}`,
        `Oxirgi 24 soat: ${s.loads24h.total} yangi yuk, ${s.loads24h.sent} ta yuborildi`,
      ].join("\n"),
    );
  });

  bot.callbackQuery(/^w:(\w+):(.+)$/, async (ctx) => {
    const [, step, value] = ctx.match;
    const driver = store.getDriver(ctx.chat.id);
    await ctx.answerCallbackQuery();
    if (!driver?.draft) return startWizard(ctx, driver?.profile);
    const { draft, saved } = applyAction(driver.draft, step, value);
    if (saved) {
      const profile = profileFromDraft(draft);
      store.saveDriver(ctx.chat.id, { profile, draft: null, active: true });
      await ctx.editMessageText(`✅ Saqlandi. Endi mos yuklar shu yerga keladi.\n\n${describeProfile(profile)}\n\nO'zgartirish: /sozlamalar`);
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft, { edit: true });
  });

  privateChat.on("message:text", async (ctx) => {
    const driver = rememberUser(ctx);
    if (!driver.draft) {
      await ctx.reply(driver.profile ? "Buyruqlar: /sozlamalar, /pauza, /davom, /yordam" : "Boshlash uchun /start bosing.");
      return;
    }
    const { draft, error } = applyText(driver.draft, ctx.message.text);
    if (error) {
      await ctx.reply(error);
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  });

  // Bot admin bo'lgan guruh va kanallardagi e'lonlar navbatga tushadi (o'z kanalimizdan tashqari).
  // Guruhda hamma xabarni ko'rish uchun bot admin bo'lishi yoki BotFather'da privacy mode o'chirilgan bo'lishi kerak.
  bot.on(["message", "channel_post"], (ctx, next) => {
    const chat = ctx.chat;
    if (chat.type === "private") return next();
    if (isChannel(chat)) return;
    // Kanalga ulangan muhokama guruhiga kanal postlari avtomatik nusxalanadi — ular bizning o'z yuklarimiz
    if (isOwnEcho(ctx.msg)) return;
    const post = postFromMessage(chat, ctx.msg);
    if (!post) return;
    const added = store.addPost(post, { dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS });
    if (added) log(`navbatga: ${post.source} #${post.messageId} (${added.status})`);
  });

  bot.catch((error) => log(`Bot xatosi: ${error.error?.message ?? error.message}`));

  // --- Yuborish (pipeline shularni chaqiradi) ---
  function sendOptions(url) {
    const keyboard = new InlineKeyboard();
    if (url) keyboard.url("📄 Asl e'lon", url);
    if (bot.botInfo) keyboard.url("🤖 Menga mos yuklar", `https://t.me/${bot.botInfo.username}?start=kanal`);
    return { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard };
  }

  async function publish(load, post) {
    if (!config.channel) return null;
    const { text, url } = formatLoad(load, post);
    try {
      const message = await bot.api.sendMessage(config.channel, text, sendOptions(url));
      return message.message_id;
    } catch (error) {
      log(`Kanalga yuborilmadi: ${error.description ?? error.message}`);
      return null;
    }
  }

  async function deliver(chatId, load, post) {
    const { text, url } = formatLoad(load, post);
    const options = sendOptions(url);
    try {
      await bot.api.sendMessage(chatId, text, { ...options, reply_markup: url ? new InlineKeyboard().url("📄 Asl e'lon", url) : undefined });
      return true;
    } catch (error) {
      // 403 — haydovchi botni bloklagan yoki o'chirgan: unga boshqa yubormaymiz
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(chatId, { active: false });
      else log(`Haydovchiga yuborilmadi (${chatId}): ${error.description ?? error.message}`);
      return false;
    }
  }

  async function init() {
    await bot.init();
    await bot.api.setMyCommands(COMMANDS);
    if (config.channel?.startsWith("-100")) config.channelId = Number(config.channel);
    else if (config.channel) config.channelId = (await bot.api.getChat(config.channel).catch(() => null))?.id ?? null;
  }

  return { bot, init, publish, deliver };
}
