// Shahar nomini ro'yxatimiz (regions.js) bo'yicha topadi: parser (AI javobini tekshirish), bot (haydovchi yozgan shahar) uchun.
// Shahar ro'yxatda aniq bitta joyda bo'lsa, viloyat va davlat AI'dan emas, ro'yxatdan olinadi:
// AI ba'zan to'g'ri shaharni noto'g'ri viloyatga yozadi (masalan, Koson → Buxoro), ro'yxat esa adashmaydi.
import { COUNTRIES, REGIONS, TASHKENT_DISTRICTS, sameArea } from "./regions.js";

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
  for (const [canonical, variants] of Object.entries(country.aliases ?? {})) {
    for (const variant of variants) add(variant, { name: canonical, region: "xorij", country: country.name });
  }
}

// Ro'yxatda aniq bitta joyda bo'lsa { name, region, country }, aks holda null
export function lookupCity(name) {
  if (!name) return null;
  const list = INDEX.get(placeKey(name));
  return list?.length === 1 ? list[0] : null;
}

const DISTRICT_KEYS = new Set(TASHKENT_DISTRICTS.map(placeKey));
// Viloyat nomlari ("Toshkent", "Namangan", "Samarqand"...): e'londa ular ko'pincha shahar emas, viloyatni bildiradi
const REGION_NAME_KEYS = new Set(
  REGIONS.filter((r) => r.id !== "xorij").map((r) => placeKey(r.name.replace(/ (viloyati|shahri|Respublikasi)$/, ""))),
);

// "Тошкент Назарбекдан", "Namangan (pop)": AI ko'pincha city = Toshkent, place = Nazarbek deb yozadi.
// Bu yerda "Toshkent" — viloyat, Nazarbek esa ro'yxatda shu viloyatdagi shahar: yuk aynan Nazarbekdan.
// Faqat shahar nomi viloyat nomi bilan bir xil bo'lsa almashtiriladi: "Qo'qon (Uchko'prik)" — Qo'qon shahar, joyida qoladi.
// Toshkent tumanlari (Sergeli, Uchtepa...) shahar emas; boshqa viloyatdagi bir xil nomga ham tegilmaydi.
function promotePlace(out, side) {
  const place = out[`${side}Place`];
  const city = out[`${side}City`];
  if (city && !REGION_NAME_KEYS.has(placeKey(city))) return;
  const found = lookupCity(place);
  if (!found || found.region === "xorij" || DISTRICT_KEYS.has(placeKey(place))) return;
  const region = lookupCity(out[`${side}City`])?.region ?? out[`${side}Region`];
  if (region && !sameArea(region, found.region)) return;
  out[`${side}City`] = found.name;
  out[`${side}Place`] = null;
}

// Yukning qayerdan/qayerga maydonlarini ro'yxat bo'yicha to'g'rilaydi (nomni ham ro'yxatdagi yozilishga keltiradi)
export function normalizePlaces(load) {
  const out = { ...load };
  for (const side of ["from", "to"]) {
    promotePlace(out, side);
    const found = lookupCity(out[`${side}City`]);
    if (found) {
      out[`${side}City`] = found.name;
      out[`${side}Region`] = found.region;
      out[`${side}Country`] = found.country;
    }
    // Ro'yxatda yo'q xorijiy shahar (Kostroma, Kishinyov...) yoki faqat davlat: viloyati "xorij" bo'ladi,
    // aks holda «Istalgan davlat» ni tanlagan haydovchiga bu yuk bormaydi
    const country = out[`${side}Country`];
    if (!out[`${side}Region`] && country && country !== "O'zbekiston") out[`${side}Region`] = "xorij";
  }
  return out;
}
