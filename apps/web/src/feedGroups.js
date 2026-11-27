// «📌 Mening guruhlarim» ro'yxatining toza qismi (FeedGroups.jsx; node --test bilan tekshiriladi)
import { foldText } from "@yuk/shared";

const perDayText = (n) => (n > 0 ? `${n} ta/kun` : "kam");

// A'zolar soni qisqa (2026-11-27, Azimjon: «uzun bo'ladi desang 1.3K yoki 1.7M qil»): 950 → «950», 1 340 → «1.3K»,
// 12 500 → «12.5K», 245 000 → «245K», 1 700 000 → «1.7M». Kasr — nuqta bilan, «.0» yozilmaydi
export function membersText(n) {
  if (!(n > 0)) return null;
  const short = (value, unit) => `${String(Math.floor(value * 10) / 10).replace(/\.0$/, "")}${unit}`;
  if (n < 1000) return String(n);
  if (n < 100_000) return short(n / 1000, "K");
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return short(n / 1_000_000, "M");
}

// list — serverdan kelgan ro'yxat; chosen — tanlanganlar (ro'yxatda bo'lmasa ham ko'rinsin: masalan, oflayn)
export function groupOptions(list, chosen) {
  const known = new Set(list.map((s) => s.name.toLowerCase()));
  const extra = chosen
    .filter((name) => !known.has(name.toLowerCase()))
    .map((name) => ({ name, title: null, perDay: null, mine: false, own: false, closed: !name.startsWith("@"), locked: false }));
  return [...extra, ...list].map((s) => ({
    id: s.name,
    label: s.title ?? s.name,
    // Nom ostida — @username (yopiq guruhning raqamli id'si hech narsa demaydi — ko'rsatilmaydi). Kim qo'shgani yozilmaydi
    // (2026-11-27, Azimjon: «Kim tomonidan qo'shilgani kerak emas!»)
    note: [s.title && !s.closed ? s.name : null, s.locked ? "🔒 Pro uchun" : null].filter(Boolean).join(" · ") || null,
    sub: s.perDay == null ? null : perDayText(s.perDay),
    sub2: membersText(s.members) ? `👥 ${membersText(s.members)}` : null, // o'ngda, «ta/kun» ostida
    marquee: true, // uzun nom bir qatorda, chapga-o'ngga suriladi (ui.jsx Marquee)
    search: foldText(`${s.title ?? ""} ${s.name}`), // kirill/lotin farqisiz (@yuk/shared foldText)
    closed: Boolean(s.closed),
    disabled: Boolean(s.locked),
    own: Boolean(s.own), // o'z Telegram akkaunti a'zo bo'lgan guruh/kanal (yoki o'zi qo'shgan) — store feedSources
  }));
}

// «🌍 Global» — hamma guruhlar, «👤 Akkauntimdagi» — faqat own (2026-11-26, Azimjon: «guruh tanlashda global va o'z
// accountimdagi ochiq/yopiq guruh/kanallardan tanlash kerak»; 2026-11-27 dan — faqat ilovadagi «🎛 Filtr» da)
export const GROUP_SCOPES = [
  { id: "all", label: "🌍 Global" },
  { id: "own", label: "👤 Akkauntimdagi" },
];
export const scopeOptions = (options, scope) => (scope === "own" ? options.filter((o) => o.own) : options);
export const OWN_EMPTY_HINT =
  "Bu yerda o'zingiz ulagan Telegram akkauntingiz a'zo bo'lgan guruh va kanallar chiqadi. Akkauntni «⚙️ Sozlamalar» → «📡 Telegram akkaunt ulash» da ulang.";

// «👤 Akkauntimdagi» → «🔒 Yopiq» bo'sh (2026-11-27, Azimjon: «Akkauntimdagi ni tanlasa ham Ochiq/Yopiq chiqarilishi kerak»)
export const OWN_CLOSED_EMPTY_HINT =
  "Akkauntingiz a'zo bo'lgan yopiq yuk guruhlari «🔎 Auto scan» tekshiruvidan o'tgach shu yerda chiqadi. Yangi guruhga qo'shilgan bo'lsangiz — Auto scan'ni qayta bosing, bir necha daqiqada tekshiriladi.";

// Sahifalash (2026-11-20, Azimjon: «juda ko'p guruh bo'lgani sababli Pagination kerak. max 20 ta bo'lsin»)
export const GROUPS_PAGE_SIZE = 20;

// items — ko'rsatiladigan ro'yxat, page — 0 dan; ro'yxat qisqarsa — oxirgi bor sahifa
// → { items, page, pages, first, last, total }
export function pageOf(items, page, size = GROUPS_PAGE_SIZE) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const from = current * size;
  return { items: items.slice(from, from + size), page: current, pages, first: total ? from + 1 : 0, last: Math.min(total, from + size), total };
}

export const CLOSED_PRO_HINT =
  "Yopiq guruhlardagi e'lonlar faqat Pro foydalanuvchilarga keladi. Pro avtomatik beriladi: botda o'z Telegram akkauntingizni bog'lang (/account_qosh).";

// sources — [{ name, title }] → nom bo'yicha sarlavha («Tekshiring» ro'yxati uchun)
export const sourceNamer = (list) => {
  const titles = new Map(list.map((s) => [s.name.toLowerCase(), s.title]));
  return (name) => titles.get(name.toLowerCase()) ?? name;
};

// Sahifa tugmalari (2026-11-27, Azimjon: «Paginationni btnli raqamlab … 5 ta (1, ... 5) btn … btn lar ko'p bo'lsa …
// "..." qo'yish»). page — 0 dan; → [0, 1, 2, "gap", 9] kabi (raqam — sahifa, "gap" — «…»). Ko'pi bilan `slots` ta
// (standart 7): birinchi va oxirgi doim, joriy sahifa va yonidagilar, oraliq — «…». 7 tagacha sahifa — hammasi
export function pageButtons(page, pages, slots = 7) {
  if (pages <= slots) return Array.from({ length: pages }, (_, i) => i);
  const side = slots - 2; // birinchi/oxirgidan tashqari
  const current = Math.min(Math.max(0, page), pages - 1);
  // Boshida yoki oxirida — bitta «…» (masalan 1 2 3 4 5 … 26), o'rtada — ikkita (1 … 11 12 13 … 26)
  if (current < side - 1) return [...Array.from({ length: side }, (_, i) => i), "gap", pages - 1];
  if (current > pages - side) return [0, "gap", ...Array.from({ length: side }, (_, i) => pages - side + i)];
  const around = Math.floor((side - 2) / 2);
  return [0, "gap", ...Array.from({ length: side - 2 }, (_, i) => current - around + i), "gap", pages - 1];
}
