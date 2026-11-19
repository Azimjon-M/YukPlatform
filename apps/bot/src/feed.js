// Haydovchining yetkazish rejimi botda (qoidalari — @yuk/shared feed.js; Azimjon, 2026-11-14: «yukni kim birinchi olsa,
// yuk o'shaniki»). Bu yerda faqat xabar matni va inline tugmalar — sof funksiyalar (testda Telegram kerak emas):
//   modeStep  — «🎛 Qaysi e'lonlar kelsin?»: filtrlar (transport, qayerdan, guruhlar) va «✅ Tayyor»; regionStep, truckStep
//   groupStep — «📌 Qaysi guruhlardan?»: ro'yxat sahifalab, bosilsa ✅ qo'yiladi/olinadi (fg:t:<nomi>), fg:p:<sahifa>,
//               «✅ Tayyor» (fg:ok), «⬅️ Orqaga» (fg:back)
// Tugmalar { text, data } ko'rinishida (route.js dagidek) — bot.js toKeyboard ularni InlineKeyboard ga aylantiradi.
import { FEED_MODES, FEED_SOURCES_MAX, REGIONS, TRUCK_FILTERS, choiceMode, feedOf, regionTitle, regionsText, sourceKey, trucksText } from "@yuk/shared";

// fm:<rejim> — rejim (tezkor — hamma guruhlar, guruhlarim — ro'yxat ochiladi, hududim — eski tugma: viloyatlar ro'yxati),
// fm:done — oynani yopish
export const FEED_CALLBACK = /^fm:(\w+)$/;
export const GROUP_CALLBACK = /^fg:(?:t:(.+)|p:(\d+)|k:(open|closed)|ok|back)$/;
// «📍 Qaysi viloyatlardan?» (2026-11-19): fr:t:<viloyat> — belgilash, fr:ok — saqlash, fr:back — rejimlarga
export const REGION_CALLBACK = /^fr:(?:t:([a-z_]+)|ok|back|all)$/;
// «🚚 Qaysi transport?» (2026-11-19): ft:open — ro'yxat, ft:t:<tur> — belgilash, ft:ok — saqlash, ft:all — hammasi, ft:back
export const TRUCK_CALLBACK = /^ft:(?:t:([a-z_]+)|ok|back|all|open)$/;

// Pro bo'lmagan haydovchi yopiq guruhni bossa (Pro — boshqaruv markazidan yoki avtomatik: raqam + bog'langan akkaunt)
export const CLOSED_PRO_TEXT =
  "🔒 Yopiq guruhlardagi e'lonlar faqat Pro foydalanuvchilarga keladi. Pro avtomatik beriladi: raqamingizni ulashing va o'z Telegram akkauntingizni bog'lang (/account_qosh).";
export const GROUPS_PAGE = 8;

const modeTitle = (id) => `${FEED_MODES[id].icon} ${FEED_MODES[id].name}`;

// «🎛 Qaysi e'lonlar kelsin?» (2026-11-19, Azimjon: «* asosiy yuk yoki quruq gap — shart; ^ transport turi; ^ qayerdan —
// tanlamasa filtrsiz»). Uch tugma: transport, qayerdan, guruhlar — har biri o'z ro'yxatini shu oynaning o'zida ochadi va
// «✅ Saqlash» bilan bu yerga qaytadi; «✅ Tayyor» — oynani yopadi. profile — hozirgi profil (yangi haydovchida null)
export function modeStep({ profile = null, intro = null } = {}) {
  const feed = feedOf(profile);
  const mode = choiceMode(feed.mode);
  const groups = FEED_MODES[mode].groups ? `${feed.sources.length} ta guruh` : "Hamma guruhlar";
  const lines = [
    ...(intro ? [intro, ""] : []),
    "🎛 <b>Qaysi e'lonlar kelsin?</b>",
    "",
    "Yuk e'lonlari darhol, asl matni bilan keladi. Quruq gap (reklama, guruh botlarining xabarlari, salom-alik) — o'zi tashlanadi.",
    "",
    "Filtr qo'ymasangiz — hammasi keladi:",
    `🚚 Transport: <b>${trucksText(feed.trucks)}</b>`,
    `📍 Qayerdan: <b>${regionsText(feed.regions)}</b>`,
    `📌 Guruhlar: <b>${groups}</b>`,
    "",
    "Transport turi yoki joyi yozilmagan e'lon — har qanday filtrda keladi (yuk o'tkazib yuborilmasin).",
    "➕ O'z guruhingizni qo'shish — «➕ Guruh qo'shish». Sozlash paytida e'lonlar to'xtab turadi.",
  ];
  const short = (text) => (text.length > 28 ? `${text.slice(0, 27)}…` : text);
  const keyboard = [
    [{ text: `🚚 Transport: ${short(trucksText(feed.trucks))}`, data: "ft:open" }],
    [{ text: `📍 Qayerdan: ${short(regionsText(feed.regions).replace(/ viloyati/g, ""))}`, data: "fm:hududim" }],
    [{ text: `📌 Guruhlar: ${groups}`, data: "fm:guruhlarim" }],
  ];
  if (FEED_MODES[mode].groups) keyboard.push([{ text: "🌐 Hamma guruhlardan olish", data: "fm:tezkor" }]);
  keyboard.push([{ text: "✅ Tayyor", data: "fm:done" }]);
  return { text: lines.join("\n"), keyboard };
}

