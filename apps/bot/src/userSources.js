// «➕ Guruh qo'shish» (Azimjon, 2026-11-10): foydalanuvchi o'zi biladigan ochiq yuk guruhi yoki kanalini qo'shadi —
// undagi e'lonlar ham saralanib, hammaga (o'ziga ham) filtrlari bo'yicha yuboriladi. Faqat raqamini ulashganlar uchun
// (ishonchlilik; menyuda «📱 Raqam ulashish» o'rnida turadi). Bosqichlar (@yuk/store userSources.js):
//   1) bot: havola to'g'rimi, ochiq guruh/kanalmi (Bot API getChat), limitlar → manba «probe» holatida, o'chiq;
//   2) collector (apps/collector probe.js): oxirgi 50 ta xabarni ko'radi — yuk e'loni yo'q / o'lik guruh darhol rad etiladi;
//   3) sinov: 24 soat ichida kamida 5 ta yuk e'loni (AI yoki qoidaviy parser yuk deb topgan) chiqsa — doimiy, aks holda
//      o'chiriladi. 5 tasi oldinroq chiqsa — o'sha zahoti o'tadi; ko'p xabar bo'lib, yuk e'loni juda kam bo'lsa — oldinroq
//      to'xtatiladi (AI kvotasi behuda ketmasin). Natija qo'shgan odamga shu yerdan yoziladi (createSourceWatcher).
import { GrammyError } from "grammy";
import { telegramUsername } from "@yuk/shared";
import { escapeHtml } from "./format.js";
import { MENU } from "./menu.js";

// «➕ Guruh qo'shish» nima — hamma joyda shu bitta jumla (Azimjon matni, 2026-11-10): /start va /yordam dagi menyu
// ro'yxati, raqam so'rash, «Guruh qo'shish» bosilgandagi xabar, raqamsiz bosganda
export const ADD_GROUP_ABOUT = "siz yuk guruhi yoki kanali qo'sha olasiz va ulardagi mos e'lonlar ham shu yerga keladi.";
export const ADD_GROUP_TEXT = `${MENU.addGroup} — ${ADD_GROUP_ABOUT}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SOURCE_RULES = {
  trialMs: DAY, // sinov muddati
  minLoads: 5, // sinovdan o'tish uchun kamida shuncha yuk e'loni
  graceMs: HOUR, // muddat tugaganda navbatda tahlil kutayotgan e'lonlari bo'lsa — ko'pi bilan shuncha kutiladi
  earlyAfter: 40, // shuncha xabari tahlil qilingach…
  earlyShare: 0.1, // …yuk e'loni shu ulushdan kam bo'lsa — muddatidan oldin to'xtatiladi
  checkingMax: 3, // bir odamda bir vaqtda tekshirilayotganlar
  perDay: 5, // bir odam 24 soatda
  allPerDay: 30, // hamma odamlar 24 soatda (collector guruh nomini aniqlashni Telegram qattiq cheklaydi)
  retryAfterMs: 7 * DAY, // rad etilgan guruhni qayta yuborish mumkin bo'lgan vaqt
};

// Havola: t.me/nomi, https://t.me/nomi/123, t.me/s/nomi (veb ko'rinish), telegram.me/nomi, @nomi.
// → { username } | { error: "private" (taklif havolasi t.me/+…, joinchat, t.me/c/…) | "bot" | "invalid" } | null (havola emas)
export const LINK_RE = /^\s*(?:@[A-Za-z][A-Za-z0-9_]{3,31}|(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/\S+)\s*$/i;

export function parseSourceLink(text) {
  const raw = String(text ?? "").trim();
  if (!LINK_RE.test(raw)) return null;
  if (raw.startsWith("@")) return checkName(raw.slice(1));
  const path = raw.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\//i, "");
  // Yopiq guruh (2026-11-13): xabar havolasi t.me/c/<id>/<raqam> — id ichida; taklif havolasi t.me/+hash yoki joinchat/hash
  // — qaysi guruh ekanini foydalanuvchi ulagan Telegram akkaunti aniqlaydi (collector). Qo'shiladi, agar shu akkaunt a'zo bo'lsa
  const internal = /^c\/(\d{5,})/i.exec(path);
  if (internal) return { peerId: `-100${internal[1]}` };
  const invite = /^(?:\+|joinchat\/)([\w-]{5,})/i.exec(path);
  if (invite) return { invite: invite[1] };
  if (/^(\+|joinchat\/|c\/)/i.test(path)) return { error: "invalid" };
  const parts = path.split(/[/?#]/);
  return checkName(parts[0].toLowerCase() === "s" ? parts[1] : parts[0]);
}

function checkName(name) {
  const username = telegramUsername(name);
  if (!username) return { error: "invalid" };
  if (/bot$/i.test(username)) return { error: "bot" };
  return { username };
}

const timeText = (time) => new Date(time).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
const dateText = (time) => new Date(time).toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit" });
// «11.11 14:30» — sinov tugash vaqti (u doim ertangi kun: sinov 24 soat)
const untilText = (time) => `${dateText(time)} ${timeText(time)}`;
export const sourceTitle = (source) => `<b>${escapeHtml(source.title ?? source.name)}</b>${source.title ? ` (${escapeHtml(source.name)})` : ""}`;

// «Siz qo'shgan guruhlar» ro'yxatidagi bitta qator. trial — sinovdagi sonlar (store.trialStats)
export function sourceLine(source, { trial = null, rules = SOURCE_RULES } = {}) {
  const title = sourceTitle(source);
  switch (source.checkState) {
    case "probe":
      return `🔎 ${title} — oxirgi xabarlari ko'rib chiqilyapti`;
    case "trial":
      return `🧪 ${title} — sinovda: ${trial?.loads ?? 0}/${rules.minLoads} yuk e'loni, ${untilText(source.checkUntil)} gacha`;
    case "ok":
      return source.enabled ? `✅ ${title} — qo'shilgan` : `⏸ ${title} — vaqtincha o'chirilgan`;
    case "failed":
      return `❌ ${title} — qo'shilmadi`;
    default:
      return `• ${title}`;
  }
}

