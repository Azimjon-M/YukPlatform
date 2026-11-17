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

export const CLOSED_PRO_HINT =
  "Yopiq guruhlardagi e'lonlar faqat Pro foydalanuvchilarga keladi. Pro avtomatik beriladi: raqamingizni ulashing va botda o'z Telegram akkauntingizni bog'lang (/account_qosh).";

// sources — [{ name, title }] → nom bo'yicha sarlavha («Tekshiring» ro'yxati uchun)
export const sourceNamer = (list) => {
  const titles = new Map(list.map((s) => [s.name.toLowerCase(), s.title]));
  return (name) => titles.get(name.toLowerCase()) ?? name;
};