// Tugmadagi guruh nomi: sarlavha (bo'lsa) yoki @nomi, qisqartirilgan; ostida kuniga nechta e'lon
function groupLabel(source, chosen) {
  const name = source.title || source.name;
  const short = name.length > 26 ? `${name.slice(0, 25)}…` : name;
  if (source.locked) return `🔒 ${short} · Pro`;
  return `${chosen ? "✅" : "▫️"} ${source.closed ? "🔒 " : ""}${short} · ${source.perDay}/kun`;
}

// list — store.feedSources(chatId, { pro }) (eng faoli birinchi), chosen — tanlangan nomlar, mode — guruhlarim | guruhlarim_plus,
// kind — qaysi bo'lim ko'rinadi: open (🌐 ochiq) | closed (🔒 yopiq; Azimjon, 2026-11-16: «publik va private guruhlardan
// tanlaydigan qil»). Yopiq guruh bo'lmasa — bo'lim tugmalari yo'q
export function groupStep({ list, chosen = [], page = 0, mode = "guruhlarim", kind = "open", pro = false }) {
  const keys = new Set(chosen.map(sourceKey));
  const open = list.filter((s) => !s.closed);
  const closed = list.filter((s) => s.closed);
  const tab = kind === "closed" && closed.length ? "closed" : "open";
  const part = tab === "closed" ? closed : open;
  const pages = Math.max(1, Math.ceil(part.length / GROUPS_PAGE));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const shown = part.slice(p * GROUPS_PAGE, (p + 1) * GROUPS_PAGE);
  const rest = mode === "guruhlarim_plus" ? "Qolgan guruhlardan esa — mashinangiz va yo'nalishingizga moslari." : "Boshqa guruhlardan hech narsa kelmaydi.";
  const lines = [
    `${modeTitle(mode)}`,
    "",
    "📌 <b>Qaysi guruh va kanallardan?</b>",
    `Tanlaganlaringizdagi har bir yuk e'loni darhol, asl matni bilan keladi. ${rest}`,
    "",
    list.length
      ? `Tanlandi: <b>${keys.size}</b> ta (ko'pi bilan ${FEED_SOURCES_MAX}). Raqam — kuniga nechta e'lon.`
      : "Ro'yxat hozircha bo'sh.",
    "Kerakli guruh ro'yxatda yo'q bo'lsa — «➕ Guruh qo'shish» bilan qo'shing: tekshiruvdan o'tsa, shu yerda chiqadi.",
  ];
  if (tab === "closed") lines.push("", pro ? "🔒 <b>Yopiq guruhlar</b> — Pro foydalanuvchi sifatida ulardagi e'lonlar ham sizga keladi." : CLOSED_PRO_TEXT);
  const count = (items) => items.filter((s) => keys.has(sourceKey(s.name))).length;
  const keyboard = [];
  if (closed.length) {
    keyboard.push([
      { text: `${tab === "open" ? "● " : ""}🌐 Ochiq · ${open.length}${count(open) ? ` (✅${count(open)})` : ""}`, data: "fg:k:open" },
      { text: `${tab === "closed" ? "● " : ""}🔒 Yopiq · ${closed.length}${count(closed) ? ` (✅${count(closed)})` : ""}`, data: "fg:k:closed" },
    ]);
  }
  keyboard.push(...shown.map((source) => [{ text: groupLabel(source, keys.has(sourceKey(source.name))), data: `fg:t:${source.name}` }]));
  if (pages > 1) {
    keyboard.push([
      { text: p > 0 ? "⬅️" : "·", data: `fg:p:${Math.max(0, p - 1)}` },
      { text: `${p + 1} / ${pages}`, data: `fg:p:${p}` },
      { text: p < pages - 1 ? "➡️" : "·", data: `fg:p:${Math.min(pages - 1, p + 1)}` },
    ]);
  }
  keyboard.push([{ text: "✅ Saqlash va orqaga", data: "fg:ok" }]);
  keyboard.push([{ text: "⬅️ Saqlamasdan orqaga", data: "fg:back" }]);
  return { text: lines.join("\n"), keyboard, page: p };
}