// «➕ Guruh qo'shish» bosilganda: nima qilish kerak va shu odam qo'shganlari
export function intakeText(sources = [], { trialStats = () => null, rules = SOURCE_RULES } = {}) {
  const lines = [
    `<b>${MENU.addGroup}</b> — ${ADD_GROUP_ABOUT}`,
    "",
    "Yuk e'lonlari chiqadigan <b>ochiq</b> Telegram guruh yoki kanal havolasini shu yerga yuboring, masalan:",
    "https://t.me/guruh_nomi yoki @guruh_nomi",
    "",
    "🔒 <b>Yopiq guruh</b> ham qo'shiladi — agar unga a'zo Telegram akkauntingizni ulagan bo'lsangiz (/account_qosh): guruhning taklif havolasini (https://t.me/+…) yoki undagi istalgan xabar havolasini yuboring.",
    "",
    "<b>Qanday tekshiramiz:</b>",
    "1. Darhol — oxirgi 50 ta xabarini ko'ramiz: yuk e'lonlari bo'lmasa, qo'shilmaydi.",
    `2. Keyin ${Math.round(rules.trialMs / HOUR)} soat sinov: kamida ${rules.minLoads} ta yuk e'loni chiqsa — doimiy qo'shiladi, chiqmasa — o'chiriladi.`,
  ];
  if (sources.length) {
    lines.push("", "<b>Siz qo'shgan guruhlar:</b>");
    for (const source of sources) lines.push(sourceLine(source, { trial: source.checkState === "trial" ? trialStats(source) : null, rules }));
  }
  return lines.join("\n");
}

