// Formaning holati ↔ haydovchi yoki yuk beruvchi profili. React'siz — node --test bilan tekshiriladi.
// Profil qoidalari @yuk/shared/profile.js da (bot ham xuddi shu qoidalar bilan tekshiradi).
import {
  CAPACITY_LIMITS_KG,
  FEED_MODES,
  FEED_SOURCES_MAX,
  FORM_SIDES,
  INTL_OPTIONS,
  REGION_IDS,
  TRUCK_CLASSES,
  bodyId,
  bodyTypeOf,
  choiceMode,
  NEW_DRIVER_FEED_MODE,
  countsPallets,
  emptyProfile,
  emptyShipperProfile,
  feedOf,
  intlChoices,
  intlOption,
  needsBodyType,
  needsSides,
  needsSize,
  sanitizeBody,
  sanitizeFeed,
  sanitizeProfile,
  sanitizeShipperProfile,
  vehiclePallets,
  vehicleClasses,
  vehicleVolumeM3,
} from "@yuk/shared";

const SIZE_KEYS = ["lengthM", "widthM", "heightM"];
const EMPTY_SIZE = { lengthM: "", widthM: "", heightM: "" };

export const classBody = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.body ?? null;
const number = (text) => Number(String(text).trim().replace(",", "."));
const sameBody = (a, b) => Boolean(a && b) && SIZE_KEYS.every((k) => a[k] === b[k]);
const decimal = (n) => String(n).replace(".", ",");

// Yuk ko'tarish qaysi birlikda yoziladi: 1 tonnagacha (Labo, yengil mashina) — kg, qolgani — tonna
export const capacityUnit = (classId) => ((TRUCK_CLASSES.find((t) => t.id === classId)?.capacityT[1] ?? 1) < 1 ? "kg" : "tonna");

// Formadagi matn → kg. Birlik adashsa ham to'g'ri: tonna joyiga 700 yozilsa — 700 kg, kg joyiga 0,7 — 700 kg
// (yuk ko'tarish 100 kg dan 60 tonnagacha, shuning uchun 100 dan katta son — kg, 100 dan kichigi — tonna)
export function capacityKgOf(text, unit) {
  const n = number(text);
  if (!(n > 0)) return NaN;
  if (unit === "kg") return Math.round(n < 10 ? n * 1000 : n);
  return Math.round(n >= 100 ? n : n * 1000);
}

// kg → formadagi matn (shu transportning birligida)
const capacityInput = (kg, unit) => (kg ? (unit === "kg" ? String(kg) : decimal(kg / 1000)) : "");

// Tugmadagi tonna (CAPACITY_OPTIONS) → formadagi matn
export const capacityChoice = (tonnes, unit) => capacityInput(Math.round(tonnes * 1000), unit);

// profile — bot manzilda yuborgan hozirgi sozlamalar (yoki null — yangi haydovchi).
// Yo'nalish formada yo'q — u botdagi «📋 Mos yuklar» da tanlanadi (saqlaganda server eskisini qoldiradi)
export function formFromProfile(profile) {
  const p = profile ?? emptyProfile();
  // «⚡ Tezkor» / «📌 Mening guruhlarim» da mashina kiritilmagan bo'lishi mumkin — forma bo'sh mashina bilan ochiladi
  const v = p.vehicle ?? emptyProfile().vehicle;
  const feed = feedOf(p);
  const standard = classBody(v.truckClass);
  // «Bilmayman» — odatdagi o'lcham olinadi; eski profilda o'lcham yo'q bo'lsa ham shu
  let sizeMode = standard ? "std" : "none";
  if (v.bodyGuess || (profile && !v.body)) sizeMode = "none";
  else if (v.body && !sameBody(v.body, standard)) sizeMode = "custom";
  // "Yonidan" formada yo'q: eski profilda bo'lsa — o'ng va chap
  const sides = (v.loadingSides ?? []).flatMap((s) => (s === "yon" ? ["ong", "chap"] : [s])).filter((s) => FORM_SIDES.includes(s));
  const classes = vehicleClasses(v);
  return {
    // Bir nechta transport belgilash mumkin (vehicles.js vehicleClasses); truckClass — faqat bittasi belgilanganda
    truckClasses: [...classes],
    truckClass: classes.length === 1 ? classes[0] : null,
    bodyType: v.bodyType ? bodyId(v.bodyType) : null,
    capacity: capacityInput(v.capacityKg, capacityUnit(v.truckClass)),
    sizeMode,
    size: v.body && sizeMode === "custom" ? Object.fromEntries(SIZE_KEYS.map((k) => [k, decimal(v.body[k])])) : { ...EMPTY_SIZE },
    loadingSides: [...new Set(sides)],
    intl: intlOption(p),
    // Yetkazish rejimi (@yuk/shared feed.js): saralangan | tezkor | guruhlarim | guruhlarim_plus va tanlangan guruhlar
    // 2026-11-19: faqat tezkor va guruhlarim tanlanadi — eski saralangan (va yangi foydalanuvchi) — tezkor
    feed: choiceMode(feed.mode),
    feedSources: [...feed.sources],
    // Filtrlar (2026-11-19): «📍 Qayerdan» va «🚚 Transport turi» — ixtiyoriy, bo'sh — hammasi
    feedRegions: [...(feed.regions ?? [])],
    feedTrucks: [...(feed.trucks ?? [])],
  };
}

