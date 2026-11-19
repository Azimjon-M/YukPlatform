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
export const GROUP_CALLBACK = /^fg:(?:t:(.+)|p:(\d+)|k:(open|closed)|ok|back|all)$/;
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
  const mine = FEED_MODES[mode].groups;
  // 2026-11-19 (soddalashtirish): qisqa matn — nima tanlangani va bitta ko'rsatma; tushuntirishlar ro'yxat ichida
  const lines = [
    ...(intro ? [intro, ""] : []),
    "🎛 <b>Qaysi yuklar kelsin?</b>",
    "Tugmani bosib tanlang. Tanlamasangiz — hammasi keladi.",
    "",
    `🚚 Mashina: <b>${trucksText(feed.trucks)}</b>`,
    `📍 Qayerdan: <b>${regionsText(feed.regions)}</b>`,
    `📌 Guruhlar: <b>${mine ? `tanlangan ${feed.sources.length} ta` : "Hamma guruhlar"}</b>`,
  ];
  const short = (text) => (text.length > 28 ? `${text.slice(0, 27)}…` : text);
  const keyboard = [
    [{ text: `🚚 Mashina: ${short(trucksText(feed.trucks))}`, data: "ft:open" }],
    [{ text: `📍 Qayerdan: ${short(regionsText(feed.regions).replace(/ viloyati/g, ""))}`, data: "fm:hududim" }],
    // Manba — ikki tugmali tanlov (✅ — hozirgisi). «📌» doim ro'yxatni ochadi (tanlovni o'zgartirish uchun)
    [
      { text: `${mine ? "" : "✅ "}🌐 Hamma guruhlar`, data: "fm:tezkor" },
      { text: mine ? `✅ 📌 Tanlangan: ${feed.sources.length} ta` : "📌 Guruh tanlash", data: "fm:guruhlarim" },
    ],
    [{ text: "✅ Tayyor", data: "fm:done" }],
  ];
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
  const rest = mode === "guruhlarim_plus" ? "Qolgan guruhlardan — mashinangizga moslari." : "Faqat shulardan yuk keladi.";
  const lines = [
    "📌 <b>Qaysi guruhlardan?</b>",
    `Guruhni bosing — ✅ belgi qo'yiladi. ${rest}`,
    "",
    list.length ? `Tanlandi: <b>${keys.size}</b> ta. Raqam — kuniga nechta e'lon.` : "Ro'yxat hozircha bo'sh.",
    "Kerakli guruh yo'qmi? — «➕ Guruh qo'shish».",
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
  // «Hammasini tanlash» (2026-11-19) — ochiq va yopiq (tanlab bo'ladigan) hamma guruh birdaniga; hammasi tanlangan bo'lsa — tozalash
  const pickable = list.filter((s) => !s.locked);
  if (pickable.length) {
    const allChosen = pickable.every((s) => keys.has(sourceKey(s.name)));
    keyboard.push([{ text: allChosen ? "▫️ Hammasini olib tashlash" : `☑️ Hammasini tanlash (${pickable.length} ta)`, data: "fg:all" }]);
  }
  keyboard.push(...shown.map((source) => [{ text: groupLabel(source, keys.has(sourceKey(source.name))), data: `fg:t:${source.name}` }]));
  if (pages > 1) {
    keyboard.push([
      { text: p > 0 ? "⬅️" : "·", data: `fg:p:${Math.max(0, p - 1)}` },
      { text: `${p + 1} / ${pages}`, data: `fg:p:${p}` },
      { text: p < pages - 1 ? "➡️" : "·", data: `fg:p:${Math.min(pages - 1, p + 1)}` },
    ]);
  }
  // Bitta chiqish — doim saqlaydi: guruh tanlangan bo'lsa — «📌 Tanlangan guruhlar», hech biri — «🌐 Hamma guruhlar»
  keyboard.push([{ text: "💾 Saqlash", data: "fg:ok" }]);
  return { text: lines.join("\n"), keyboard, page: p };
}

