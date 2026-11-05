// Xarita uchun: yuklarni joy bo'yicha guruhlash (React'siz — node --test bilan tekshiriladi).
import { placePoint } from "@yuk/shared";

// side — "from" (yuklash joyi) yoki "to" (tushirish joyi).
// → { groups: [{ key, lat, lon, label, exact, items }], unplaced } — eng ko'p yukli joy birinchi;
// unplaced — xaritaga qo'yib bo'lmagan yuklar soni (joyi yozilmagan yoki ro'yxatimizda yo'q)
export function groupByPlace(items, side) {
  const groups = new Map();
  let unplaced = 0;
  for (const item of items) {
    const point = placePoint(item.load, side);
    if (!point) {
      unplaced++;
      continue;
    }
    let group = groups.get(point.key);
    if (!group) groups.set(point.key, (group = { ...point, items: [] }));
    group.items.push(item);
  }
  return { groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length), unplaced };
}

// Doira kattaligi: eng ko'p yukli joy — eng katta; yuz emas, ildiz bo'yicha (kichiklari ham ko'rinsin)
export function markerRadius(count, max) {
  return Math.round(7 + 17 * Math.sqrt(count / Math.max(max, 1)));
}