// Bir xil xabarlar (testlar ham ishlatadi)
export const INTAKE = {
  // Raqam ulashilgach bot o'zi guruh qo'shishga qaytadi (bot.js groupIntents); havola yuborgan bo'lsa — o'shani tekshiradi
  needPhone: (withLink = false) =>
    `${ADD_GROUP_TEXT}\n\nBu imkoniyat — raqamini ulashganlar uchun. Pastdagi «${MENU.phone}» tugmasini bosing — ` +
    (withLink ? "yuborgan havolangizni shundan keyin darhol tekshiramiz." : "keyin guruh havolasini yuborasiz."),
  private:
    "🔒 Bu yopiq guruh havolasi. Yopiq guruhni qo'shish uchun avval shu guruhga a'zo Telegram akkauntingizni ulang: /account_qosh — keyin havolani qayta yuboring.",
  notMember:
    "🔒 Ulangan Telegram akkauntingiz bu guruhga a'zo emas. Akkauntni guruhga qo'shing (yoki qo'shilganiga 30 daqiqa bo'lmagan bo'lsa — biroz kuting), keyin havolani qayta yuboring.",
  inviteInvalid: "Bu taklif havolasi yaroqsiz yoki muddati o'tgan. Guruhdan yangi havola oling yoki undagi biror xabar havolasini yuboring.",
  inviteQueued: "🔎 Havola qabul qilindi — ulangan akkauntingiz orqali qaysi guruh ekanini aniqlayapmiz, 1 daqiqada javob beramiz.",
  bot: "🤖 Bu botning manzili. Yuk e'lonlari chiqadigan guruh yoki kanal havolasini yuboring.",
  invalid: "Havola tushunarsiz. Masalan: https://t.me/guruh_nomi yoki @guruh_nomi",
  person: (name) => `👤 @${escapeHtml(name)} — guruh emas, odamning manzili. Guruh yoki kanal havolasini yuboring.`,
  notFound: (name) => `❓ @${escapeHtml(name)} topilmadi. Havolani tekshirib, qayta yuboring — faqat ochiq guruh yoki kanal qo'shiladi.`,
  ours: "Bu bizning o'z kanalimiz yoki guruhimiz 🙂 Boshqa yuk guruhini yuboring.",
  later: "⚠️ Hozir tekshirib bo'lmadi — birozdan so'ng havolani qayta yuboring.",
  checking: (n) => `⏳ Sizda ${n} ta guruh tekshirilyapti — natijasini kuting, keyin yana qo'shasiz.`,
  perDay: (n) => `Bugun ${n} ta guruh yubordingiz — ertaga yana qo'shishingiz mumkin.`,
  allPerDay: "Bugun juda ko'p guruh qo'shildi — ertaga qayta urinib ko'ring.",
  accepted: (source) => `🔎 ${sourceTitle(source)} qabul qilindi. Oxirgi xabarlarini ko'rib chiqyapmiz — 1–2 daqiqada javob beramiz.`,
};

// «kanal» / «guruh» — Telegram turi ma'lum bo'lsa; bilinmasa ikkalasi
const kindWord = (chatType) => (chatType === "channel" ? "kanal" : chatType === "group" ? "guruh" : "guruh/kanal");

