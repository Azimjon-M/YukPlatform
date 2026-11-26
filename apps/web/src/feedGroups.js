// «📌 Mening guruhlarim» ro'yxatining toza qismi (FeedGroups.jsx; node --test bilan tekshiriladi)
import { foldText } from "@yuk/shared";

const perDayText = (n) => (n > 0 ? `${n} ta/kun` : "kam");

// list — serverdan kelgan ro'yxat; chosen — tanlanganlar (ro'yxatda bo'lmasa ham ko'rinsin: masalan, oflayn)
export function groupOptions(list, chosen) {
  const known = new Set(list.map((s) => s.name.toLowerCase()));
  const extra = chosen
    .filter((name) => !known.has(name.toLowerCase()))
    .map((name) => ({ name, title: null, perDay: null, mine: false, closed: !name.startsWith("@"), locked: false }));
  return [...extra, ...list].map((s) => ({
    id: s.name,
    label: s.title ?? s.name,
    // Yopiq guruhning raqamli id'si foydalanuvchiga hech narsa demaydi — ko'rsatilmaydi
    note: [s.title && !s.closed ? s.name : null, s.mine ? "siz qo'shgansiz" : null, s.locked ? "🔒 Pro uchun" : null].filter(Boolean).join(" · ") || null,
    sub: s.perDay == null ? null : perDayText(s.perDay),
    search: foldText(`${s.title ?? ""} ${s.name}`), // kirill/lotin farqisiz (@yuk/shared foldText)
    closed: Boolean(s.closed),
    disabled: Boolean(s.locked),
  }));
}

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
