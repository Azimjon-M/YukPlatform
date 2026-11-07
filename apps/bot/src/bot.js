// Telegram bot (grammY): rol tanlash (haydovchi / yuk beruvchi), pastki menyu, sozlamalar (Mini App yoki chatda savol-javob),
// guruhdagi e'lonlarni navbatga qo'yish, haydovchilarga yuk va yuk beruvchilarga bo'sh mashina yuborish.
// Savol-javob mantig'i wizard.js da, pastki menyu menu.js da, xabar ko'rinishi format.js da,
// «📋 Mos yuklar» dagi «Qayerdan? → Qayerga?» route.js da.
// Telefon raqami — ixtiyoriy: profil saqlangach bir marta so'raladi (/raqam — keyin), /ochirish — ma'lumotlarni o'chirish.
import { existsSync } from "node:fs";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import {
  DEFAULT_DEDUPE_WINDOW_MS,
  KIND_MATCHERS,
  ROLES,
  ROLE_IDS,
  ROLE_KIND,
  formatContactPhone,
  isAdmin,
  isOwnContact,
  normalizeContactPhone,
  roleOf,
  routeChosen,
  sanitizeProfileFor,
  shouldAskPhone,
  validRole,
  withRoute,
} from "@yuk/shared";
import { escapeHtml, formatLoad, formatTruck } from "./format.js";
import { MENU, PHONE, mainMenu, matchesLabel, phoneKeyboard, settingsLabel } from "./menu.js";
import { applyRoute, chosenText, fromStep, toStep, validArea } from "./route.js";
import { applyAction, applyText, describeProfile, newDraft, profileFromDraft, renderStep } from "./wizard.js";

const LOADS_WINDOW_MS = 24 * 60 * 60 * 1000; // "📋 Mos yuklar" / "🚚 Bo'sh mashinalar" — oxirgi 24 soat
const LOADS_SHOWN = 5;
const LOADS_LIMIT = 5000; // 24 soatda ~4 000 yuk — hammasidan sanaladi (store standarti 500)

// Bot profilidagi matnlar (botni birinchi ochganda "Bu bot nima qila oladi?" o'rnida chiqadi)
const DESCRIPTION =
  "🚛 Yuk Ekspert — yuk beruvchidan yukni to'g'ridan-to'g'ri olib, haydovchilarga yetkazadi: vositachisiz.\n\n" +
  "Bundan tashqari, O'zbekistondagi katta yuk guruhlaridan haydovchiga mashinasi va yo'nalishiga mos yuklarni, " +
  "yuk beruvchiga esa yo'nalishidagi bo'sh mashinalarni saralab, shaxsiy xabarda yuboradi.\n\n" +
  "Boshlash uchun «Start» ni bosing.";
const SHORT_DESCRIPTION = "Yuk beruvchidan haydovchiga — to'g'ridan-to'g'ri. Katta yuk guruhlaridan mos yuklar va bo'sh mashinalar.";

const COMMANDS = [
  { command: "start", description: "Boshlash va menyu" },
  { command: "sozlamalar", description: "Sozlamalarni o'zgartirish" },
  { command: "rol", description: "Rolni almashtirish: haydovchi ↔ yuk beruvchi" },
  { command: "pauza", description: "Yuk yuborishni to'xtatib turish" },
  { command: "davom", description: "Yana yuborish" },
  { command: "raqam", description: "Telefon raqamni ulashish (ixtiyoriy)" },
  { command: "ilovalar", description: "Telefon ilovalari" },
  { command: "ochirish", description: "Ma'lumotlarimni o'chirish" },
  { command: "yordam", description: "Yordam" },
];

// Rolni almashtirishdan oldin (/rol, «🔄 Rolni almashtirish»)
const ROLE_SWITCH_NOTE = "Har rolning sozlamalari alohida saqlanadi — qaytib kelsangiz, qaytadan kiritish shart emas.";

