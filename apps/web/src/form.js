// Formaning holati ↔ haydovchi profili. React'siz — node --test bilan tekshiriladi.
// Profil qoidalari @yuk/shared/profile.js da (bot ham xuddi shu qoidalar bilan tekshiradi).
import {
  CAPACITY_LIMITS_KG,
  INTL_OPTIONS,
  REGION_IDS,
  TRUCK_CLASSES,
  emptyProfile,
  intlChoices,
  intlOption,
  sanitizeBody,
  sanitizeProfile,
  vehiclePallets,
  vehicleVolumeM3,
} from "@yuk/shared";

const SIZE_KEYS = ["lengthM", "widthM", "heightM"];
const EMPTY_SIZE = { lengthM: "", widthM: "", heightM: "" };

export const classBody = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.body ?? null;
const number = (text) => Number(String(text).trim().replace(",", "."));
const sameBody = (a, b) => Boolean(a && b) && SIZE_KEYS.every((k) => a[k] === b[k]);

// profile — bot manzilda yuborgan hozirgi sozlamalar (yoki null — yangi haydovchi)
export function formFromProfile(profile) {
  const p = profile ?? emptyProfile();
  const v = p.vehicle;
  const standard = classBody(v.truckClass);
  let sizeMode = "none";
  if (v.body) sizeMode = sameBody(v.body, standard) ? "std" : "custom";
  return {
    truckClass: v.truckClass,
    bodyType: v.bodyType ?? (profile ? "boshqa" : null),
    capacity: v.capacityKg ? String(v.capacityKg / 1000) : "",
    sizeMode,
    size: v.body && sizeMode === "custom" ? Object.fromEntries(SIZE_KEYS.map((k) => [k, String(v.body[k])])) : { ...EMPTY_SIZE },
    loadingSides: [...v.loadingSides],
    fromAreas: [...p.fromAreas],
    toAreas: [...p.toAreas],
    intl: intlOption(p),
    mode: p.mode,
  };
}

// Mashina turi o'zgarsa, sig'im va o'lcham qaytadan tanlanadi (Isuzu sig'imi furaga to'g'ri kelmaydi)
export function selectClass(form, id) {
  if (form.truckClass === id) return form;
  return { ...form, truckClass: id, capacity: "", sizeMode: classBody(id) ? "std" : "none", size: { ...EMPTY_SIZE } };
}

export function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Tanlangan kuzov o'lchami (metr) yoki null
export function formBody(form) {
  if (form.sizeMode === "std") return classBody(form.truckClass);
  if (form.sizeMode === "custom") return sanitizeBody(Object.fromEntries(SIZE_KEYS.map((k) => [k, number(form.size[k])])));
  return null;
}

// "≈ 92 kub · 33 palet" uchun
export function sizeSummary(form) {
  const body = formBody(form);
  if (!body) return null;
  const vehicle = { truckClass: form.truckClass, body };
  return { volumeM3: vehicleVolumeM3(vehicle), pallets: vehiclePallets(vehicle) };
}

// → { profile } yoki { error, field } — field: qaysi bo'limga qaytish kerak
export function profileFromForm(form, scope) {
  if (!form.truckClass) return { error: "Mashina turini tanlang", field: "class" };
  if (!form.bodyType) return { error: "Kuzov turini tanlang", field: "body" };
  const capacityKg = Math.round(number(form.capacity) * 1000);
  if (!(capacityKg >= CAPACITY_LIMITS_KG[0] && capacityKg <= CAPACITY_LIMITS_KG[1])) {
    return { error: "Necha tonna yuk ko'tarishini kiriting (masalan: 7,5)", field: "capacity" };
  }
  const body = formBody(form);
  if (form.sizeMode === "custom" && !body) {
    return { error: "Kuzov o'lchamini to'g'ri yozing: uzunligi 1–20, eni 1–3.2, balandligi 0.5–4.5 metr", field: "size" };
  }
  // scope — yo'nalish doirasi (bot ?s= bilan beradi): doiradan tashqaridagi davlatlar tashlanadi.
  // "ichki" doirada xalqaro savoli yo'q — faqat O'zbekiston
  const options = scope === undefined ? INTL_OPTIONS : (intlChoices(scope)?.options ?? { yoq: INTL_OPTIONS.yoq });
  const intl = options[form.intl] ?? INTL_OPTIONS.yoq;
  // Faqat O'zbekiston tanlansa, oldin belgilangan xorijiy davlatlar tashlanadi
  const areas = (list) => (intl.international ? list : list.filter((a) => REGION_IDS.includes(a)));
  const result = sanitizeProfile({
    vehicle: { truckClass: form.truckClass, bodyType: form.bodyType, capacityKg, body, loadingSides: form.loadingSides },
    fromAreas: areas(form.fromAreas),
    toAreas: areas(form.toAreas),
    domestic: intl.domestic,
    international: intl.international,
    mode: form.mode,
  }, { scope });
  return result.error ? { ...result, field: "class" } : result;
}
