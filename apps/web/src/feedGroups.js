// «📌 Mening guruhlarim» ro'yxatining toza qismi (FeedGroups.jsx; node --test bilan tekshiriladi)
import { foldText } from "@yuk/shared";

const perDayText = (n) => (n > 0 ? `${n} ta/kun` : "kam");

// list — serverdan kelgan ro'yxat; chosen — tanlanganlar (ro'yxatda bo'lmasa ham ko'rinsin: masalan, oflayn)
export function groupOptions(list, chosen) {
  const known = new Set(list.map((s) => s.name.toLowerCase()));
  const extra = chosen
    .filter((name) => !known.has(name.toLowerCase()))
    .map((name) => ({ name, title: null, perDay: null, mine: false, own: false, closed: !name.startsWith("@"), locked: false }));
  return [...extra, ...list].map((s) => ({
    id: s.name,
    label: s.title ?? s.name,
    // Yopiq guruhning raqamli id'si foydalanuvchiga hech narsa demaydi — ko'rsatilmaydi
    note: [s.title && !s.closed ? s.name : null, s.mine ? "siz qo'shgansiz" : null, s.locked ? "🔒 Pro uchun" : null].filter(Boolean).join(" · ") || null,
    sub: s.perDay == null ? null : perDayText(s.perDay),
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
