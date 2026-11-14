// Haydovchi profili — bot (chatdagi savol-javob), Mini App (forma) va match.js uchun bitta qoidalar.
// Mini App'dan kelgan ma'lumotga ishonib bo'lmaydi: sanitizeProfile har bir maydonni ro'yxat va chegaradan o'tkazadi.
// Profil ko'rinishi: { vehicle: { truckClass, truckClasses? (bir nechta bo'lsa), bodyType, capacityKg, body, bodyGuess, loadingSides }, fromAreas, toAreas,
//                      domestic, international, routeAt, mode }
// Yo'nalish (fromAreas / toAreas) ro'yxatdan o'tishda so'ralmaydi (Azimjon, 2026-11-07: haydovchi har kuni boshqa joyda) —
// botda «📋 Mos yuklar» bosilganda tanlanadi (routeAt — qachon). Forma saqlaganda eski yo'nalish withRoute bilan qoladi.
import { COUNTRIES, REGIONS, REGION_IDS } from "./regions.js";
import { DEFAULT_ROUTE_SCOPE, scopeCountries, validRouteScope } from "./scope.js";
import { BODY_TYPE_IDS, LOADING_SIDE_IDS, TRUCK_CLASS_IDS, bodyId, needsBodyType, vehicleClasses } from "./vehicles.js";

// Sig'im tugmalari, tonna (do'stimiz va Azimjon aytgan odatdagi qiymatlar; 1 t dan kami formada kg bo'lib yoziladi)
export const CAPACITY_OPTIONS = {
  katta_fura: [20, 25, 30, 35, 40],
  kamaz: [20, 25, 30, 35, 40],
  fura: [20, 22, 24, 25, 26],
  mini_fura: [9, 10, 12, 15],
  katta_isuzu: [6, 7, 8, 9, 10],
  isuzu: [3, 4, 5],
  kichik: [1, 1.5, 2, 2.5, 3],
  labo: [0.3, 0.5, 0.7],
  yengil_avto: [0.2, 0.3, 0.4, 0.5],
};

export const INTL_OPTIONS = {
  yoq: { label: "Faqat O'zbekiston", domestic: true, international: false },
  ham: { label: "O'zbekiston va xalqaro", domestic: true, international: true },
  faqat: { label: "Faqat xalqaro", domestic: false, international: true },
};

// "Xalqaro" savoli yo'nalish doirasiga qarab (scope.js): qoshni — "qo'shni davlatlar", hammasi — "xalqaro",
// ichki — savol yo'q (null): faqat O'zbekiston. → { question, options: { yoq, ham, faqat } } yoki null
export function intlChoices(scope = DEFAULT_ROUTE_SCOPE) {
  const countries = scopeCountries(scope);
  if (countries.length === 0) return null;
  const all = validRouteScope(scope) === "hammasi";
  const abroad = all ? "xalqaro" : "qo'shni davlatlar";
  return {
    question: all ? "Xalqaro yuklar ham kerakmi?" : `Qo'shni davlatlar (${countries.join(", ")}) bilan yuklar ham kerakmi?`,
    options: {
      yoq: { ...INTL_OPTIONS.yoq },
      ham: { ...INTL_OPTIONS.ham, label: `O'zbekiston va ${abroad}` },
      faqat: { ...INTL_OPTIONS.faqat, label: `Faqat ${abroad}` },
    },
  };
}

// Profilning "qayerda ishlaydi" yozuvi: "O'zbekiston va qo'shni davlatlar"
export function intlLabel(profile, scope = DEFAULT_ROUTE_SCOPE) {
  const options = intlChoices(scope)?.options ?? INTL_OPTIONS;
  return (options[intlOption(profile)] ?? INTL_OPTIONS.yoq).label;
}

// Yo'nalishda tanlanadigan joylar: viloyatlar + doiradagi davlatlar ("xorij" — istalgan shunday davlat)
export function areaIds(scope = DEFAULT_ROUTE_SCOPE) {
  const countries = scopeCountries(scope);
  const regions = countries.length ? REGION_IDS : REGION_IDS.filter((id) => id !== "xorij");
  return [...regions, ...countries];
}

export const MODE_OPTIONS = {
  own: "Faqat mashinamga mos yuklar",
  all: "Hamma yuklar",
};

export const SIDE_LABELS = { ust: "Ustidan", orqa: "Orqasidan", ong: "O'ngdan", chap: "Chapdan", yon: "Yonidan" };
// Formadagi yuklash tomonlari (Azimjon, 2026-11-07): «Yonidan» yo'q — haydovchi o'zi o'ng yoki chapni tanlaydi
export const FORM_SIDES = ["ust", "orqa", "ong", "chap"];

