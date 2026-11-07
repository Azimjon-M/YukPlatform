// Formaning holati ↔ haydovchi yoki yuk beruvchi profili. React'siz — node --test bilan tekshiriladi.
// Profil qoidalari @yuk/shared/profile.js da (bot ham xuddi shu qoidalar bilan tekshiradi).
import {
  CAPACITY_LIMITS_KG,
  FORM_SIDES,
  INTL_OPTIONS,
  REGION_IDS,
  TRUCK_CLASSES,
  bodyId,
  bodyTypeOf,
  countsPallets,
  emptyProfile,
  emptyShipperProfile,
  intlChoices,
  intlOption,
  needsBodyType,
  needsSides,
  needsSize,
  sanitizeBody,
  sanitizeProfile,
  sanitizeShipperProfile,
  vehiclePallets,
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
  const v = p.vehicle;
  const standard = classBody(v.truckClass);
  // «Bilmayman» — odatdagi o'lcham olinadi; eski profilda o'lcham yo'q bo'lsa ham shu
  let sizeMode = standard ? "std" : "none";
  if (v.bodyGuess || (profile && !v.body)) sizeMode = "none";
  else if (v.body && !sameBody(v.body, standard)) sizeMode = "custom";
  // "Yonidan" formada yo'q: eski profilda bo'lsa — o'ng va chap
  const sides = (v.loadingSides ?? []).flatMap((s) => (s === "yon" ? ["ong", "chap"] : [s])).filter((s) => FORM_SIDES.includes(s));
  return {
    truckClass: v.truckClass,
    bodyType: v.bodyType ? bodyId(v.bodyType) : null,
    capacity: capacityInput(v.capacityKg, capacityUnit(v.truckClass)),
    sizeMode,
    size: v.body && sizeMode === "custom" ? Object.fromEntries(SIZE_KEYS.map((k) => [k, decimal(v.body[k])])) : { ...EMPTY_SIZE },
    loadingSides: [...new Set(sides)],
    intl: intlOption(p),
  };
}

// Transport turi o'zgarsa, sig'im va o'lcham qaytadan tanlanadi (Isuzu sig'imi furaga to'g'ri kelmaydi);
// yengil mashinada kuzov yo'q
export function selectClass(form, id) {
  if (form.truckClass === id) return form;
  return {
    ...form,
    truckClass: id,
    bodyType: needsBodyType(id) ? form.bodyType : null,
    capacity: "",
    sizeMode: classBody(id) ? "std" : "none",
    size: { ...EMPTY_SIZE },
  };
}

// Kuzov o'lchami va yuklash tomoni so'raladimi (tyagach, sisterna, yengil mashinada — yo'q)
export const showSize = (form) => needsSize(form.truckClass, form.bodyType);
export const showSides = (form) => needsSides(form.truckClass, form.bodyType);

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
  const { intl } = intlFor(form.intl, scope);
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
      fromAreas: [],
      toAreas: [],
      domestic: intl.domestic,
      international: intl.international,
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
