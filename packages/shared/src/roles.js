// Foydalanuvchi rollari va obuna (bot, haydovchilar serveri va web uchun bitta qoidalar).
//
// Rol — kim nima oladi:
//   haydovchi     — "yuk bor, mashina kerak" e'lonlari (mashinasi va yo'nalishiga mos)
//   yuk_beruvchi  — "mashina bo'sh, yuk kerak" e'lonlari (yuk egasi yoki dispetcher, o'z yo'nalishida)
// Admin — rol emas, qo'shimcha huquq: .env dagi ADMIN_IDS yoki boshqaruv markazida (localhost) yoqilgan belgi.
// Haydovchi suhbati (docs/haydovchi-suhbati.md §6): haydovchilar ish beruvchi bilan to'g'ridan-to'g'ri bog'lanishni xohlaydi.

export const ROLES = {
  haydovchi: {
    icon: "🚚",
    name: "Haydovchi",
    choice: "🚚 Haydovchiman — yuk qidiraman",
    gets: "yuk bor e'lonlari (mashinangiz va yo'nalishingizga mos)",
  },
  yuk_beruvchi: {
    icon: "📦",
    name: "Yuk beruvchi",
    choice: "📦 Yuk beruvchiman — mashina qidiraman",
    gets: "bo'sh mashina e'lonlari (yo'nalishingiz bo'yicha)",
  },
};
export const ROLE_IDS = Object.keys(ROLES);
export const DEFAULT_ROLE = "haydovchi";

export const validRole = (role) => (ROLE_IDS.includes(role) ? role : null);

// Rol ustuni bo'lmagan eski yozuv: profili bo'lsa — haydovchi (rollardan oldin hamma haydovchi edi)
export const roleOf = (user) => validRole(user?.role) ?? (user?.profile ? DEFAULT_ROLE : null);

// Qaysi turdagi e'lon shu rolga boradi: haydovchi → yuk (loads.kind = "yuk"), yuk beruvchi → mashina
export const ROLE_KIND = { haydovchi: "yuk", yuk_beruvchi: "mashina" };
export const KIND_ROLE = { yuk: "haydovchi", mashina: "yuk_beruvchi" };

// --- Obuna ---
// free — bepul; pro — boshqaruv markazidan beriladi (Azimjon, 2026-11-16: «Yopiq guruhlardagi e'lonlar faqat men pro
// beradigan foydalanuvchilarga … tekin e'lonlar va yopiq/pulli e'lonlar aralashib ketmasin»)
export const PLANS = {
  free: { name: "Bepul" },
  pro: { name: "Pro" },
};
export const DEFAULT_PLAN = "free";
export const PLAN_IDS = Object.keys(PLANS);

// Yopiq guruh (qo'shimcha Telegram akkaunt o'qiydi): manba nomi raqam (-100…), ochiq guruh esa @nomi.
// Yuk beruvchining o'zi yuborgan yuk (source null yoki "shipper:…") — ochiq
export const isClosedSource = (source) => typeof source === "string" && /^-\d+$/.test(source);

// Pro: boshqaruv markazidan berilgan (plan) yoki avtomatik — raqamini ulashgan va Telegram akkauntini bog'lagan
// (store AUTO_PRO_SQL → user.autoPro)
export const isPro = (user) => user?.plan === "pro" || user?.autoPro === true;

// Shu e'lon shu foydalanuvchiga ko'rsatilsin / yuborilsinmi.
// Yopiq guruhdan — faqat Pro obunadagilarga va shu guruhni o'z akkaunti bilan qo'shgan odamning o'ziga (owner — sources.added_by).
// Ochiq guruhlardan — hammaga. kind, now — keyingi rejalar uchun (masalan, free: kechikib)
// eslint-disable-next-line no-unused-vars
export function planAllows(user, { kind, now, source = null, owner = null } = {}) {
  if (!isClosedSource(source)) return true;
  if (isPro(user)) return true;
  return owner != null && user?.chatId != null && Number(owner) === Number(user.chatId);
}

// Ro'yxat uchun (web «📋 Yuklar», xarita, botdagi «📋 Mos yuklar»): source → ko'rsatilsinmi.
// ownerOf(source) — store.sourceOwner; har yopiq guruh bir marta so'raladi
export function planFilter(user, ownerOf) {
  const owners = new Map();
  return (source) => {
    if (!isClosedSource(source)) return true;
    if (!owners.has(source)) owners.set(source, ownerOf?.(source) ?? null);
    return planAllows(user, { source, owner: owners.get(source) });
  };
}

// --- Blok (boshqaruv markazidan; Azimjon, 2026-11-09) ---
// Bloklangan odam botga nima yozsa ham shu javob (bot.js), web/Mini App esa shu matnli ekran (apps/api public.js 403 "blocked")
export const BLOCKED_TEXT = "Uzr, sizga xizmat ko'rsata olmaymiz!";

// --- Admin ---
// adminIds — .env dagi ADMIN_IDS (raqamlar ro'yxati). user.isAdmin — boshqaruv markazida yoqilgan belgi.
export function isAdmin(user, adminIds = []) {
  if (!user) return false;
  return user.isAdmin === true || adminIds.includes(Number(user.chatId));
}

// "123, 456 789" → [123, 456, 789]
export function parseAdminIds(text) {
  return String(text ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);
}
