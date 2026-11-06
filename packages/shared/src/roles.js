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
// Pullik obuna hali yo'q (Azimjon: "qachondir qilamiz, hozir emas — joy qo'yib qo'y").
// Keyin shu yerga reja qo'shiladi (masalan, pro: darhol; free: kechikib yoki kuniga N ta) va planAllows o'zgaradi.
export const PLANS = {
  free: { name: "Bepul" },
};
export const DEFAULT_PLAN = "free";

// Shu foydalanuvchiga hozir yuborilsinmi. Hozircha hamma uchun ha.
// kind — "yuk" | "mashina", now — vaqt (keyin kechiktirish hisoblanganda kerak bo'ladi)
// eslint-disable-next-line no-unused-vars
export function planAllows(user, { kind, now } = {}) {
  return true;
}

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
