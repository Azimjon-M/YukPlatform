// Foydalanuvchi tarixi (user_events jadvali, 2026-11-09): boshqaruv markazidagi «Batafsil» → «Tarix».
// Azimjon: «foydalanuvchilar haqida to'liq ma'lumot kerak — hatto hisobini o'chirsa ham; qayta ochsa — necha marta
// o'chirib qaytgani». saveDriver har safar oldingi va keyingi holatni shu funksiyaga beradi; nima o'zgargan bo'lsa —
// voqea yoziladi. Ism yoki username yangilanishi (har xabarda) voqea emas.
// Alohida yoziladigan voqealar (store'ning o'z funksiyalarida): signout, deleted, returned.

// Yo'nalish maydonlari: «Mos yuklar» da tanlanadi — ularning o'zgarishi «route», qolgani «settings»
const ROUTE_KEYS = new Set(["fromAreas", "toAreas", "routeAt"]);
const withoutRoute = (profile) => JSON.stringify(Object.entries(profile ?? {}).filter(([k]) => !ROUTE_KEYS.has(k)));

// before — o'zgarishdan oldingi foydalanuvchi (yangi bo'lsa null), after — keyingisi (store driverRow ko'rinishida).
// why — nega (ixtiyoriy): "blocked" — bot yubora olmadi (403), "admin" — boshqaruv markazidan.
// → [{ type, detail }] — detail JSON'ga yoziladi (null bo'lishi mumkin)
export function userEvents(before, after, why = null) {
  if (!after) return [];
  if (!before) {
    // Yangi foydalanuvchi; birinchi yozuvdayoq rol / sozlamalar / raqam bo'lsa — ular ham tarixda
    const events = [{ type: "joined", detail: null }];
    if (after.role) events.push({ type: "role", detail: { from: null, to: after.role, restored: false } });
    if (after.role && after.profile) events.push({ type: "registered", detail: { role: after.role } });
    if (after.phone) events.push({ type: "phone", detail: { phone: after.phone } });
    if (after.isAdmin) events.push({ type: "admin", detail: { on: true } });
    return events;
  }
  const events = [];
  const sameRole = before.role === after.role && after.role != null;

  if (after.role && after.role !== before.role) {
    // switchRole: rol tanlandi yoki almashdi; shu rolda avval to'ldirgan bo'lsa — sozlamalari tiklandi
    events.push({ type: "role", detail: { from: before.role ?? null, to: after.role, restored: after.profile != null } });
  }
  if (sameRole && !before.profile && after.profile) events.push({ type: "registered", detail: { role: after.role } });
  if (sameRole && before.profile && after.profile && withoutRoute(before.profile) !== withoutRoute(after.profile)) {
    events.push({ type: "settings", detail: { role: after.role } });
  }
  const routeAt = after.profile?.routeAt ?? null;
  if (routeAt != null && routeAt !== (before.profile?.routeAt ?? null)) {
    events.push({ type: "route", detail: { fromAreas: after.profile.fromAreas ?? [], toAreas: after.profile.toAreas ?? [] } });
  }
  // Pauza / davom: faqat rol o'zgarmaganda (rol almashishi va hisobdan chiqish o'zi active'ni o'zgartiradi)
  if (sameRole && before.active !== after.active) {
    if (!after.active && why === "blocked") events.push({ type: "blocked", detail: null });
    // by: "idle" — 48 soat kirmagani uchun avtomatik, "admin" — boshqaruv markazidan (eski); berilmasa — o'zi
    else events.push({ type: after.active ? "resumed" : "paused", detail: why === "admin" || why === "idle" ? { by: why } : null });
  }
  if (after.phone && after.phone !== before.phone) events.push({ type: "phone", detail: { phone: after.phone } });
  if (!after.phone && before.phone) events.push({ type: "phone_removed", detail: null });
  if (before.isAdmin !== after.isAdmin) events.push({ type: "admin", detail: { on: after.isAdmin } });
  return events;
}