// Nega raqam so'raymiz — so'rashda, /raqam da va /start dagi menyu tavsifida bir xil ma'no
// (raqam keyin ilovaga kirishda ham kerak bo'ladi — Azimjon, 2026-11-07)
const PHONE_WHY =
  "Ixtiyoriy. Raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz " +
  "saqlanib qoladi va joyidan davom etasiz — qaytadan ro'yxatdan o'tish shart emas. Raqamingiz hech kimga ko'rsatilmaydi va " +
  "e'lonlarga qo'shilmaydi. O'chirish — /ochirish";

// /ochirish: nimani saqlaymiz (inline tugmalar: del:phone | del:all | del:no)
function storedDataText(driver) {
  return [
    "🗂 <b>Siz haqingizda nimani saqlaymiz</b>",
    "• Telegram'dagi ismingiz va username",
    "• rolingiz va sozlamalaringiz (mashina, yo'nalish)",
    `• telefon raqamingiz — ${driver.phone ? escapeHtml(formatContactPhone(driver.phone)) : "ulashmagansiz"}`,
    "Sizga yuborilgan yuklar ro'yxati saqlanmaydi.",
    "",
    "Nimani o'chiramiz?",
  ].join("\n");
}

// /start matnining boshi (Azimjon, 2026-11-07): avval — yuk beruvchidan to'g'ridan-to'g'ri yuk (yuk berish qismi qo'shiladi),
// keyin — katta guruhlardagi e'lonlarni saralab yuborish (ROLE_TEXT[rol].groups)
const INTRO = "🚛 <b>Yuk Ekspert</b> — yuk beruvchidan yukni to'g'ridan-to'g'ri olib, haydovchilarga yetkazadi";

// Rolga qarab so'zlar: nima keladi, sozlamalarda nima so'raladi
const ROLE_TEXT = {
  haydovchi: {
    direct: "vositachisiz, yuk egasining o'zi bilan gaplashasiz.",
    groups: "Bundan tashqari, katta yuk guruhlaridagi minglab e'lonlarni saralab, faqat sizning mashinangiz va yo'nalishingizga mos yuklarni shaxsiy xabarda yuboramiz.",
    one: "yuk",
    many: "yuklar",
    matches: "qayerdan qayerga — tanlaysiz: oxirgi 24 soatdagi mos yuklar chiqadi, yangilari ham shu yo'nalishda keladi",
    settings: "transport va qayerda ishlashingiz",
    setup: "transportingizni",
  },
  yuk_beruvchi: {
    direct: "yukingiz vositachisiz, to'g'ridan-to'g'ri mos haydovchilarga boradi.",
    groups: "Bundan tashqari, katta yuk guruhlaridagi «mashina bo'sh» e'lonlarini saralab, yo'nalishingizdagi bo'sh mashinalarni shaxsiy xabarda yuboramiz.",
    one: "bo'sh mashina",
    many: "bo'sh mashinalar",
    matches: "oxirgi 24 soatdagi mos bo'sh mashinalar",
    settings: "yo'nalish va kerakli mashina",
    setup: "yo'nalishingizni va qanday mashina kerakligini",
  },
};

function helpText(driver) {
  const role = roleOf(driver);
  if (!role) {
    return [
      `${INTRO} — vositachisiz.`,
      "",
      "Bundan tashqari, katta yuk guruhlaridagi e'lonlarni saralab, shaxsiy xabarda yuboramiz:",
      `${ROLES.haydovchi.icon} haydovchiga — ${ROLES.haydovchi.gets};`,
      `${ROLES.yuk_beruvchi.icon} yuk beruvchiga — ${ROLES.yuk_beruvchi.gets}.`,
    ].join("\n");
  }
  const t = ROLE_TEXT[role];
  return [
    `${INTRO}: ${t.direct}`,
    "",
    t.groups,
    "",
    "<b>Pastdagi menyu:</b>",
    `${matchesLabel(driver)} — ${t.matches}`,
    `${settingsLabel(driver)} — ${t.settings}`,
    `${MENU.pause} / ${MENU.resume} — yuborishni to'xtatish va yoqish`,
    `${MENU.phone} — raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi va joyidan davom etasiz`,
    `${MENU.role} — haydovchi ↔ yuk beruvchi (yoki /rol)`,
    "",
    `Siz: ${ROLES[role].icon} ${ROLES[role].name}.`,
    "Menyuni yozish qatorining o'ng tomonidagi belgi ochib-yopadi, umuman yo'qolsa — /start",
    "Telefon ilovalari — /ilovalar, ma'lumotlarni o'chirish — /ochirish",
  ].join("\n");
}