// Ruxsat etilgan chegaralar (bundan tashqarisi — yozishda xato)
export const CAPACITY_LIMITS_KG = [100, 60_000];
export const BODY_LIMITS = { lengthM: [1, 20], widthM: [1, 3.2], heightM: [0.5, 4.5] };

// Yo'nalish: viloyat kodi (REGIONS) yoki xorijiy davlat nomi (COUNTRIES) — match.js ikkalasini ham tushunadi
const AREAS = new Set([...REGION_IDS, ...COUNTRIES.map((c) => c.name)]);

// "Andijon vil.", "Qoraqalpog'iston", "Rossiya"
export function regionLabel(id) {
  const region = REGIONS.find((r) => r.id === id);
  return region ? region.name.replace(" viloyati", " vil.").replace(" Respublikasi", "") : id;
}

export function intlOption(profile) {
  return Object.entries(INTL_OPTIONS).find(([, o]) => o.domestic === profile.domestic && o.international === profile.international)?.[0] ?? "yoq";
}

export function emptyProfile() {
  return {
    vehicle: { truckClass: null, bodyType: null, capacityKg: null, body: null, bodyGuess: false, loadingSides: [] },
    fromAreas: [],
    toAreas: [],
    domestic: true,
    international: false,
    routeAt: null,
    mode: "own",
  };
}

// Haydovchi yo'nalishni tanlaganmi («📋 Mos yuklar» da). Tanlamaguncha bot unga yuk yubormaydi — aks holda butun
// O'zbekistondagi yuklar keladi. 2026-11-07 gacha yo'nalish formada edi: shunday profilda routeAt yo'q, joylar bor.
export const routeChosen = (profile) =>
  profile?.routeAt != null || Boolean(profile?.fromAreas?.length) || Boolean(profile?.toAreas?.length);

// Forma (web yoki chatdagi savol-javob) yo'nalishni so'ramaydi — saqlaganda eskisi qoladi.
// Xalqaro yuklar o'chirilsa, yo'nalishdagi xorijiy joylar tashlanadi.
export function withRoute(next, prev) {
  if (!next) return next;
  const areas = (list) => (next.international ? [...(list ?? [])] : (list ?? []).filter((a) => REGION_IDS.includes(a) && a !== "xorij"));
  return { ...next, fromAreas: areas(prev?.fromAreas), toAreas: areas(prev?.toAreas), routeAt: prev?.routeAt ?? null };
}

const inRange = (value, [min, max]) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const pick = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((v) => typeof v === "string" && allowed.has(v)))] : []);

// { lengthM, widthM, heightM } metrda, sm aniqlikda; noto'g'ri bo'lsa null
export function sanitizeBody(body) {
  if (!body || typeof body !== "object") return null;
  const out = {};
  for (const [key, limits] of Object.entries(BODY_LIMITS)) {
    const value = Math.round(Number(body[key]) * 100) / 100;
    if (!inRange(value, limits)) return null;
    out[key] = value;
  }
  return out;
}

// Tashqaridan kelgan profilni tekshiradi. → { profile } yoki { error: "haydovchiga ko'rsatiladigan matn" }
// scope berilsa — yo'nalishlar shu doiraga qisqartiriladi (doiradan tashqaridagi davlat tashlanadi;
// "ichki" doirada xalqaro o'chadi). Berilmasa — ro'yxatdagi hamma davlat.
export function sanitizeProfile(input, { scope } = {}) {
  if (!input || typeof input !== "object") return { error: "Ma'lumot kelmadi" };
  const v = input.vehicle && typeof input.vehicle === "object" ? input.vehicle : {};
  // Bir nechta transport (vehicles.js vehicleClasses): ro'yxat tartibida, takrorsiz; kuzov va sig'im so'ralmaydi
  const chosen = new Set(vehicleClasses(v));
  const classes = TRUCK_CLASS_IDS.filter((id) => chosen.has(id));
  if (classes.length === 0) return { error: "Transport turini tanlang" };
  const intlPart = sanitizeIntl(input, scope);
  if (intlPart.error) return intlPart;
  if (classes.length > 1) {
    return {
      profile: {
        vehicle: { truckClass: classes[0], truckClasses: classes, bodyType: null, capacityKg: null, body: null, bodyGuess: false, loadingSides: [] },
        ...intlPart.value,
      },
    };
  }
  const [truckClass] = classes;
  const hasBody = needsBodyType(truckClass); // yengil mashinada kuzov yo'q

  // "Boshqa" kuzov — match.js uchun "aytilmagan" (null); eski kodlar (bort, tral...) — yangisiga
  const raw = bodyId(v.bodyType);
  const bodyType = !hasBody || raw == null || raw === "boshqa" ? null : raw;
  if (bodyType !== null && !BODY_TYPE_IDS.includes(bodyType)) return { error: "Kuzov turi noto'g'ri" };

  const capacityKg = Math.round(Number(v.capacityKg));
  if (!inRange(capacityKg, CAPACITY_LIMITS_KG)) return { error: "Qancha yuk ko'tarishini kiriting" };

  let body = null;
  if (v.body != null && hasBody) {
    body = sanitizeBody(v.body);
    if (!body) return { error: "Kuzov o'lchami noto'g'ri (uzunligi 1–20, eni 1–3.2, balandligi 0.5–4.5 m)" };
  }

  return {
    profile: {
      vehicle: {
        truckClass,
        bodyType,
        capacityKg,
        body,
        bodyGuess: Boolean(body) && v.bodyGuess === true, // «Bilmayman» — odatdagi o'lcham olindi
        loadingSides: hasBody ? pick(v.loadingSides, new Set(LOADING_SIDE_IDS)) : [],
      },
      ...intlPart.value,
    },
  };
}