// «📍 Qayerdan?»: viloyatlar ro'yxati (✅ belgilangan), 2 ustunda. chosen — viloyat kodlari; bo'sh — hamma joydan
export function regionStep({ chosen = [] } = {}) {
  const lines = [
    "📍 <b>Yuk qayerdan ketsin?</b>",
    "Viloyatni bosing — ✅ belgi qo'yiladi. Bir nechta bo'lishi mumkin.",
    "Joyi yozilmagan yuk ham keladi.",
  ];
  // Tugmada qisqa nom (uzun nom telefonda kesilib qolardi)
  const short = (id) => ({ qoraqalpogiston: "Qoraqalpog'iston", xorij: "Chet el" })[id] ?? regionTitle(id).replace(" viloyati", " vil.");
  const buttons = REGIONS.map((r) => ({ text: `${chosen.includes(r.id) ? "✅" : "▫️"} ${short(r.id)}`, data: `fr:t:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: `${chosen.length ? "▫️" : "✅"} Hamma joydan`, data: "fr:all" }]);
  // Bitta chiqish tugmasi — doim saqlaydi (2026-11-19: «⬅️ Orqaga» saqlamasdi, haydovchi tanlovi yo'qoldi deb o'yladi)
  keyboard.push([{ text: "💾 Saqlash", data: "fr:ok" }]);
  return { text: lines.join("\n"), keyboard };
}

// «🚚 Qaysi transport?»: to'rt tur (✅ belgilangan). chosen — TRUCK_FILTERS kodlari; bo'sh — hammasi
export function truckStep({ chosen = [] } = {}) {
  const lines = [
    "🚚 <b>Mashinangiz qaysi?</b>",
    "Bosing — ✅ belgi qo'yiladi. Bir nechta bo'lishi mumkin.",
    "Mashinasi yozilmagan yuk ham keladi.",
  ];
  const keyboard = TRUCK_FILTERS.map((t) => [{ text: `${chosen.includes(t.id) ? "✅" : "▫️"} ${t.icon} ${t.name}`, data: `ft:t:${t.id}` }]);
  keyboard.push([{ text: `${chosen.length ? "▫️" : "✅"} Hamma mashinalar`, data: "ft:all" }]);
  // Bitta chiqish tugmasi — doim saqlaydi (2026-11-19: «⬅️ Orqaga» saqlamasdi, haydovchi tanlovi yo'qoldi deb o'yladi)
  keyboard.push([{ text: "💾 Saqlash", data: "ft:ok" }]);
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
  // 2026-11-19 (soddalashtirish): «✅ Tayyor!» + nima tanlangani + ikki tugma nomi
  const mine = f.mode === "guruhlarim" || f.mode === "guruhlarim_plus";
  const filters = [
    `🚚 Mashina: <b>${trucksText(f.trucks)}</b>`,
    `📍 Qayerdan: <b>${regionsText(f.regions)}</b>`,
    `📌 Guruhlar: <b>${mine ? `tanlangan ${f.sources.length} ta` : "Hamma guruhlar"}</b>`,
  ].join("\n");
  if (f.mode === "tezkor" || f.mode === "guruhlarim") {
    return `✅ <b>Tayyor!</b> Yuk e'lonlari shu yerga keladi.\n\n${filters}\n\nKamroq kerak bo'lsa — «🎛 Filtr».\nTo'xtatish — «⏸ Pauza».`;
  }
  const head = `✅ Rejim: <b>${modeTitle(f.mode)}</b>`;
  if (f.mode === "guruhlarim_plus") {
    const sorted = needsVehicle ? "Boshqa guruhlardan mos yuklar uchun mashinangizni kiriting — pastdagi «🚚 Ro'yxatdan o'tish»." : "Boshqa guruhlardan — mashinangiz va yo'nalishingizga moslari.";
    return `${head}\n\nTanlagan ${f.sources.length} ta guruhingizdagi yuk e'lonlari darhol keladi.\n${sorted}`;
  }
  return needsVehicle ? `${head}\n\nMos yuklarni topish uchun mashinangizni kiriting.` : `${head}\n\nMashinangiz va yo'nalishingizga mos yuklar keladi.`;
}
