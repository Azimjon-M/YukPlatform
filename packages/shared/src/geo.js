// Yukning qayerdan / qayerga joyi xaritada: avval shahar, bo'lmasa viloyat, bo'lmasa davlat nuqtasi.
// Koordinatalar geoData.js da (taxminiy, shahar markazi; viloyat va davlat nuqtasi — "exact: false").
import { CITY_COORDS, COUNTRY_COORDS, REGION_COORDS } from "./geoData.js";
import { placeText } from "./loadText.js";
import { lookupCity, placeKey } from "./places.js";
import { HOME_COUNTRY } from "./regions.js";

// hudud (viloyat kodi yoki davlat nomi) → placeKey(shahar) → { name, point }
const INDEX = new Map(
  Object.entries(CITY_COORDS).map(([area, cities]) => [
    area,
    new Map(Object.entries(cities).map(([name, point]) => [placeKey(name), { name, point }])),
  ]),
);

const isRegion = (area) => Object.hasOwn(REGION_COORDS, area);

function cityIn(area, city) {
  const hit = area ? INDEX.get(area)?.get(placeKey(city)) : null;
  return hit ? { ...hit, area } : null;
}

// Shahar nuqtasi: avval yukda yozilgan hududdan; topilmasa — nomi ro'yxatda bitta joyda bo'lsa o'sha joydan
// (AI ba'zan shaharni boshqa viloyatga yozadi; "Almaty" → Olmaota kabi boshqa yozilishlar ham shu yerda tushuniladi)
function cityPoint(city, area) {
  if (!city) return null;
  const direct = cityIn(area, city) ?? (area === "toshkent" ? cityIn("toshkent_sh", city) : area === "toshkent_sh" ? cityIn("toshkent", city) : null);
  if (direct) return direct;
  const found = lookupCity(city);
  if (!found) return null;
  return cityIn(found.region === "xorij" ? found.country : found.region, found.name);
}

// → { key, lat, lon, label, exact } yoki null (joy yozilmagan / bilmaymiz).
// key — bir joydagi yuklarni guruhlash uchun; label — "Farg'ona, Qo'qon", "Surxondaryo viloyati", "Qozog'iston"
export function placePoint(load, side) {
  const region = load?.[`${side}Region`] ?? null;
  const country = load?.[`${side}Country`] ?? null;
  // "Toshkent shahri" deb yozilgan bo'lsa — Toshkentning o'zi
  const city = load?.[`${side}City`] || (region === "toshkent_sh" ? "Toshkent" : null);
  const foreign = region === "xorij" || (country != null && country !== HOME_COUNTRY);
  const area = foreign ? country : region;

  const hit = cityPoint(city, area);
  if (hit) {
    const fields = isRegion(hit.area)
      ? { [`${side}City`]: hit.name, [`${side}Region`]: hit.area }
      : { [`${side}City`]: hit.name, [`${side}Region`]: "xorij", [`${side}Country`]: hit.area };
    return { key: `${hit.area}|${hit.name}`, lat: hit.point[0], lon: hit.point[1], label: placeText(fields, side), exact: true };
  }
  if (!foreign && isRegion(region)) {
    const [lat, lon] = REGION_COORDS[region];
    return { key: `region:${region}`, lat, lon, label: placeText({ [`${side}Region`]: region }, side), exact: false };
  }
  if (foreign && country && COUNTRY_COORDS[country]) {
    const [lat, lon] = COUNTRY_COORDS[country];
    return { key: `country:${country}`, lat, lon, label: country, exact: false };
  }
  return null;
}

// Ikki nuqta orasidagi masofa, km (haversine). Burçlar gradusda.
// Yuk beruvchi xaritadan tanlagan nuqtaga necha km yaqinligini ko'rsatish uchun (Azimjon, 2026-11-12).
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