// Haydovchi profilining transportdan tashqari qismi: xalqaro, yo'nalish, rejim
function sanitizeIntl(input, scope) {
  const abroad = scope === undefined || scopeCountries(scope).length > 0;
  const domestic = abroad ? input.domestic !== false : true;
  const international = abroad && input.international === true;
  if (!domestic && !international) return { error: "O'zbekiston yoki xalqaro — bittasini tanlang" };
  const areas = scope === undefined ? AREAS : new Set(areaIds(scope));
  return {
    value: {
      fromAreas: pick(input.fromAreas, areas),
      toAreas: pick(input.toAreas, areas),
      domestic,
      international,
      routeAt: Number.isFinite(input.routeAt) && input.routeAt > 0 ? input.routeAt : null,
      mode: "own", // «Qaysi yuklarni yuboraylik» savoli olib tashlandi — faqat mashinaga mos (match.js)
    },
  };
}

// --- Yuk beruvchi profili (rol "yuk_beruvchi") ---
// { fromAreas, toAreas, domestic, international, truckClasses: ["fura", ...], bodyTypes: ["tent", ...] }
//   fromAreas — yuk qayerda yuklanadi (bo'sh mashina shu yerda bo'lishi kerak), toAreas — yuk qayerga boradi;
//   truckClasses / bodyTypes — qanday mashina kerak (bo'sh — istalgani). Moslash: match.js matchTruck.
export function emptyShipperProfile() {
  return { fromAreas: [], toAreas: [], domestic: true, international: false, truckClasses: [], bodyTypes: [] };
}

// Tashqaridan kelgan yuk beruvchi profilini tekshiradi. → { profile } yoki { error }. scope — sanitizeProfile dagidek
export function sanitizeShipperProfile(input, { scope } = {}) {
  if (!input || typeof input !== "object") return { error: "Ma'lumot kelmadi" };
  const abroad = scope === undefined || scopeCountries(scope).length > 0;
  const domestic = abroad ? input.domestic !== false : true;
  const international = abroad && input.international === true;
  if (!domestic && !international) return { error: "O'zbekiston yoki xalqaro — bittasini tanlang" };
  const areas = scope === undefined ? AREAS : new Set(areaIds(scope));
  // "Boshqa" kuzov tanlovda ma'nosiz: e'londa kuzov aytilmasa, u baribir mos keladi
  const bodies = new Set(BODY_TYPE_IDS.filter((id) => id !== "boshqa"));
  return {
    profile: {
      fromAreas: pick(input.fromAreas, areas),
      toAreas: pick(input.toAreas, areas),
      domestic,
      international,
      truckClasses: pick(input.truckClasses, new Set(TRUCK_CLASS_IDS)),
      bodyTypes: pick(Array.isArray(input.bodyTypes) ? input.bodyTypes.map(bodyId) : [], bodies),
    },
  };
}

// Rolga qarab: haydovchi — sanitizeProfile, yuk beruvchi — sanitizeShipperProfile
export function sanitizeProfileFor(role, input, options = {}) {
  if (role === "yuk_beruvchi") return sanitizeShipperProfile(input, options);
  if (role === "haydovchi") return sanitizeProfile(input, options);
  return { error: "Avval kim ekaningizni tanlang: haydovchi yoki yuk beruvchi" };
}

// --- Mini App manzilida (?p=...) profilni olib o'tish: forma haydovchining hozirgi sozlamalari bilan ochiladi ---
function toBase64Url(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeProfile(profile) {
  return toBase64Url(JSON.stringify(profile));
}

// Noto'g'ri yoki buzilgan bo'lsa — null. scope — sanitizeProfile dagidek; role — qaysi profil (standart: haydovchi)
export function decodeProfile(text, { scope, role = "haydovchi" } = {}) {
  if (!text) return null;
  try {
    return sanitizeProfileFor(role, JSON.parse(fromBase64Url(text)), { scope }).profile ?? null;
  } catch {
    return null;
  }
}