// Rejim tanlandi. Guruhlar tanlovi qoladi (rejim yana guruhlisiga qaytsa — qayta belgilash shart emas)
export const selectFeed = (form, mode) => ({ ...form, feed: mode });

// Guruhni belgilash / olib tashlash → { form } yoki { error } (ko'pi bilan FEED_SOURCES_MAX ta)
export function toggleFeedSource(form, name) {
  const key = name.toLowerCase();
  const has = form.feedSources.some((n) => n.toLowerCase() === key);
  if (has) return { form: { ...form, feedSources: form.feedSources.filter((n) => n.toLowerCase() !== key) } };
  if (form.feedSources.length >= FEED_SOURCES_MAX) return { error: `Ko'pi bilan ${FEED_SOURCES_MAX} ta guruh tanlash mumkin` };
  return { form: { ...form, feedSources: [...form.feedSources, name] } };
}

// Rejimga mashina kerakmi (saralangan va «+ saralangan» — ha; tezkor va guruhlarim — yo'q)
export const formNeedsVehicle = (form) => FEED_MODES[form.feed]?.vehicle ?? true;
export const formUsesGroups = (form) => Boolean(FEED_MODES[form.feed]?.groups);
// Filtrlar (qayerdan, transport turi) — mashinasiz (tezkor) rejimlarda
export const formUsesFilters = (form) => !formNeedsVehicle(form);
export const formUsesRegions = formUsesFilters;
const toggled = (list = [], id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
// Viloyat / transport turini belgilash / olib tashlash
export const toggleFeedRegion = (form, id) => ({ ...form, feedRegions: toggled(form.feedRegions, id) });
export const toggleFeedTruck = (form, id) => ({ ...form, feedTrucks: toggled(form.feedTrucks, id) });

// Faqat shu transport turi. Turi o'zgarsa, sig'im va o'lcham qaytadan tanlanadi (Isuzu sig'imi furaga to'g'ri kelmaydi);
// yengil mashinada kuzov yo'q
export function selectClass(form, id) {
  if (form.truckClass === id && form.truckClasses?.length === 1) return form;
  return withClasses(form, [id]);
}

// Belgilash / olib tashlash (chekbox). Bir nechta belgilansa — kuzov, sig'im, o'lcham so'ralmaydi
export function toggleClass(form, id) {
  return withClasses(form, toggle(form.truckClasses ?? [], id));
}

function withClasses(form, picked) {
  const classes = TRUCK_CLASSES.map((t) => t.id).filter((id) => picked.includes(id));
  const single = classes.length === 1 ? classes[0] : null;
  const next = { ...form, truckClasses: classes, truckClass: single };
  if (single === form.truckClass) return next; // bittasi o'sha-o'sha — kiritilganlar qoladi
  return {
    ...next,
    bodyType: !single || needsBodyType(single) ? form.bodyType : null,
    capacity: "",
    sizeMode: classBody(single) ? "std" : "none",
    size: { ...EMPTY_SIZE },
  };
}

// Bir nechta transport belgilanganmi (unda kuzov turi, sig'im va o'lcham so'ralmaydi)
export const manyClassesPicked = (form) => (form.truckClasses?.length ?? 0) > 1;

// Kuzov o'lchami va yuklash tomoni so'raladimi (tyagach, sisterna, yengil mashinada, bir nechta transportda — yo'q)
export const showSize = (form) => Boolean(form.truckClass) && needsSize(form.truckClass, form.bodyType);
export const showSides = (form) => Boolean(form.truckClass) && needsSides(form.truckClass, form.bodyType);

export function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Tanlangan kuzov o'lchami (metr) yoki null. «Standart» va «Bilmayman» — transport turining odatdagi o'lchami
export function formBody(form) {
  if (!showSize(form)) return null;
  if (form.sizeMode === "std" || form.sizeMode === "none") return classBody(form.truckClass);
  if (form.sizeMode === "custom") return sanitizeBody(Object.fromEntries(SIZE_KEYS.map((k) => [k, number(form.size[k])])));
  return null;
}

// "≈ 92 kub · 33 palet" uchun (samosval, sisterna... — paletsiz)
export function sizeSummary(form) {
  const body = formBody(form);
  if (!body) return null;
  const vehicle = { truckClass: form.truckClass, bodyType: form.bodyType, body };
  return { volumeM3: vehicleVolumeM3(vehicle), pallets: countsPallets(form.bodyType) ? vehiclePallets(vehicle) : null };
}

export const bodyNote = (id) => bodyTypeOf(id)?.sub ?? null;

// "Qayerda ishlaydi" tanlovi. scope — yo'nalish doirasi (bot ?s= bilan beradi): doiradan tashqaridagi davlatlar tashlanadi;
// "ichki" doirada xalqaro savoli yo'q — faqat O'zbekiston. areas(list) — faqat O'zbekiston tanlansa,
// oldin belgilangan xorijiy davlatlarni tashlaydi
function intlFor(id, scope) {
  const options = scope === undefined ? INTL_OPTIONS : (intlChoices(scope)?.options ?? { yoq: INTL_OPTIONS.yoq });
  const intl = options[id] ?? INTL_OPTIONS.yoq;
  return { intl, areas: (list) => (intl.international ? list : list.filter((a) => REGION_IDS.includes(a))) };
}

// → { profile } yoki { error, field } — field: qaysi bo'limga qaytish kerak.
// Yo'nalish bo'sh ketadi: server (va bot) saqlaganda haydovchining «📋 Mos yuklar» dagi yo'nalishini qoldiradi
export function profileFromForm(form, scope) {
  const { intl } = intlFor(form.intl, scope);
  // Rejim birinchi tekshiriladi: ro'yxatdan o'tishda u birinchi qadam (guruhsiz «Mening guruhlarim» — o'sha qadamga qaytadi)
  const feedPart = sanitizeFeed({ mode: form.feed ?? NEW_DRIVER_FEED_MODE, sources: form.feedSources ?? [], regions: form.feedRegions ?? [], trucks: form.feedTrucks ?? [] });
  if (feedPart.error) return feedPart;
  const common = { fromAreas: [], toAreas: [], domestic: intl.domestic, international: intl.international, feed: feedPart.feed };
  const result = vehicleProfile(form, scope, common);
  if (!result.error || formNeedsVehicle(form)) return result;
  // Mashina shart bo'lmagan rejim: mashina to'liq kiritilgan bo'lsa — saqlanadi (saralanganga qaytsa so'ralmaydi), aks holda — mashinasiz
  return sanitizeProfile({ vehicle: null, ...common }, { scope });
}

// Mashina bo'limlari → { profile } | { error, field }
function vehicleProfile(form, scope, common) {
  if (manyClassesPicked(form)) {
    const result = sanitizeProfile({ vehicle: { truckClasses: form.truckClasses }, ...common }, { scope });
    return result.error ? { ...result, field: "class" } : result;
  }
  if (!form.truckClass) return { error: "Transport turini tanlang", field: "class" };
  if (needsBodyType(form.truckClass) && !form.bodyType) return { error: "Kuzov turini tanlang", field: "body" };
  const unit = capacityUnit(form.truckClass);
  const capacityKg = capacityKgOf(form.capacity, unit);
  if (!(capacityKg >= CAPACITY_LIMITS_KG[0] && capacityKg <= CAPACITY_LIMITS_KG[1])) {
    const example = unit === "kg" ? "400 kg" : "7,5 tonna";
    return { error: `Qancha yuk ko'tarishini kiriting (masalan: ${example})`, field: "capacity" };
  }
  const body = formBody(form);
  if (showSize(form) && form.sizeMode === "custom" && !body) {
    return { error: "Kuzov o'lchamini to'g'ri yozing: uzunligi 1–20, eni 1–3,2, balandligi 0,5–4,5 metr", field: "size" };
  }
  const result = sanitizeProfile(
    {
      vehicle: {
        truckClass: form.truckClass,
        bodyType: needsBodyType(form.truckClass) ? form.bodyType : null,
        capacityKg,
        body,
        bodyGuess: Boolean(body) && form.sizeMode === "none",
        loadingSides: showSides(form) ? form.loadingSides : [],
      },
      ...common,
    },
    { scope },
  );
  return result.error ? { ...result, field: "class" } : result;
}

// --- Yuk beruvchi (rol "yuk_beruvchi"): yuk qayerda va qayerga, qanday mashina va kuzov kerak ---
export function shipperFormFromProfile(profile) {
  const p = profile ?? emptyShipperProfile();
  return {
    fromAreas: [...p.fromAreas],
    toAreas: [...p.toAreas],
    intl: intlOption(p),
    truckClasses: [...p.truckClasses],
    bodyTypes: [...p.bodyTypes],
  };
}

// → { profile } yoki { error }. Hech narsa tanlanmasa — hammasi (istalgan joy, istalgan mashina)
export function shipperProfileFromForm(form, scope) {
  const { intl, areas } = intlFor(form.intl, scope);
  return sanitizeShipperProfile(
    {
      fromAreas: areas(form.fromAreas),
      toAreas: areas(form.toAreas),
      domestic: intl.domestic,
      international: intl.international,
      truckClasses: form.truckClasses,
      bodyTypes: form.bodyTypes,
    },
    { scope },
  );
}