// Yuborilgan havola bizda allaqachon bor manbaga teng bo'lsa (katta-kichik harf, t.me/@ farqi yo'q) — «avvaldan mavjud»
// bildirishnomasi (Azimjon, 2026-11-10) + hozirgi holati. chatId — yuborgan odam: o'zi qo'shgan bo'lsa, shuni aytamiz.
// null — qayta tekshirsa bo'ladi (bir hafta oldin rad etilgan).
export function existingText(source, { now, trial = null, rules = SOURCE_RULES, chatId = null }) {
  const title = sourceTitle(source);
  const what = kindWord(source.chatType);
  if (source.checkState === "failed") {
    const again = source.checkAt + rules.retryAfterMs;
    if (now >= again) return null;
    const why = source.checkNote ? `: ${escapeHtml(source.checkNote)}` : "";
    return [
      `ℹ️ Bu ${what} avval ham yuborilgan: ${title}.`,
      `❌ Yaqinda tekshirildi va qo'shilmadi${why}.`,
      `${dateText(again)} dan keyin qayta yuborishingiz mumkin.`,
    ].join("\n");
  }
  const mine = chatId != null && source.addedBy === chatId;
  const head = mine ? `ℹ️ Bu ${what}ni siz allaqachon yuborgansiz: ${title}.` : `ℹ️ Bu ${what} bizda avvaldan mavjud: ${title}.`;
  let state;
  if (source.checkState === "probe") {
    state = mine ? "🔎 Hozir tekshirilyapti — natijasini 1–2 daqiqada shu yerga yozamiz." : "🔎 Hozir tekshirilyapti.";
  } else if (source.checkState === "trial") {
    state = `🧪 Hozir sinovda: ${trial?.loads ?? 0}/${rules.minLoads} yuk e'loni, ${untilText(source.checkUntil)} gacha. Shu paytgacha undagi mos e'lonlar sizga ham keladi.`;
  } else if (!source.enabled) {
    state = "⏸ Hozir kuzatuvdan o'chirib qo'yilgan.";
  } else {
    state = "✅ Undagi mos e'lonlar sizga ham keladi — qayta qo'shish shart emas.";
  }
  return `${head}\n${state}`;
}

// «🔎 Auto scan» allaqachon qo'shgan guruhni foydalanuvchi o'zi yubordi (Azimjon, 2026-11-13: «"avval qo'shilgan" emas
// "qo'shildi" degan ma'noda»): u endi shu odamniki (store.claimScannedSource) — javob yangi qo'shilgandek
export function addedText(source, { trial = null, rules = SOURCE_RULES } = {}) {
  const title = sourceTitle(source);
  if (source.checkState === "trial") {
    return [
      `✅ ${title} qo'shildi!`,
      `🧪 Hozir sinovda: ${trial?.loads ?? 0}/${rules.minLoads} yuk e'loni, ${untilText(source.checkUntil)} gacha — kamida ${rules.minLoads} ta chiqsa, doimiy qo'shiladi.`,
      "Shu paytdan undagi mos e'lonlar sizga ham keladi.",
    ].join("\n");
  }
  if (!source.enabled) return `✅ ${title} qo'shildi.\n⏸ Hozir kuzatuvdan vaqtincha o'chirib qo'yilgan.`;
  return `✅ ${title} qo'shildi! Undagi mos e'lonlar sizga ham keladi.`;
}

