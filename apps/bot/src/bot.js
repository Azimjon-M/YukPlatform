// Telegram bot (grammY): haydovchini ro'yxatdan o'tkazish, pastki menyu, sozlamalar (Mini App yoki chatda savol-javob),
// guruhdagi e'lonlarni navbatga qo'yish, kanalga va haydovchilarga yuk yuborish.
// Savol-javob mantig'i wizard.js da, pastki menyu menu.js da, xabar ko'rinishi format.js da.
import { existsSync } from "node:fs";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import { DEFAULT_DEDUPE_WINDOW_MS, matchLoad, sanitizeProfile } from "@yuk/shared";
import { escapeHtml, formatLoad } from "./format.js";
import { MENU, mainMenu, settingsLabel } from "./menu.js";
import { applyAction, applyText, describeProfile, newDraft, profileFromDraft, renderStep } from "./wizard.js";

const LOADS_WINDOW_MS = 24 * 60 * 60 * 1000; // "📋 Mos yuklar" — oxirgi 24 soat
const LOADS_SHOWN = 5;

// Bot profilidagi matnlar (botni birinchi ochganda "Bu bot nima qila oladi?" o'rnida chiqadi)
const DESCRIPTION =
  "🚛 Yuk Ekspert — O'zbekistondagi katta yuk guruhlaridan faqat sizning mashinangiz va yo'nalishingizga mos yuklarni topib, " +
  "shaxsiy xabarda yuboradi.\n\nTelefon raqamini bosing — qo'ng'iroq qiling. Boshlash uchun «Start» ni bosing.";
const SHORT_DESCRIPTION = "Mashinangiz va yo'nalishingizga mos yuklarni katta yuk guruhlaridan topib yuboradi.";

const COMMANDS = [
  { command: "start", description: "Boshlash va menyu" },
  { command: "sozlamalar", description: "Mashina va yo'nalishni o'zgartirish" },
  { command: "pauza", description: "Yuk yuborishni to'xtatib turish" },
  { command: "davom", description: "Yana yuborish" },
  { command: "yordam", description: "Yordam" },
];

function helpText(driver) {
  return [
    "🚛 <b>Yuk Ekspert</b> — katta yuk guruhlaridagi e'lonlardan faqat sizning mashinangiz va yo'nalishingizga mos yuklarni shaxsiy xabarda yuboradi.",
    "",
    "Xabardagi telefon raqamini bossangiz — qo'ng'iroq qilasiz.",
    "",
    "<b>Pastdagi menyu:</b>",
    `${MENU.loads} — oxirgi 24 soatdagi mos yuklar`,
    `${settingsLabel(driver)} — mashina va yo'nalish`,
    `${MENU.pause} / ${MENU.resume} — yuk yuborishni to'xtatish va yoqish`,
    `${MENU.apps} — telefon ilovalari va kanal`,
    "",
    "Menyu yo'qolsa — /start",
  ].join("\n");
}

const toKeyboard = (rows) => InlineKeyboard.from(rows.map((row) => row.map((b) => InlineKeyboard.text(b.text, b.data))));

