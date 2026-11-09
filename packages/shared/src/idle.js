// Avtomatik pauza (Azimjon, 2026-11-09): «yoqish / to'xtatishni faqat foydalanuvchi hal qiladi», bizdan esa — faol
// bo'lmaganlarga yuborishni o'zi to'xtatish. Uning tanlovi: 24 soat botga kirmasa — ogohlantirish, 48 soatda — pauza.
// «Kirdi» = botga yozdi, tugma bosdi yoki web'ni ochdi (drivers.seen_at). Telegram bot'ga chat ochilganini aytmaydi,
// haydovchi yukdagi raqamni bossa ham bot buni ko'rmaydi — shuning uchun ogohlantirishda bitta tugma bor.
// Bot (apps/bot idle.js) har 10 daqiqada tekshiradi, boshqaruv markazi shu funksiya bilan «qachon pauza bo'ladi» ni ko'rsatadi.

const HOUR = 60 * 60 * 1000;
export const IDLE_WARN_MS = 24 * HOUR; // shuncha kirmasa — ogohlantirish
export const IDLE_PAUSE_MS = 48 * HOUR; // shuncha kirmasa — pauza
// Ogohlantirishdan pauzagacha kamida shuncha (ogohlantirish «yana 24 soat» deydi; bot to'xtab qolgan bo'lsa ham
// ikkalasi ketma-ket kelmasin)
export const IDLE_NOTICE_MS = 24 * HOUR;

// user — store'dagi foydalanuvchi: { active, profile, deletedAt, seenAt, createdAt, idleWarnedAt }.
// since — kuzatuv boshlangan vaqt (settings.idle_since; seen_at 2026-11-09 dan yoziladi — undan oldingilar uchun
// soat shu paytdan boshlanadi, hech kim birinchi kunning o'zida pauza bo'lmaydi).
// → { lastSeen, warned, warnAt, pauseAt, action: "warn" | "pause" | null }
export function idleState(user, now, since = null) {
  const none = { lastSeen: null, warned: false, warnAt: null, pauseAt: null, action: null };
  // Pauzadagi, ro'yxatdan o'tmagan yoki hisobini o'chirgan foydalanuvchiga yuk baribir bormaydi
  if (!user?.active || !user.profile || user.deletedAt != null) return none;
  const lastSeen = Math.max(user.seenAt ?? 0, user.createdAt ?? 0, since ?? 0);
  if (!lastSeen) return none;
  // Ogohlantirish shu «jim» davr ichida bo'lganmi (keyin kirgan bo'lsa — yangi davr, eski ogohlantirish hisob emas)
  const warned = user.idleWarnedAt != null && user.idleWarnedAt >= lastSeen;
  const warnAt = lastSeen + IDLE_WARN_MS;
  const pauseAt = warned ? Math.max(lastSeen + IDLE_PAUSE_MS, user.idleWarnedAt + IDLE_NOTICE_MS) : lastSeen + IDLE_PAUSE_MS;
  const action = !warned ? (now >= warnAt ? "warn" : null) : now >= pauseAt ? "pause" : null;
  return { lastSeen, warned, warnAt, pauseAt, action };
}