// api — bot.api; ours — bizning kanal va guruhlar (@nomi, kichik harf bilan solishtiriladi)
export function createSourceIntake({ api, store, log = console.log, now = Date.now, ours = [], rules = SOURCE_RULES }) {
  const own = new Set(ours.filter(Boolean).map((name) => String(name).replace(/^@/, "").toLowerCase()));
  const trialOf = (source) => store.trialStats(source.name, source.checkAt);
  const existingOf = (source, chatId) =>
    existingText(source, { now: now(), trial: source.checkState === "trial" ? trialOf(source) : null, rules, chatId });

  // Boshqaruv markazidan qo'shilgan manbada nomi va turi (kanal/guruh) yo'q — bildirishnoma uchun Telegram'dan so'raymiz
  // (bitta Bot API so'rovi; bo'lmasa — «guruh/kanal» deb yozamiz)
  async function described(source) {
    if (source.chatType && source.title) return source;
    try {
      const chat = await api.getChat(source.name);
      if (chat.type === "private") return source;
      return { ...source, title: source.title ?? chat.title ?? null, chatType: source.chatType ?? (chat.type === "channel" ? "channel" : "group") };
    } catch {
      return source;
    }
  }

  // Bizda bor manba: «🔎 Auto scan» qo'shgani — endi shu odamniki, «qo'shildi»; aks holda «avvaldan mavjud» (yoki null —
  // qayta tekshirsa bo'ladi: rad etilganiga vaqt o'tgan / auto scan sinovidan o'tmagani)
  async function existingReply(existing, chatId) {
    if (existing.autoScan) {
      if (existing.checkState === "failed") return null;
      store.claimScannedSource(existing.name, chatId);
      log(`Foydalanuvchi ${chatId} Auto scan qo'shgan guruhni o'zi ham yubordi: ${existing.name} — endi uniki`);
      return addedText(await described(existing), { trial: existing.checkState === "trial" ? trialOf(existing) : null, rules });
    }
    const text = existingOf(existing, chatId);
    return text ? existingOf(await described(existing), chatId) : null;
  }

  function limitText(chatId) {
    const counts = store.userSourceCounts(chatId);
    if (counts.checking >= rules.checkingMax) return INTAKE.checking(counts.checking);
    if (counts.today >= rules.perDay) return INTAKE.perDay(counts.today);
    if (counts.all >= rules.allPerDay) return INTAKE.allPerDay;
    return null;
  }

  // → HTML matn (javob). link — parseSourceLink natijasi ({ username } | { peerId } | { invite }) yoki eski chaqiruvda nom
  async function submit(chatId, link) {
    const { username, peerId, invite } = typeof link === "string" ? { username: link } : link;
    if (peerId || invite) return submitPrivate(chatId, { peerId, invite });
    if (own.has(username.toLowerCase())) return INTAKE.ours;
    // Bizda bor manba — limitlardan oldin: u yangi guruh emas, hech narsa sarflamaydi
    const existing = store.findSource(username);
    if (existing) {
      const reply = await existingReply(existing, chatId);
      if (reply) return reply;
    }
    const limit = limitText(chatId);
    if (limit) return limit;

    let chat;
    try {
      chat = await api.getChat(`@${username}`);
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 400) return INTAKE.notFound(username);
      log(`Guruh tekshirilmadi (@${username}): ${error.description ?? error.message}`);
      return INTAKE.later;
    }
    if (chat.type === "private") return INTAKE.person(username);
    if (!chat.username) return INTAKE.private; // nomi bor-u, ochiq emas (bo'lmasligi kerak, lekin ehtiyot)
    if (own.has(chat.username.toLowerCase())) return INTAKE.ours;
    const members = await api.getChatMemberCount(chat.id).catch(() => null);
    const name = `@${chat.username}`;
    const source = { name, title: chat.title ?? null, members, chatType: chat.type === "channel" ? "channel" : "group" };
    if (!store.addUserSource({ ...source, chatId })) {
      // Shu orada boshqasi qo'shib ulgurdi
      const current = store.findSource(name);
      if (!current) return INTAKE.later;
      return existingOf({ ...current, title: source.title, chatType: source.chatType }, chatId) ?? INTAKE.later;
    }
    log(`Foydalanuvchi ${chatId} guruh qo'shdi: ${name} (${source.chatType}, ${members ?? "?"} a'zo) — tekshiruvga`);
    return INTAKE.accepted(source);
  }

  // Yopiq guruh (2026-11-13): faqat foydalanuvchi ulagan (ishlab turgan) Telegram akkaunti a'zo bo'lsa. Xabar havolasidagi
  // id — akkauntlarning guruhlar ro'yxatidan (store tg_dialogs) darhol; taklif havolasi — collector aniqlaydi (invite_checks),
  // javobni finishInvite yozadi
  const ownAccounts = (chatId) => (store.listTgAccounts?.() ?? []).filter((a) => a.addedBy === Number(chatId) && a.status === "ok").map((a) => a.name);
  async function submitPrivate(chatId, { peerId, invite }) {
    const accounts = ownAccounts(chatId);
    if (!accounts.length) return INTAKE.private;
    if (invite) {
      const limit = limitText(chatId);
      if (limit) return limit;
      store.addInviteCheck({ chatId, hash: invite, accounts });
      log(`Foydalanuvchi ${chatId} yopiq guruh taklif havolasini yubordi — akkaunti (${accounts.join(", ")}) tekshiradi`);
      return INTAKE.inviteQueued;
    }
    for (const account of accounts) {
      const dialog = store.tgDialogs({ account }).find((d) => d.peerId === peerId);
      if (dialog) {
        return addPrivate(chatId, { peerId, account, title: dialog.title || null, chatType: dialog.type === "kanal" ? "channel" : "group", members: dialog.members });
      }
    }
    return INTAKE.notMember;
  }

  async function addPrivate(chatId, { peerId, account, title, chatType, members }) {
    const existing = store.findSource(peerId);
    if (existing) {
      const reply = await existingReply({ ...existing, title: existing.title ?? title, chatType: existing.chatType ?? chatType }, chatId);
      if (reply) return reply;
    }
    const limit = limitText(chatId);
    if (limit) return limit;
    const source = { name: peerId, title, members, chatType, account };
    if (!store.addUserSource({ ...source, chatId })) return INTAKE.later;
    log(`Foydalanuvchi ${chatId} yopiq guruh qo'shdi: ${peerId} «${title ?? ""}» (akkaunt ${account}) — tekshiruvga`);
    return INTAKE.accepted(source);
  }

  // Collector taklif havolasini tekshirib bo'ldi → javob matni (createSourceWatcher yuboradi)
  async function finishInvite(check) {
    if (check.state === "found") return addPrivate(check.chatId, check);
    if (check.state === "not_member") return INTAKE.notMember;
    if (check.state === "invalid") return INTAKE.inviteInvalid;
    return INTAKE.later;
  }

  // «➕ Guruh qo'shish» xabari (shu odam qo'shganlari bilan)
  const intro = (chatId) => intakeText(store.userSourcesOf(chatId), { trialStats: trialOf, rules });

  return { submit, intro, finishInvite };
}

