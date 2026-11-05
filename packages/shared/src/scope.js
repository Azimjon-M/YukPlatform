// Platforma qaysi yo'nalishlardagi yuklar bilan ishlaydi (yo'nalish doirasi).
// Boshlanishiga (2026-11-05): O'zbekiston ichi va O'zbekiston ↔ chegaradosh davlatlar.
// Doiradan tashqaridagi yuk (Rossiya, Belarus, Xitoy, Ozarbayjon...) kanalga chiqmaydi, haydovchilarga yuborilmaydi,
// bazaga yozilmaydi. Doira .env dagi ROUTE_SCOPE bilan tanlanadi.
//
// E'lonni AI'gacha matnidan ajratib bo'lmaydi: ko'p e'lon bir nechta yo'nalish ro'yxati (Toshkent–Olmaota,
// Toshkent–Moskva...), shuning uchun tekshiruv AI aniqlagan davlatlar bo'yicha — har bir yuk alohida.
import { HOME_COUNTRY, NEIGHBOR_COUNTRIES } from "./regions.js";

export const ROUTE_SCOPES = {
  qoshni: { title: "O'zbekiston ichi va chegaradosh davlatlar bilan", countries: [HOME_COUNTRY, ...NEIGHBOR_COUNTRIES] },
  ichki: { title: "Faqat O'zbekiston ichi", countries: [HOME_COUNTRY] },
  hammasi: { title: "Hamma yo'nalishlar", countries: null },
};
export const DEFAULT_ROUTE_SCOPE = "qoshni";

// .env dagi ROUTE_SCOPE → doira kodi. Bo'sh — standart; noma'lum qiymat — xato (jim o'tib ketmasin)
export function routeScopeFrom(env = process.env) {
  const value = env.ROUTE_SCOPE?.trim().toLowerCase();
  if (!value) return DEFAULT_ROUTE_SCOPE;
  if (!Object.hasOwn(ROUTE_SCOPES, value)) {
    throw new Error(`ROUTE_SCOPE noto'g'ri: "${value}". Mumkin: ${Object.keys(ROUTE_SCOPES).join(", ")}`);
  }
  return value;
}

// Yuk qaysi davlatdan / davlatga: AI yozgan davlat; yozilmagan bo'lsa — O'zbekiston viloyati bo'lsa O'zbekiston.
// Noma'lum (yo'nalish yozilmagan) — null
export function loadCountry(load, side) {
  const country = load?.[`${side}Country`];
  if (country) return country;
  const region = load?.[`${side}Region`];
  if (!region) return null;
  return region === "xorij" ? "xorij" : HOME_COUNTRY;
}

// "Rossiya → O'zbekiston"
export function routeText(load) {
  return `${loadCountry(load, "from") ?? "?"} → ${loadCountry(load, "to") ?? "?"}`;
}

// Yuk doiradami. Qoidalar ("qoshni" doirasida):
// - ikkala uchi ham O'zbekiston yoki chegaradosh davlatda;
// - kamida bittasi O'zbekistonda: Qozog'iston → Qirg'iziston kabi O'zbekistonga tegmaydigan yuk — yo'q;
// - bir uchi noma'lum bo'lsa, ma'lum uchi bo'yicha (e'londa ba'zan faqat "Toshkentdan" deyiladi).
export function routeInScope(load, scope = DEFAULT_ROUTE_SCOPE) {
  const countries = ROUTE_SCOPES[scope]?.countries;
  if (!countries) return true;
  const ends = [loadCountry(load, "from"), loadCountry(load, "to")].filter(Boolean);
  if (ends.some((country) => !countries.includes(country))) return false;
  return ends.length < 2 || ends.includes(HOME_COUNTRY);
}
