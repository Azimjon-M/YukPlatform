// «Manbalar» ro'yxati (2026-11-27, batafsil): guruhning 24 soati va 7 kunlik o'rtachasi, yuk ulushi, saralash.
// Sof funksiyalar — test/logic.test.js

// 950 → "950", 1 300 → "1,3K", 245 000 → "245K", 1 700 000 → "1,7M" (a'zolar soni, qisqa)
export function compactNumber(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const short = (x, unit) => `${(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace(".", ",")}${unit}`;
  if (v >= 1e6) return short(v / 1e6, "M");
  if (v >= 1e3) return short(v / 1e3, "K");
  return String(v);
}

// Oxirgi 7 tugagan kun → kuniga o'rtacha (faqat hisoblangan kunlar bo'yicha); hali birorta kun hisoblanmagan bo'lsa — null
export function weekAverage(days = []) {
  const ready = days.filter(Boolean);
  if (!ready.length) return null;
  const avg = (key) => ready.reduce((sum, d) => sum + (d[key] ?? 0), 0) / ready.length;
  return { days: ready.length, posts: avg("posts"), uniq: avg("uniq"), loads: avg("loads"), deliveries: avg("deliveries") };
}

// Yangi (takrorsiz) xabarlarning qanchasi yuk e'loni, % (0–100); xabar bo'lmasa — null
export const loadShare = (loads, uniq) => (uniq > 0 ? Math.min(100, Math.round((loads / uniq) * 100)) : null);

// Guruh turi: ochiq (@nom) / yopiq; kanal yoki guruh
export function sourceKind(source) {
  const open = source.name.startsWith("@");
  const channel = source.chatType === "channel";
  return `${open ? "Ochiq" : "Yopiq"} ${channel ? "kanal" : "guruh"}`;
}

const by = (pick) => (a, b) => (pick(b) ?? -1) - (pick(a) ?? -1);
export const SOURCE_SORTS = [
  { id: "added", label: "Qo'shilgan vaqti", compare: null }, // server tartibi (eski → yangi)
  { id: "loads", label: "Ko'p yuk (24 soat)", compare: by((s) => s.stats?.loads) },
  { id: "week", label: "Ko'p yuk (7 kun, kuniga)", compare: by((s) => weekAverage(s.days)?.loads) },
  { id: "posts", label: "Ko'p xabar (24 soat)", compare: by((s) => (s.stats ? s.stats.posts - s.stats.duplicates : null)) },
  { id: "sent", label: "Ko'p yuborilgan (24 soat)", compare: by((s) => s.stats?.deliveries) },
  { id: "share", label: "Yuk ulushi yuqori", compare: by((s) => (s.stats ? loadShare(s.stats.loads, s.stats.posts - s.stats.duplicates) : null)) },
  { id: "members", label: "Ko'p a'zo", compare: by((s) => s.members) },
  { id: "last", label: "Oxirgi e'lon", compare: by((s) => s.stats?.lastPostAt) },
];

export function sortSources(items, sortId) {
  const sort = SOURCE_SORTS.find((s) => s.id === sortId);
  return sort?.compare ? [...items].sort(sort.compare) : items;
}

// "24.11" — kun (Toshkent, kun boshi ms)
export const dayLabel = (day) => {
  const d = new Date(day + 5 * 3_600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
