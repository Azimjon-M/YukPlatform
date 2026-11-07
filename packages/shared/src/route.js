// Haydovchining yo'nalishi: «📍 Qayerdan?» → «🏁 Qayerga?». Ro'yxatdan o'tishda emas — botdagi «📋 Mos yuklar» da va
// web'dagi «📋 Yuklar» bo'limida tanlanadi (Azimjon, 2026-11-07: haydovchi har kuni boshqa joyda bo'ladi).
// Tanlangani profilga yoziladi (fromAreas / toAreas / routeAt): yangi yuklar ham botda shu bo'yicha keladi.
// Bot (apps/bot/src/route.js — tugmalar) va web server (apps/api public.js — /pub/me/route) shu qoidalardan foydalanadi.
import { REGIONS } from "./regions.js";
import { intlChoices, regionLabel } from "./profile.js";
import { matchLoad, routeMatches } from "./match.js";
import { scopeCountries, validRouteScope } from "./scope.js";

// "*" — istalgan joy (ro'yxat bo'sh)
export const ROUTE_ANY = "*";

// Tanlanadigan joylar: [{ id, label }] — viloyat kodi yoki davlat nomi (match.js ikkalasini ham tushunadi).
// «Qayerda ishlaysiz?» ga qarab: faqat O'zbekiston — 14 viloyat; qo'shnilar bilan — davlatlar ham; "hammasi" doirasida — Xorij
export function routeAreas(profile, scope) {
  const regions = REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) }));
  const abroad = Boolean(intlChoices(scope)) && profile?.international === true;
  if (!abroad) return regions;
  if (validRouteScope(scope) === "hammasi") return [...regions, { id: "xorij", label: "🌍 Xorij" }];
  return [...regions, ...scopeCountries(scope).map((name) => ({ id: name, label: `🌍 ${name}` }))];
}

export const routeAreaLabel = (profile, scope, id) =>
  id === ROUTE_ANY ? null : (routeAreas(profile, scope).find((a) => a.id === id)?.label ?? null);
// Tashqaridan kelgan joy (tugma, so'rov) — faqat shu haydovchiga ko'rsatiladiganlardan biri yoki "*"
export const validRouteArea = (profile, scope, id) => id === ROUTE_ANY || routeAreaLabel(profile, scope, id) != null;

// Yo'nalishni profilga yozish
export function applyRoute(profile, from, to, now = Date.now()) {
  return { ...profile, fromAreas: from === ROUTE_ANY ? [] : [from], toAreas: to === ROUTE_ANY ? [] : [to], routeAt: now };
}

// Hozirgi tanlov tugma ko'rinishida: bitta joy — uning kodi, bo'sh — "*", bir nechta (2026-11-07 gacha forma) — null
export function routeSide(profile, side) {
  if (!profile) return null;
  const list = profile[`${side}Areas`] ?? [];
  if (list.length === 1) return list[0];
  return list.length === 0 && profile.routeAt != null ? ROUTE_ANY : null;
}

// Har tugmadagi son: rows — [{ load }] (store.recentLoads), faqat mashinaga sig'adiganlari sanaladi.
// from yo'q — «Qayerdan?» qadami (har joydan → istalgan joyga); bor — «Qayerga?» qadami (shu joydan → har joyga).
// → { areas: [{ id, label, count }], any } — any: «🌐 Hamma joydan» / «🌐 Istalgan joyga» tugmasidagi son
export function routeCounts({ profile, scope, rows, from = null }) {
  const loads = rows.filter((r) => matchLoad(r.load, { ...profile, fromAreas: [], toAreas: [] }).ok);
  const fromAreas = from == null || from === ROUTE_ANY ? [] : [from];
  const count = (fromList, toList) =>
    loads.filter((r) => routeMatches(r.load, { ...profile, fromAreas: fromList, toAreas: toList }).ok).length;
  const areas = routeAreas(profile, scope).map((a) => ({ ...a, count: from == null ? count([a.id], []) : count(fromAreas, [a.id]) }));
  return { areas, any: count(fromAreas, []) };
}
