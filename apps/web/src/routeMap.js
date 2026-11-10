// «🗺 Xaritadan tanlash» (RouteMapPage.jsx) uchun: har tanlanadigan joyning xaritadagi nuqtasi va bosilgan joyga
// eng yaqin doira. React'siz va Leaflet'siz — node --test bilan tekshiriladi.
import { COUNTRY_COORDS, REGION_COORDS } from "@yuk/shared";

// Xaritadagi nuqta yuklar xaritasidagidan (geoData.js) biroz farq qiladi — yonma-yon doiralar bir-birini bosib qolmasin:
// Farg'ona vodiysining uch viloyati — viloyat ichida bir-biridan uzoqroq nuqtalar (Chust–Kosonsoy, Andijonning sharqi,
// Rishton tomon; telefonda markazlari bor-yo'g'i ~15 piksel oraliqda edi); Toshkent viloyati — shahar doirasidan
// sharqroqda (Ohangaron tomon); Qozog'iston va Afg'oniston — markazi emas, O'zbekiston chegarasiga yaqin joy
// (aks holda xarita juda kichrayib ketardi)
const DISPLAY = {
  toshkent: [41.0, 70.15],
  andijon: [40.78, 72.55],
  namangan: [41.15, 71.35],
  fargona: [40.35, 71.45],
  "Qozog'iston": [43.1, 68.9],
  "Afg'oniston": [36.7, 67.1],
};

// Joy kodi (viloyat id yoki davlat nomi) → [lat, lon]; "xorij" va noma'lum — null (xarita ostida alohida tugma)
export function areaPoint(id) {
  return DISPLAY[id] ?? REGION_COORDS[id] ?? COUNTRY_COORDS[id] ?? null;
}

// points — [{ id, x, y }] (ekrandagi piksel), click — { x, y }. Bosilgan joydan maxPx gacha bo'lgan doiralar,
// eng yaqini birinchi → [{ id, distance }] (telefonda barmoq kichik doiraga aniq tegmasligi mumkin)
export function areasNear(points, click, maxPx) {
  return points
    .map((point) => ({ id: point.id, distance: Math.hypot(point.x - click.x, point.y - click.y) }))
    .filter((a) => a.distance <= maxPx)
    .sort((a, b) => a.distance - b.distance);
}

export const nearestArea = (points, click, maxPx) => areasNear(points, click, maxPx)[0]?.id ?? null;

// Bosilganda nima qilinadi: { pick: id } — shu joy tanlanadi; { zoom: true } — bir nechta doira orasiga tegdi
// (birortasining ustida emas, hitPx dan uzoq) va xarita hali uzoqda — o'sha joy kattalashtiriladi, tasodifan boshqa
// viloyat tanlanib qolmasin; null — yaqinida doira yo'q
export function tapAction(points, click, { maxPx, hitPx, canZoom }) {
  const [first, second] = areasNear(points, click, maxPx);
  if (!first) return null;
  if (second && first.distance > hitPx && canZoom) return { zoom: true };
  return { pick: first.id };
}