// Haydovchiga shaxsiy xabardagi yuk: tugmasiz, asl e'lon havolasi matn ichida
export function directText(load, post) {
  const { text, url } = formatLoad(load, post);
  return url ? `${text}\n<a href="${escapeHtml(url)}">📄 Asl e'lon</a>` : text;
}

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
// appUrl — Mini App manzili HOZIR: .env dagi MINIAPP_URL yoki ishlab turgan tunnel bergani (main.js). Tunnel qayta yoqilsa,
// manzil o'zgaradi — shuning uchun har safar shu funksiyadan so'raladi, ishga tushganda bir marta emas.
export function createBot({ token, store, config, log = console.log, botInfo, appUrl = () => config.miniappUrl }) {
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

  const scope = config.routeScope; // yo'nalish doirasi: sozlamalarda qaysi davlatlar tanlanadi
  // Har bir haydovchiga oxirgi marta qaysi Mini App manzili bilan menyu berilgan (xotirada; bot qayta yoqilsa — bo'sh)
  const shownUrl = new Map();
  const menu = (driver) => {
    const url = appUrl() ?? null;
    if (driver?.chatId != null) shownUrl.set(driver.chatId, url);
    return { reply_markup: mainMenu(driver, url, scope) };
  };
  const html = (driver) => ({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...menu(driver) });

  function rememberUser(ctx) {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return store.saveDriver(ctx.chat.id, { name, username: from.username ?? null });
  }

  function matchingLoads(profile) {
    return store.recentLoads({ sinceMs: LOADS_WINDOW_MS }).filter((row) => matchLoad(row.load, profile).ok);
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
    const draft = newDraft(profile, scope);
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  }

  // Sozlamalar: Mini App bo'lsa — pastki menyudagi tugma uni ochadi; bo'lmasa — chatda savol-javob
  async function openSettings(ctx) {
    const driver = rememberUser(ctx);
    if (!appUrl()) return startWizard(ctx, driver.profile);
    await ctx.reply(`Pastdagi «${settingsLabel(driver)}» tugmasini bosing — forma ochiladi. To'ldirib, «Saqlash» ni bosasiz.`, menu(driver));
  }

  async function saved(ctx, profile) {
    const driver = store.saveDriver(ctx.chat.id, { profile, draft: null, active: true });
    const count = matchingLoads(profile).length;
    const extra = count ? `\n\nOxirgi 24 soatda sizga mos ${count} ta yuk bor — «${MENU.loads}» ni bosing.` : "";
    await ctx.reply(`✅ Saqlandi. Endi mos yuklar shu yerga keladi.\n\n${describeProfile(profile, scope)}${extra}`, menu(driver));
  }

  async function setActive(ctx, active) {
    const driver = rememberUser(ctx);
    if (!driver.profile) return openSettings(ctx);
    const updated = store.saveDriver(ctx.chat.id, { active });
    await ctx.reply(active ? "▶️ Yuk yuborish yoqildi." : `⏸ Yuk yuborish to'xtatildi. Qayta yoqish: «${MENU.resume}»`, menu(updated));
  }

  async function showLoads(ctx) {
    const driver = rememberUser(ctx);
    if (!driver.profile) {
      await ctx.reply(`Avval mashinangiz va yo'nalishingizni kiriting: «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    const found = matchingLoads(driver.profile);
    if (!found.length) {
      await ctx.reply("Oxirgi 24 soatda sizga mos yuk chiqmadi. Yangisi chiqishi bilan shu yerga yuboraman.", menu(driver));
      return;
    }
    const more = found.length > LOADS_SHOWN ? `, eng yangi ${LOADS_SHOWN} tasi` : "";
    await ctx.reply(`📋 Oxirgi 24 soatda sizga mos ${found.length} ta yuk${more}:`, menu(driver));
    // Eskisidan yangisiga: eng yangi yuk chatda eng pastda turadi
    for (const row of found.slice(0, LOADS_SHOWN).reverse()) {
      await ctx.reply(directText(row.load, row.post), html(driver));
    }
    if (driver.active === false) await ctx.reply(`⏸ Siz pauzadasiz: yangi yuklar o'zi kelmaydi. Yoqish: «${MENU.resume}»`, menu(driver));
  }

  let apkFileId = null; // bir marta yuklangach, Telegram fayl id'si bilan qayta yuboriladi
  async function showApps(ctx) {
    const driver = rememberUser(ctx);
    const link = (url, text) => `<a href="${escapeHtml(url)}">${text}</a>`;
    const lines = ["📱 <b>Yuk Ekspert ilovalari</b>", ""];
    lines.push(`🤖 Android: ${config.androidUrl ? link(config.androidUrl, "yuklab olish") : config.apkFile ? "o'rnatish fayli pastda 👇" : "tez orada"}`);
    lines.push(`🍏 iPhone: ${config.iosUrl ? link(config.iosUrl, "App Store") : "tez orada"}`);
    if (appUrl()) lines.push(`💬 Telegram ichida: pastdagi «${settingsLabel(driver)}» tugmasi ilovani ochadi`);
    if (config.channel?.startsWith("@")) lines.push(`📢 Hamma yangi yuklar kanalda: ${config.channel}`);
    await ctx.reply(lines.join("\n"), html(driver));
    if (!config.apkFile) return;
    if (!apkFileId && !existsSync(config.apkFile)) {
      log(`APK fayl topilmadi: ${config.apkFile}`);
      return;
    }
    try {
      const caption = "🤖 Android uchun o'rnatish fayli. Telefon «noma'lum manbadan o'rnatish» ga ruxsat so'rasa — ruxsat bering.";
      const message = await ctx.replyWithDocument(apkFileId ?? new InputFile(config.apkFile), { caption });
      apkFileId ??= message.document?.file_id ?? null;
    } catch (error) {
      log(`APK yuborilmadi: ${error.description ?? error.message}`);
    }
  }

  const privateChat = bot.chatType("private");

  // /start (kanaldagi "🤖 Menga mos yuklar" havolasi ham shu yerga keladi: /start kanal)
  privateChat.command("start", async (ctx) => {
    const driver = rememberUser(ctx);
    if (driver.profile) {
      await ctx.reply(`${helpText(driver)}\n\n<b>Sizning sozlamalaringiz:</b>\n${escapeHtml(describeProfile(driver.profile, scope))}`, html(driver));
      return;
    }
    if (appUrl()) {
      await ctx.reply(`${helpText(driver)}\n\n👇 Boshlash uchun «${settingsLabel(driver)}» tugmasini bosing — 1 daqiqalik forma.`, html(driver));
      return;
    }
    await ctx.reply(helpText(driver), html(driver));
    await startWizard(ctx);
  });

  privateChat.command("sozlamalar", openSettings);
  privateChat.command("pauza", (ctx) => setActive(ctx, false));
  privateChat.command("davom", (ctx) => setActive(ctx, true));
  const showHelp = (ctx) => {
    const driver = rememberUser(ctx);
    return ctx.reply(helpText(driver), html(driver));
  };
  privateChat.command("yordam", showHelp);
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

  // Pastki menyu tugmalari (savol-javob o'rtasida bosilsa ham ishlaydi, qoralama saqlanib qoladi)
  privateChat.hears(MENU.loads, showLoads);
  privateChat.hears([MENU.settings, MENU.register], openSettings);
  privateChat.hears(MENU.pause, (ctx) => setActive(ctx, false));
  privateChat.hears(MENU.resume, (ctx) => setActive(ctx, true));
  privateChat.hears(MENU.apps, showApps);
  privateChat.hears(MENU.help, showHelp);

  // Mini App formasi "Saqlash" bosilganda: { type: "profile", profile }. Ma'lumotga ishonmaymiz — tekshiramiz.
  privateChat.on("message:web_app_data", async (ctx) => {
    const driver = rememberUser(ctx);
    let data = null;
    try {
      data = JSON.parse(ctx.message.web_app_data.data);
    } catch {
      // buzilgan JSON — pastda xato deb javob beriladi
    }
    const { profile, error } = data?.type === "profile" ? sanitizeProfile(data.profile, { scope }) : { error: "noma'lum ma'lumot keldi" };
    if (error) {
      await ctx.reply(`⚠️ Saqlanmadi: ${error}. Formani qaytadan oching.`, menu(driver));
      return;
    }
    await saved(ctx, profile);
  });

  // Chatdagi savol-javob (Mini App bo'lmasa)
  bot.callbackQuery(/^w:(\w+):(.+)$/, async (ctx) => {
    const [, step, value] = ctx.match;
    const driver = store.getDriver(ctx.chat.id);
    await ctx.answerCallbackQuery();
    if (!driver?.draft) return startWizard(ctx, driver?.profile);
    const { draft, saved: done } = applyAction(driver.draft, step, value);
    if (done) {
      await ctx.editMessageText("✅ Javoblar qabul qilindi.");
      await saved(ctx, profileFromDraft(draft));
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft, { edit: true });
  });

  privateChat.on("message:text", async (ctx) => {
    const driver = rememberUser(ctx);
    if (!driver.draft) {
      await ctx.reply("Pastdagi menyudan tanlang 👇", menu(driver));
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
  // Kanalda pastki menyu bo'lmaydi, shuning uchun u yerda tugmalar xabar ostida
  async function publish(load, post) {
    if (!config.channel) return null;
    const { text, url } = formatLoad(load, post);
    const keyboard = new InlineKeyboard();
    if (url) keyboard.url("📄 Asl e'lon", url);
    if (bot.botInfo) keyboard.url("🤖 Menga mos yuklar", `https://t.me/${bot.botInfo.username}?start=kanal`);
    try {
      const message = await bot.api.sendMessage(config.channel, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
      return message.message_id;
    } catch (error) {
      log(`Kanalga yuborilmadi: ${error.description ?? error.message}`);
      return null;
    }
  }

  // Yuk bilan birga pastki menyu ham yangilanadi — faqat Mini App manzili haydovchida turganidan farq qilsa
  // (tunnel qayta yoqildi yoki bot qayta ishga tushdi). Aks holda eski tugma o'chgan manzilni ochardi.
  function freshMenu(chatId) {
    if (shownUrl.has(chatId) && shownUrl.get(chatId) === (appUrl() ?? null)) return {};
    const driver = store.getDriver(chatId);
    return driver ? menu(driver) : {};
  }

  async function deliver(chatId, load, post) {
    try {
      await bot.api.sendMessage(chatId, directText(load, post), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...freshMenu(chatId) });
      return true;
    } catch (error) {
      // 403 — haydovchi botni bloklagan yoki o'chirgan: unga boshqa yubormaymiz
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(chatId, { active: false });
      else log(`Haydovchiga yuborilmadi (${chatId}): ${error.description ?? error.message}`);
      return false;
    }
  }

  // Bot profilidagi matn faqat o'zgargan bo'lsa yangilanadi (Telegram bu so'rovlarni cheklaydi)
  async function syncProfileTexts() {
    const current = await bot.api.getMyDescription().catch(() => null);
    if (current && current.description !== DESCRIPTION) await bot.api.setMyDescription(DESCRIPTION);
    const short = await bot.api.getMyShortDescription().catch(() => null);
    if (short && short.short_description !== SHORT_DESCRIPTION) await bot.api.setMyShortDescription(SHORT_DESCRIPTION);
  }

  async function init() {
    await bot.init();
    // Haydovchilar web'idagi «Telegram bilan kirish» tugmasi bot username'ini shu yerdan oladi (apps/api public.js)
    store.setSetting?.("bot_username", bot.botInfo.username);
    await bot.api.setMyCommands(COMMANDS);
    await syncProfileTexts().catch((error) => log(`Bot tavsifi yangilanmadi: ${error.description ?? error.message}`));
    if (config.channel?.startsWith("-100")) config.channelId = Number(config.channel);
    else if (config.channel) config.channelId = (await bot.api.getChat(config.channel).catch(() => null))?.id ?? null;
  }

  return { bot, init, publish, deliver };
}
