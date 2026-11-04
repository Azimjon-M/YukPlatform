// Shahar nomini ro'yxatimiz (regions.js) bo'yicha topadi: parser (AI javobini tekshirish), bot (haydovchi yozgan shahar) uchun.
// Shahar ro'yxatda aniq bitta joyda bo'lsa, viloyat va davlat AI'dan emas, ro'yxatdan olinadi:
// AI ba'zan to'g'ri shaharni noto'g'ri viloyatga yozadi (masalan, Koson → Buxoro), ro'yxat esa adashmaydi.
import { COUNTRIES, REGIONS } from "./regions.js";

// Solishtirish kaliti: harf kattaligi, apostroflar, bo'sh joy, chiziqcha va qavs ichidagi izoh farq qilmaydi
// "Qo'qon" = "Qoqon" = "QOʻQON"; "Yangibozor (Xorazm)" → "yangibozor"
export function placeKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[ʻʼ’‘`'\-\s.]/g, "");
}

// kalit → [{ name, region, country }]; bir nechta yozuv bo'lsa — nom noaniq (ikki joyda bor)
const INDEX = new Map();
function add(name, entry) {
  const key = placeKey(name);
  const list = INDEX.get(key) ?? [];
  if (!list.some((e) => e.region === entry.region && e.country === entry.country)) list.push(entry);
  INDEX.set(key, list);
}
for (const region of REGIONS) {
  for (const city of region.cities) add(city, { name: city.replace(/\s*\(.*\)$/, ""), region: region.id, country: "O'zbekiston" });
  for (const [canonical, variants] of Object.entries(region.aliases ?? {})) {
    for (const variant of variants) add(variant, { name: canonical, region: region.id, country: "O'zbekiston" });
  }
}
for (const country of COUNTRIES) {
  for (const city of country.cities) add(city, { name: city, region: "xorij", country: country.name });
}

// Ro'yxatda aniq bitta joyda bo'lsa { name, region, country }, aks holda null
export function lookupCity(name) {
  if (!name) return null;
  const list = INDEX.get(placeKey(name));
  return list?.length === 1 ? list[0] : null;
}

// Yukning qayerdan/qayerga maydonlarini ro'yxat bo'yicha to'g'rilaydi (nomni ham ro'yxatdagi yozilishga keltiradi)
export function normalizePlaces(load) {
  const out = { ...load };
  for (const side of ["from", "to"]) {
    const found = lookupCity(out[`${side}City`]);
    if (!found) continue;
    out[`${side}City`] = found.name;
    out[`${side}Region`] = found.region;
    out[`${side}Country`] = found.country;
  }
  return out;
}