const roleKeyboard = () => InlineKeyboard.from(ROLE_IDS.map((id) => [InlineKeyboard.text(ROLES[id].choice, `r:${id}`)]));

const toKeyboard = (rows) => InlineKeyboard.from(rows.map((row) => row.map((b) => InlineKeyboard.text(b.text, b.data))));

// Shaxsiy xabardagi yuk (haydovchiga) yoki bo'sh mashina (kind "mashina", yuk beruvchiga):
// tugmasiz, asl e'lon havolasi matn ichida
export function directText(load, post, kind = "yuk") {
  const { text, url } = kind === "mashina" ? formatTruck(load, post) : formatLoad(load, post);
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
// linkToken(chatId) — Mini App tugmasiga qo'shiladigan kirish tokeni (main.js: @yuk/store sessions.link; bir hafta bir xil)
export function createBot({ token, store, config, log = console.log, botInfo, appUrl = () => config.miniappUrl, linkToken = () => null }) {
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
  // Pastki menyu (Mini App manzili + shu odamning tokeni har safar yangidan — tunnel yoki hafta almashsa ham to'g'ri)
  const menu = (driver) => {
    const url = appUrl() ?? null;
    const token = driver?.chatId != null && url ? linkToken(driver.chatId) : null;
    return { reply_markup: mainMenu(driver, url, scope, { admin: isAdmin(driver, config.admins ?? []), token }) };
  };
  const html = (driver) => ({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...menu(driver) });

  function rememberUser(ctx) {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return store.saveDriver(ctx.chat.id, { name, username: from.username ?? null });
  }

  // Oxirgi 24 soatdagi mos e'lonlar: haydovchiga yuklar, yuk beruvchiga bo'sh mashinalar
  function matching(user) {
    const kind = ROLE_KIND[roleOf(user)];
    const matches = KIND_MATCHERS[kind];
    return store.recentLoads({ sinceMs: LOADS_WINDOW_MS, limit: LOADS_LIMIT, kind }).filter((row) => matches(row.load, user.profile).ok);
  }

  // Yangi xabar yoki o'sha xabarni o'zgartirish (tugma bosilganda). "message is not modified" — o'sha tugma ikki marta bosildi
  async function render(ctx, text, options, edit) {
    if (edit) {
      try {
        await ctx.editMessageText(text, options);
        return;
      } catch (error) {
        if (error instanceof GrammyError && /not modified/.test(error.description)) return;
      }
    }
    await ctx.reply(text, options);
  }

  // «📋 Mos yuklar» → «📍 Qayerdan yuk olasiz?» (route.js). Tugmalarda — har joydagi mos yuklar soni
  async function askRoute(ctx, driver, { edit = false } = {}) {
    const rows = store.recentLoads({ sinceMs: LOADS_WINDOW_MS, limit: LOADS_LIMIT, kind: "yuk" });
    const { text, keyboard } = fromStep({ profile: driver.profile, scope, rows });
    await render(ctx, text, { parse_mode: "HTML", reply_markup: toKeyboard(keyboard) }, edit);
  }

  // "Siz kimsiz?" — ikki tugma (r:haydovchi / r:yuk_beruvchi)
  async function askRole(ctx, driver = null) {
    const role = roleOf(driver);
    const text = role
      ? `Hozir siz: <b>${ROLES[role].icon} ${ROLES[role].name}</b>.\n${ROLE_SWITCH_NOTE}`
      : "Siz kimsiz? 👇";
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: roleKeyboard() });
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

  async function startWizard(ctx, profile = null, role = "haydovchi") {
    const draft = newDraft(profile, scope, role);
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  }

  // Sozlamalar: Mini App bo'lsa — pastki menyudagi tugma uni ochadi; bo'lmasa — chatda savol-javob
  async function openSettings(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return askRole(ctx);
    if (!appUrl()) return startWizard(ctx, driver.profile, role);
    await ctx.reply(`Pastdagi «${settingsLabel(driver)}» tugmasini bosing — forma ochiladi. To'ldirib, «Saqlash» ni bosasiz.`, menu(driver));
  }

  async function saved(ctx, profile, role) {
    // Mini App boshqa rol bilan saqladi (masalan, formada rolni almashtirib) — avval eski rolning sozlamalarini saqlab qo'yamiz
    if (store.getDriver(ctx.chat.id)?.role !== role) store.switchRole(ctx.chat.id, role);
    // Haydovchi formasida yo'nalish yo'q (u «📋 Mos yuklar» da tanlanadi) — eskisi qoladi
    if (role === "haydovchi") profile = withRoute(profile, store.getDriver(ctx.chat.id)?.profile);
    const driver = store.saveDriver(ctx.chat.id, { role, profile, draft: null, active: true });
    const t = ROLE_TEXT[role];
    // Yangi haydovchi: yo'nalish tanlanmaguncha yuk yuborilmaydi — darhol so'raymiz (raqam — yo'nalishdan keyin)
    if (role === "haydovchi" && !routeChosen(profile)) {
      await ctx.reply(`✅ Saqlandi.\n\n${describeProfile(profile, scope, role)}\n\nEndi qayerdan qayerga yuk kerakligini tanlang 👇`, menu(driver));
      await askRoute(ctx, driver);
      return;
    }
    const count = matching(driver).length;
    const extra = count ? `\n\nOxirgi 24 soatda sizga mos ${count} ta ${t.one} bor — «${matchesLabel(driver)}» ni bosing.` : "";
    await ctx.reply(`✅ Saqlandi. Endi mos ${t.many} shu yerga keladi.\n\n${describeProfile(profile, scope, role)}${extra}`, menu(driver));
    // Birinchi marta sozlagach — raqamni bir marta so'raymiz (ixtiyoriy)
    if (shouldAskPhone(driver)) await askPhone(ctx, driver);
  }

  // Raqam so'rash: bir martalik klaviatura «📱 Raqam ulashish» / «⏭ Keyinroq» (yoki raqami bo'lsa — «O'zgartirmaslik»).
  // Qachon so'ralgani yoziladi — bot o'zi boshqa so'ramaydi (faqat /raqam bilan foydalanuvchining o'zi).
  async function askPhone(ctx, driver) {
    store.saveDriver(ctx.chat.id, { phoneAskedAt: Date.now() });
    const text = driver.phone
      ? `📱 Sizning raqamingiz: <b>${escapeHtml(formatContactPhone(driver.phone))}</b>\nAlmashtirish uchun pastdagi «${PHONE.share}» tugmasini bosing.`
      : `📱 <b>Telefon raqamingizni ulashasizmi?</b>\n${PHONE_WHY}`;
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: phoneKeyboard(Boolean(driver.phone)) });
  }

  // Rol tanlandi. Har rolning sozlamalari alohida saqlanadi (store.switchRole): bu rolda avval to'ldirgan bo'lsa —
  // o'shalar tiklanadi, bo'lmasa — to'ldirishni so'raymiz (haydovchi profili yuk beruvchiga to'g'ri kelmaydi).
  async function chooseRole(ctx, role) {
    const before = rememberUser(ctx);
    const changed = roleOf(before) !== role;
    const driver = changed ? store.switchRole(ctx.chat.id, role) : before;
    if (!changed && driver.profile) {
      await ctx.reply(`Siz allaqachon ${ROLES[role].name.toLowerCase()}siz — hech narsa o'zgarmadi.`, menu(driver));
      return;
    }
    if (driver.profile) {
      const t = ROLE_TEXT[role];
      await ctx.reply(
        `${ROLES[role].icon} Siz: <b>${ROLES[role].name}</b>. Oldingi sozlamalaringiz tiklandi — mos ${t.many} yana shu yerga keladi.\n\n` +
          `${escapeHtml(describeProfile(driver.profile, scope, role))}\n\nO'zgartirish — «${settingsLabel(driver)}».`,
        html(driver),
      );
      return;
    }
    const next = appUrl() ? `\n\n👇 Endi «${settingsLabel(driver)}» tugmasini bosing — 1 daqiqalik forma.` : "";
    await ctx.reply(`${ROLES[role].icon} Siz: <b>${ROLES[role].name}</b>. Sizga ${ROLES[role].gets} keladi.${next}`, html(driver));
    if (!appUrl()) await startWizard(ctx, null, role);
  }

  async function setActive(ctx, active) {
    const driver = rememberUser(ctx);
    if (!driver.profile) return openSettings(ctx);
    const updated = store.saveDriver(ctx.chat.id, { active });
    await ctx.reply(active ? "▶️ Yuk yuborish yoqildi." : `⏸ Yuk yuborish to'xtatildi. Qayta yoqish: «${MENU.resume}»`, menu(updated));
  }

  // «📋 Mos yuklar» (haydovchi) yoki «🚚 Bo'sh mashinalar» (yuk beruvchi) — eski menyu tugmasi bosilsa ham hozirgi rol bo'yicha.
  // Haydovchidan avval yo'nalish so'raladi (route.js), yuk beruvchiga — darhol ro'yxat
  async function showMatches(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return askRole(ctx);
    const t = ROLE_TEXT[role];
    if (!driver.profile) {
      await ctx.reply(`Avval ${t.setup} kiriting: «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    if (role === "haydovchi") return askRoute(ctx, driver);
    await listMatches(ctx, driver);
  }

  // Oxirgi 24 soatdagi mos e'lonlar (eng yangi LOADS_SHOWN tasi)
  async function listMatches(ctx, driver) {
    const role = roleOf(driver);
    const t = ROLE_TEXT[role];
    const found = matching(driver);
    if (!found.length) {
      await ctx.reply(`Oxirgi 24 soatda sizga mos ${t.one} chiqmadi. Yangisi chiqishi bilan shu yerga yuboraman.`, menu(driver));
      return;
    }
    const kind = ROLE_KIND[role];
    const icon = role === "yuk_beruvchi" ? "🚚" : "📋";
    const more = found.length > LOADS_SHOWN ? `, eng yangi ${LOADS_SHOWN} tasi` : "";
    await ctx.reply(`${icon} Oxirgi 24 soatda sizga mos ${found.length} ta ${t.one}${more}:`, menu(driver));
    // Eskisidan yangisiga: eng yangisi chatda eng pastda turadi
    for (const row of found.slice(0, LOADS_SHOWN).reverse()) {
      await ctx.reply(directText(row.load, row.post, kind), html(driver));
    }
    if (driver.active === false) await ctx.reply(`⏸ Siz pauzadasiz: yangi ${t.many} o'zi kelmaydi. Yoqish: «${MENU.resume}»`, menu(driver));
  }

  let apkFileId = null; // bir marta yuklangach, Telegram fayl id'si bilan qayta yuboriladi
  async function showApps(ctx) {
    const driver = rememberUser(ctx);
    const link = (url, text) => `<a href="${escapeHtml(url)}">${text}</a>`;
    const lines = ["📱 <b>Yuk Ekspert ilovalari</b>", ""];
    lines.push(`🤖 Android: ${config.androidUrl ? link(config.androidUrl, "yuklab olish") : config.apkFile ? "o'rnatish fayli pastda 👇" : "tez orada"}`);
    lines.push(`🍏 iPhone: ${config.iosUrl ? link(config.iosUrl, "App Store") : "tez orada"}`);
    if (appUrl()) lines.push(`💬 Telegram ichida: pastdagi «${settingsLabel(driver)}» tugmasi ilovani ochadi`);
    if (config.channelLoads && config.channel?.startsWith("@")) lines.push(`📢 Hamma yangi yuklar kanalda: ${config.channel}`);
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
    const role = roleOf(driver);
    if (!role) {
      await ctx.reply(helpText(driver), html(driver));
      await askRole(ctx);
      return;
    }
    if (driver.profile) {
      await ctx.reply(`${helpText(driver)}\n\n<b>Sizning sozlamalaringiz:</b>\n${escapeHtml(describeProfile(driver.profile, scope, role))}`, html(driver));
      // Raqam so'rash paydo bo'lishidan oldin ro'yxatdan o'tganlar — bir marta shu yerda so'raladi
      if (shouldAskPhone(driver)) await askPhone(ctx, driver);
      return;
    }
    if (appUrl()) {
      await ctx.reply(`${helpText(driver)}\n\n👇 Boshlash uchun «${settingsLabel(driver)}» tugmasini bosing — 1 daqiqalik forma.`, html(driver));
      return;
    }
    await ctx.reply(helpText(driver), html(driver));
    await startWizard(ctx, null, role);
  });

  privateChat.command("sozlamalar", openSettings);
  privateChat.command("rol", (ctx) => askRole(ctx, rememberUser(ctx)));
  privateChat.command("pauza", (ctx) => setActive(ctx, false));
  privateChat.command("davom", (ctx) => setActive(ctx, true));
  const showHelp = (ctx) => {
    const driver = rememberUser(ctx);
    return ctx.reply(helpText(driver), html(driver));
  };
  privateChat.command("yordam", showHelp);
  privateChat.command("id", (ctx) => ctx.reply(`Sizning Telegram id: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" }));

  // --- Telefon raqami (ixtiyoriy) ---
  privateChat.command("raqam", (ctx) => askPhone(ctx, rememberUser(ctx)));
  // Eski menyudagi «📱 Raqamim» (2026-11-07 da bir necha daqiqa bor edi). Hozirgi «📱 Raqam ulashish» — kontakt (pastda)
  privateChat.hears(MENU.myPhone, (ctx) => askPhone(ctx, rememberUser(ctx)));

  // «📱 Raqam ulashish» bosildi (menyuda yoki /raqam da, yoki Mini App'dagi requestContact): Telegram kontakt yuboradi.
  // Faqat O'Z kontaktini saqlaymiz — ilova menyusidan birovning kontaktini ham yuborish mumkin.
  privateChat.on("message:contact", async (ctx) => {
    const driver = rememberUser(ctx);
    const { contact } = ctx.message;
    if (!isOwnContact(contact, ctx.from.id)) {
      await ctx.reply(`⚠️ Bu boshqa odamning kontakti — uni saqlamaymiz. O'z raqamingiz uchun pastdagi «${PHONE.share}» tugmasini bosing.`, {
        reply_markup: phoneKeyboard(Boolean(driver.phone)),
      });
      return;
    }
    const phone = normalizeContactPhone(contact.phone_number);
    if (!phone) {
      await ctx.reply("⚠️ Raqamni o'qib bo'lmadi. Keyinroq /raqam bilan qayta urinib ko'ring.", menu(driver));
      return;
    }
    const updated = store.saveDriver(ctx.chat.id, { phone, phoneAskedAt: driver.phoneAskedAt ?? Date.now() });
    await ctx.reply(`✅ Raqamingiz saqlandi: ${formatContactPhone(phone)}\nU hech kimga ko'rsatilmaydi. O'chirish — /ochirish`, menu(updated));
  });

  // «⏭ Keyinroq» / «↩️ O'zgartirmaslik» — asosiy menyu qaytadi, bot boshqa so'ramaydi
  privateChat.hears([PHONE.later, PHONE.keep], async (ctx) => {
    const driver = rememberUser(ctx);
    const text = driver.phone ? "Raqamingiz o'zgarmadi." : "Mayli. Xohlasangiz, keyin /raqam buyrug'i bilan ulashasiz.";
    await ctx.reply(text, menu(driver));
  });

  // /ochirish — nimani saqlashimizni ko'rsatadi va o'chirishni taklif qiladi
  privateChat.command("ochirish", async (ctx) => {
    const driver = rememberUser(ctx);
    const keyboard = new InlineKeyboard();
    if (driver.phone) keyboard.text("📱 Faqat raqamni o'chirish", "del:phone").row();
    keyboard.text("🗑 Hammasini o'chirish", "del:all").row().text("Bekor qilish", "del:no");
    await ctx.reply(storedDataText(driver), { parse_mode: "HTML", reply_markup: keyboard });
  });

  // Admin: .env dagi ADMIN_IDS yoki boshqaruv markazida «Admin» belgisi
  privateChat.command("holat", async (ctx) => {
    if (!isAdmin(store.getDriver(ctx.chat.id) ?? { chatId: ctx.from.id }, config.admins ?? [])) return;
    const s = store.stats();
    await ctx.reply(
      [
        `Haydovchilar: ${s.drivers.active} faol / ${s.drivers.total}`,
        `Yuk beruvchilar: ${s.shippers.active} faol / ${s.shippers.total}`,
        `E'lonlar: ${Object.entries(s.posts).map(([k, v]) => `${k} ${v}`).join(", ") || "yo'q"}`,
        `Oxirgi 24 soat: ${s.loads24h.total} yangi yuk (${s.loads24h.sent} ta yuborildi), ` +
          `${s.trucks24h.total} bo'sh mashina (${s.trucks24h.sent} ta yuborildi)`,
      ].join("\n"),
    );
  });

  // Pastki menyu tugmalari (savol-javob o'rtasida bosilsa ham ishlaydi, qoralama saqlanib qoladi)
  privateChat.hears([MENU.loads, MENU.trucks], showMatches);
  privateChat.hears([MENU.settings, MENU.register], openSettings);
  privateChat.hears(MENU.pause, (ctx) => setActive(ctx, false));
  privateChat.hears(MENU.resume, (ctx) => setActive(ctx, true));
  privateChat.hears(MENU.apps, showApps); // eski menyudagi tugma (endi menyuda raqam tugmasi)
  privateChat.command("ilovalar", showApps);
  privateChat.hears(MENU.role, (ctx) => askRole(ctx, rememberUser(ctx)));
  privateChat.hears(MENU.help, showHelp);

  // Mini App formasi "Saqlash" bosilganda: { type: "profile", role?, profile }. Ma'lumotga ishonmaymiz — tekshiramiz.
  // role bo'lmasa (eski forma) — bazadagi rol; forma boshqa rolni yuborsa — rol ham almashadi.
  privateChat.on("message:web_app_data", async (ctx) => {
    const driver = rememberUser(ctx);
    let data = null;
    try {
      data = JSON.parse(ctx.message.web_app_data.data);
    } catch {
      // buzilgan JSON — pastda xato deb javob beriladi
    }
    const role = validRole(data?.role) ?? roleOf(driver);
    const { profile, error } = data?.type === "profile" ? sanitizeProfileFor(role, data.profile, { scope }) : { error: "noma'lum ma'lumot keldi" };
    if (error) {
      await ctx.reply(`⚠️ Saqlanmadi: ${error}. Formani qaytadan oching.`, menu(driver));
      return;
    }
    await saved(ctx, profile, role);
  });

  // "Siz kimsiz?" tugmalari
  bot.callbackQuery(/^r:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const role = validRole(ctx.match[1]);
    if (!role || ctx.chat?.type !== "private") return;
    await ctx.editMessageText(`✅ ${ROLES[role].choice}`).catch(() => {});
    await chooseRole(ctx, role);
  });

  // /ochirish tugmalari
  bot.callbackQuery(/^del:(phone|all|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const what = ctx.match[1];
    if (what === "no") {
      await ctx.editMessageText("Hech narsa o'chirilmadi.").catch(() => {});
      return;
    }
    if (what === "phone") {
      // phoneAskedAt qoladi — bot boshqa o'zi so'ramaydi
      const updated = store.saveDriver(ctx.chat.id, { phone: null });
      await ctx.editMessageText("✅ Raqamingiz o'chirildi.").catch(() => {});
      await ctx.reply("Xohlasangiz, keyin yana ulashasiz — /raqam", menu(updated));
      return;
    }
    store.deleteDriver(ctx.chat.id);
    await ctx.editMessageText("✅ Hamma ma'lumotingiz o'chirildi. Endi sizga hech narsa yuborilmaydi.").catch(() => {});
    await ctx.reply("Qaytadan boshlash — /start", { reply_markup: { remove_keyboard: true } });
  });

  // «📋 Mos yuklar»: mr:f:<qayerdan> → «Qayerga?», mr:t:<qayerdan>:<qayerga> → saqlash va ro'yxat,
  // mr:last — oxirgi yo'nalish bilan ro'yxat, mr:back — «Qayerdan?» ga qaytish
  bot.callbackQuery(/^mr:(?:f:(.+)|t:([^:]+):(.+)|last|back)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const driver = store.getDriver(ctx.chat.id);
    if (roleOf(driver) !== "haydovchi" || !driver.profile) {
      await ctx.editMessageText("Bu tugma eskirgan.").catch(() => {});
      return showMatches(ctx);
    }
    const [, from, routeFrom, routeTo] = ctx.match;
    const data = ctx.callbackQuery.data;
    if (data === "mr:back") return askRoute(ctx, driver, { edit: true });
    if (data === "mr:last") {
      await ctx.editMessageText(chosenText(driver.profile), { parse_mode: "HTML" }).catch(() => {});
      return listMatches(ctx, driver);
    }
    if (from != null) {
      if (!validArea(driver.profile, scope, from)) return askRoute(ctx, driver, { edit: true });
      const rows = store.recentLoads({ sinceMs: LOADS_WINDOW_MS, limit: LOADS_LIMIT, kind: "yuk" });
      const { text, keyboard } = toStep({ profile: driver.profile, scope, rows, from });
      return render(ctx, text, { parse_mode: "HTML", reply_markup: toKeyboard(keyboard) }, true);
    }
    if (!validArea(driver.profile, scope, routeFrom) || !validArea(driver.profile, scope, routeTo)) return askRoute(ctx, driver, { edit: true });
    const updated = store.saveDriver(ctx.chat.id, { profile: applyRoute(driver.profile, routeFrom, routeTo) });
    await ctx.editMessageText(chosenText(updated.profile), { parse_mode: "HTML" }).catch(() => {});
    await listMatches(ctx, updated);
    // Birinchi marta sozlagach — raqamni bir marta so'raymiz (ixtiyoriy)
    if (shouldAskPhone(updated)) await askPhone(ctx, updated);
  });

  // Chatdagi savol-javob (Mini App bo'lmasa)
  bot.callbackQuery(/^w:(\w+):(.+)$/, async (ctx) => {
    const [, step, value] = ctx.match;
    const driver = store.getDriver(ctx.chat.id);
    await ctx.answerCallbackQuery();
    const role = roleOf(driver);
    if (!role) return askRole(ctx);
    if (!driver.draft) return startWizard(ctx, driver.profile, role);
    const { draft, saved: done } = applyAction(driver.draft, step, value);
    if (done) {
      await ctx.editMessageText("✅ Javoblar qabul qilindi.");
      await saved(ctx, profileFromDraft(draft), draft.role ?? role);
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
  // Kanalda pastki menyu bo'lmaydi, shuning uchun u yerda tugmalar xabar ostida.
  // Faqat CHANNEL_LOADS yoqilganda (standart o'chiq): yuklar haydovchilarga shaxsiy xabarda boradi.
  async function publish(load, post) {
    if (!config.channel || !config.channelLoads) return null;
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

  // kind — "yuk" (haydovchiga) yoki "mashina" (yuk beruvchiga)
  // Har bir yuk xabari pastki menyu bilan boradi (Azimjon, 2026-11-07: «bot ochilganida menyu ochiq bo'lsin»). Menyu
  // yig'iladigan (menu.js), Telegram esa yopilgan menyuni yangi menyuli xabar kelguncha yopiq saqlaydi — bot chat
  // ochilganini bilmaydi, shuning uchun yangi yuk kelganda menyu yana ochiq turadi. Manzil va token ham doim yangi.
  async function deliver(chatId, load, post, kind = "yuk") {
    const driver = store.getDriver(chatId);
    try {
      await bot.api.sendMessage(chatId, directText(load, post, kind), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(driver ? menu(driver) : {}),
      });
      return true;
    } catch (error) {
      // 403 — foydalanuvchi botni bloklagan yoki o'chirgan: unga boshqa yubormaymiz
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(chatId, { active: false });
      else log(`Foydalanuvchiga yuborilmadi (${chatId}): ${error.description ?? error.message}`);
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