// «📍 Qayerdan?»: viloyatlar ro'yxati (✅ belgilangan), 2 ustunda. chosen — viloyat kodlari; bo'sh — hamma joydan
export function regionStep({ chosen = [] } = {}) {
  const lines = [
    "📍 <b>Qaysi viloyat(lar)dan ketadigan e'lonlar kelsin?</b>",
    "Bir nechtasini belgilash mumkin. Hech birini belgilamasangiz — hamma joydan. E'londa joy aniqlanmasa ham — baribir keladi.",
    "",
    `Tanlandi: <b>${chosen.length ? `${chosen.length} ta` : "hamma joy"}</b>`,
  ];
  const buttons = REGIONS.map((r) => ({ text: `${chosen.includes(r.id) ? "✅" : "▫️"} ${regionTitle(r.id).replace(" viloyati", " vil.")}`, data: `fr:t:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: `${chosen.length ? "▫️" : "✅"} Hamma joy (filtrsiz)`, data: "fr:all" }]);
  // Bitta chiqish tugmasi — doim saqlaydi (2026-11-19: «⬅️ Orqaga» saqlamasdi, haydovchi tanlovi yo'qoldi deb o'yladi)
  keyboard.push([{ text: "✅ Saqlash va orqaga", data: "fr:ok" }]);
  return { text: lines.join("\n"), keyboard };
}

// «🚚 Qaysi transport?»: to'rt tur (✅ belgilangan). chosen — TRUCK_FILTERS kodlari; bo'sh — hammasi
export function truckStep({ chosen = [] } = {}) {
  const lines = [
    "🚚 <b>Qaysi transport uchun e'lonlar kelsin?</b>",
    "Bir nechtasini belgilash mumkin. Hech birini belgilamasangiz — hammasi. E'londa mashina turi yozilmagan bo'lsa ham — baribir keladi.",
    "",
    `Tanlandi: <b>${trucksText(chosen)}</b>`,
  ];
  const keyboard = TRUCK_FILTERS.map((t) => [{ text: `${chosen.includes(t.id) ? "✅" : "▫️"} ${t.icon} ${t.name}`, data: `ft:t:${t.id}` }]);
  keyboard.push([{ text: `${chosen.length ? "▫️" : "✅"} Hammasi (filtrsiz)`, data: "ft:all" }]);
  // Bitta chiqish tugmasi — doim saqlaydi (2026-11-19: «⬅️ Orqaga» saqlamasdi, haydovchi tanlovi yo'qoldi deb o'yladi)
  keyboard.push([{ text: "✅ Saqlash va orqaga", data: "ft:ok" }]);
  return { text: lines.join("\n"), keyboard };
}

// Tanlovga guruh qo'shish / olib tashlash → yangi ro'yxat yoki { error } (chegara)
export function toggleSource(chosen, name) {
  const key = sourceKey(name);
  if (chosen.some((n) => sourceKey(n) === key)) return { chosen: chosen.filter((n) => sourceKey(n) !== key) };
  if (chosen.length >= FEED_SOURCES_MAX) return { error: `Ko'pi bilan ${FEED_SOURCES_MAX} ta guruh tanlash mumkin` };
  return { chosen: [...chosen, name] };
}

// Saqlangach yoziladigan matn: nima keladi
export function feedSavedText(feed, { needsVehicle = false } = {}) {
  const f = feedOf({ feed });
  const head = `✅ Rejim: <b>${modeTitle(f.mode)}</b>`;
  const filters = `🚚 Transport: <b>${trucksText(f.trucks)}</b>\n📍 Qayerdan: <b>${regionsText(f.regions)}</b>`;
  const change = "O'zgartirish — «🎛 Rejim».";
  if (f.mode === "tezkor") {
    const many = !f.trucks.length && !f.regions.length ? " Kunduzi daqiqasiga o'nlab xabar bo'lishi mumkin — kamroq kerak bo'lsa, transport yoki viloyat tanlang; to'xtatish — «⏸ Pauza»." : "";
    return `${head}\n${filters}\n\nHamma guruhlardagi yuk e'lonlari asl matni bilan darhol shu yerga keladi, quruq gap tashlanadi.${many}\n\n${change} ➕ O'z guruhingizni qo'shish — «➕ Guruh qo'shish».`;
  }
  if (f.mode === "guruhlarim" || f.mode === "guruhlarim_plus") {
    const groups = `Tanlagan ${f.sources.length} ta guruhingizdagi yuk e'lonlari asl matni bilan darhol shu yerga keladi.`;
    if (f.mode === "guruhlarim") return `${head}\n${filters}\n\n${groups}\n\n${change}`;
    const sorted = needsVehicle
      ? "Boshqa guruhlardan mos yuklar uchun mashinangizni kiriting — pastdagi «🚚 Ro'yxatdan o'tish»."
      : "Boshqa guruhlardan — mashinangiz va yo'nalishingizga moslari.";
    return `${head}\n\n${groups}\n${sorted}`;
  }
  return needsVehicle
    ? `${head}\n\nMos yuklarni topish uchun mashinangizni kiriting.`
    : `${head}\n\nMashinangiz va yo'nalishingizga mos yuklar keladi.`;
}