// Sinov natijasi (sof funksiya). stats — store.trialStats; until — sinov tugash vaqti.
// → { done: false } (hali davom etadi) | { done: true, ok, note }
// Aloqasiz e'lonlar (telefon ham, lichka ham yo'q — bot ularni hech kimga yubormaydi) yuk e'loni deb sanalmaydi;
// ular bo'lsa, izohda aytiladi — qo'shgan odam nega o'tmaganini tushunsin
export function reviewTrial(stats, { until, now, rules = SOURCE_RULES }) {
  if (stats.loads >= rules.minLoads) return { done: true, ok: true, note: `Sinov paytida ${stats.loads} ta yuk e'loni chiqdi` };
  const noContact = stats.noContact ? `; ${stats.noContact} ta e'lonida telefon raqami ham, lichkasi ham yo'q edi — bunday e'lonlar hech kimga yuborilmaydi` : "";
  if (stats.processed >= rules.earlyAfter && stats.loads < stats.processed * rules.earlyShare) {
    return {
      done: true,
      ok: false,
      note: `${stats.processed} ta xabaridan atigi ${stats.loads} tasi yuk e'loni — sinov muddatidan oldin to'xtatildi${noContact}`,
    };
  }
  if (now < until) return { done: false };
  // Muddat tugadi, lekin ba'zi e'lonlari hali tahlil navbatida — ko'pi bilan graceMs kutamiz
  if (stats.waiting > 0 && now < until + rules.graceMs) return { done: false };
  const hours = Math.round(rules.trialMs / HOUR);
  const count = stats.loads ? `atigi ${stats.loads} ta yuk e'loni chiqdi` : "birorta ham yuk e'loni chiqmadi";
  let note = `${hours} soatda ${count} (kamida ${rules.minLoads} ta kerak)${noContact}`;
  if (stats.repeats) note += `; yana ${stats.repeats} tasi boshqa guruhlarimizda allaqachon bor edi — ular sizga baribir keladi`;
  return { done: true, ok: false, note };
}

