// Haydovchining yetkazish rejimi botda (qoidalari — @yuk/shared feed.js; Azimjon, 2026-11-14: «yukni kim birinchi olsa,
// yuk o'shaniki»). Bu yerda faqat xabar matni va inline tugmalar — sof funksiyalar (testda Telegram kerak emas):
//   modeStep  — «🎛 Yuklarni qanday olasiz?»: 4 rejim, har biri bitta tugma (fm:<rejim>)
//   groupStep — «📌 Qaysi guruhlardan?»: ro'yxat sahifalab, bosilsa ✅ qo'yiladi/olinadi (fg:t:<nomi>), fg:p:<sahifa>,
//               «✅ Tayyor» (fg:ok), «⬅️ Orqaga» (fg:back)
// Tugmalar { text, data } ko'rinishida (route.js dagidek) — bot.js toKeyboard ularni InlineKeyboard ga aylantiradi.
import { FEED_MODES, FEED_MODE_IDS, FEED_SOURCES_MAX, feedOf, sourceKey } from "@yuk/shared";

export const FEED_CALLBACK = /^fm:(\w+)$/;
export const GROUP_CALLBACK = /^fg:(?:t:(.+)|p:(\d+)|ok|back)$/;
export const GROUPS_PAGE = 8;

const modeTitle = (id) => `${FEED_MODES[id].icon} ${FEED_MODES[id].name}`;

// Rejim tanlash. profile — hozirgi profil (✅ qaysi rejimda ekanini ko'rsatadi; yangi haydovchida null), intro — tepadagi qator
export function modeStep({ profile = null, intro = null } = {}) {
  const current = profile ? feedOf(profile).mode : null;
  const lines = [
    ...(intro ? [intro, ""] : []),
    "🎛 <b>Yuklarni qanday olasiz?</b>",
    "",
    ...FEED_MODE_IDS.map((id) => `${modeTitle(id)} — ${FEED_MODES[id].about}.`),
    "",
    "Rejimni keyin istalgan payt almashtirasiz.",
  ];
  const keyboard = FEED_MODE_IDS.map((id) => [{ text: `${current === id ? "✅ " : ""}${modeTitle(id)}`, data: `fm:${id}` }]);
  return { text: lines.join("\n"), keyboard };
}

// Tugmadagi guruh nomi: sarlavha (bo'lsa) yoki @nomi, qisqartirilgan; ostida kuniga nechta e'lon
function groupLabel(source, chosen) {
  const name = source.title || source.name;
  const short = name.length > 26 ? `${name.slice(0, 25)}…` : name;
  return `${chosen ? "✅" : "▫️"} ${short} · ${source.perDay}/kun`;
}

// list — store.feedSources(chatId) (eng faoli birinchi), chosen — tanlangan nomlar, mode — guruhlarim | guruhlarim_plus
export function groupStep({ list, chosen = [], page = 0, mode = "guruhlarim" }) {
  const keys = new Set(chosen.map(sourceKey));
  const pages = Math.max(1, Math.ceil(list.length / GROUPS_PAGE));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const shown = list.slice(p * GROUPS_PAGE, (p + 1) * GROUPS_PAGE);
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
  const keyboard = shown.map((source) => [{ text: groupLabel(source, keys.has(sourceKey(source.name))), data: `fg:t:${source.name}` }]);
  if (pages > 1) {
    keyboard.push([
      { text: p > 0 ? "⬅️" : "·", data: `fg:p:${Math.max(0, p - 1)}` },
      { text: `${p + 1} / ${pages}`, data: `fg:p:${p}` },
      { text: p < pages - 1 ? "➡️" : "·", data: `fg:p:${Math.min(pages - 1, p + 1)}` },
    ]);
  }
  keyboard.push([{ text: "✅ Tayyor", data: "fg:ok" }]);
  keyboard.push([{ text: "⬅️ Rejimlarga qaytish", data: "fg:back" }]);
  return { text: lines.join("\n"), keyboard, page: p };
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
  const head = `✅ Rejim: <b>${modeTitle(feed.mode)}</b>`;
  if (feed.mode === "tezkor") {
    return `${head}\n\nHamma guruhlardagi yuk e'lonlari asl matni bilan darhol shu yerga keladi (chet el yo'nalishlarisiz). ` +
      "Kunduzi daqiqasiga 10 tagacha xabar bo'lishi mumkin — to'xtatish: «⏸ Pauza».";
  }
  if (feed.mode === "guruhlarim" || feed.mode === "guruhlarim_plus") {
    const groups = `Tanlagan ${feed.sources.length} ta guruhingizdagi har bir yuk e'loni asl matni bilan darhol shu yerga keladi.`;
    if (feed.mode === "guruhlarim") return `${head}\n\n${groups}`;
    const sorted = needsVehicle
      ? "Boshqa guruhlardan mos yuklar uchun mashinangizni kiriting — pastdagi «🚚 Ro'yxatdan o'tish»."
      : "Boshqa guruhlardan — mashinangiz va yo'nalishingizga moslari.";
    return `${head}\n\n${groups}\n${sorted}`;
  }
  return needsVehicle
    ? `${head}\n\nMos yuklarni topish uchun mashinangizni kiriting.`
    : `${head}\n\nMashinangiz va yo'nalishingizga mos yuklar keladi.`;
}