// Qo'shgan odamga yoziladigan natija
export function resultText(source) {
  const title = sourceTitle(source);
  const note = source.checkNote ? escapeHtml(source.checkNote) : "";
  const fromTrial = Boolean(source.checkStats?.trial);
  switch (source.checkState) {
    case "trial":
      return [
        `🧪 ${title} sinovga olindi${note ? `: ${lowerFirst(note)}` : ""}.`,
        "Shu paytdan undagi mos e'lonlar ham sizga keladi.",
        `Ertaga ${timeText(source.checkUntil)} gacha (24 soat) kamida ${SOURCE_RULES.minLoads} ta yuk e'loni chiqsa — doimiy qo'shiladi.`,
      ].join("\n");
    case "ok":
      return `✅ ${title} doimiy qo'shildi${note ? `: ${lowerFirst(note)}` : ""}. Rahmat!`;
    case "failed":
      return fromTrial
        ? `⏸ ${title} o'chirildi: ${lowerFirst(note)}.`
        : `❌ ${title} qo'shilmadi${note ? `: ${lowerFirst(note)}` : ""}.\nFaqat yuk e'lonlari chiqadigan ochiq guruh yoki kanal qo'shiladi.`;
    default:
      return null;
  }
}

// «Oxirgi 50 ta…» → «oxirgi 50 ta…» (gap o'rtasida); «24 soatda…» o'zgarmaydi
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);

// Har everyMs da: (1) qo'shgan odamga hali aytilmagan natijalar; (2) har reviewMs da sinovdagi manbalar hisobi.
// send(chatId, html) — bot.js (pastki menyu bilan). Telegram rad etsa (403 bloklagan, 400) ham «aytildi» deb yoziladi —
// qayta-qayta urinmaymiz; tarmoq xatosi — keyingi safar
// onInvite(check) → matn: yopiq guruh taklif havolasi tekshirildi (createSourceIntake finishInvite)
export function createSourceWatcher({ store, send, onInvite = null, log = console.log, now = Date.now, everyMs = 10_000, reviewMs = MINUTE, rules = SOURCE_RULES }) {
  let timer = null;
  let busy = false;
  let reviewedAt = -Infinity;

  function review() {
    reviewedAt = now();
    for (const source of store.trialSources()) {
      const stats = store.trialStats(source.name, source.checkAt);
      const verdict = reviewTrial(stats, { until: source.checkUntil, now: now(), rules });
      if (!verdict.done) continue;
      store.finishTrial(source.name, { ok: verdict.ok, note: verdict.note, stats });
      log(`${source.name}: foydalanuvchi qo'shgan guruh sinovdan ${verdict.ok ? "o'tdi" : "o'tmadi, o'chirildi"} — ${verdict.note}`);
    }
  }

  async function invites() {
    if (!onInvite || !store.inviteResults) return;
    for (const check of store.inviteResults()) {
      try {
        await send(check.chatId, await onInvite(check));
      } catch (error) {
        if (!(error instanceof GrammyError)) {
          log(`Yopiq guruh natijasi yuborilmadi (${check.chatId}): ${error.message}`);
          return; // tarmoq — keyingi safar
        }
      }
      store.markInviteReported(check.id);
    }
  }

  async function notify() {
    for (const source of store.sourceNotices()) {
      const text = resultText(source);
      if (text) {
        try {
          await send(source.addedBy, text);
        } catch (error) {
          if (!(error instanceof GrammyError)) {
            log(`Guruh natijasi yuborilmadi (${source.addedBy}): ${error.message}`);
            return; // tarmoq — keyingi safar
          }
        }
      }
      store.markSourceNotified(source.name, source.checkState);
    }
  }

  async function runOnce() {
    if (busy) return;
    busy = true;
    try {
      if (now() - reviewedAt >= reviewMs) review();
      await invites();
      await notify();
    } catch (error) {
      log(`Foydalanuvchi guruhlari tekshirilmadi: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  return {
    runOnce,
    start() {
      timer ??= setInterval(runOnce, everyMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
