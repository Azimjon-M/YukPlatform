// Yozuv qatori ostidagi doimiy menyu (reply keyboard). Tugma bosilsa, chatga oddiy matn ketadi va bot uni hears() bilan ushlaydi.
// Sozlamalar tugmasi Mini App'ni ochadi (MINIAPP_URL yoki tunnel bo'lsa). Forma ma'lumotni sendData bilan qaytaradi —
// Telegram buni faqat shu pastki menyudagi tugmadan ochilgan Mini App uchun ruxsat beradi.
// Menyu rolga qarab: haydovchi — «📋 Mos yuklar», yuk beruvchi — «🚚 Bo'sh mashinalar»; adminga — «🛠 Boshqaruv».
import { Keyboard } from "grammy";
import { encodeProfile, roleOf } from "@yuk/shared";

export const MENU = {
  loads: "📋 Mos yuklar",
  trucks: "🚚 Bo'sh mashinalar",
  settings: "⚙️ Sozlamalar",
  register: "🚚 Ro'yxatdan o'tish",
  pause: "⏸ Pauza",
  resume: "▶️ Davom ettirish",
  apps: "📱 Ilovalar",
  help: "❓ Yordam",
  admin: "🛠 Boshqaruv",
};

// Mini App manzili. Foydalanuvchining hozirgi sozlamalari ?p= ichida — forma oldindan to'ldirilib ochiladi.
// ?s= — yo'nalish doirasi (.env dagi ROUTE_SCOPE): forma faqat shu doiradagi davlatlarni ko'rsatadi.
// ?r= — rol (haydovchi | yuk_beruvchi): server bilan aloqa bo'lmasa ham to'g'ri forma ochilsin.
// ?v= — qaysi bo'lim bilan ochiladi: sozlamalar (standart) yoki admin
export function miniAppUrl(base, profile, scope = null, { view = "sozlamalar", role = null } = {}) {
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("v", view);
  if (role) url.searchParams.set("r", role);
  if (profile) url.searchParams.set("p", encodeProfile(profile));
  if (scope) url.searchParams.set("s", scope);
  return url.toString();
}

export const settingsLabel = (driver) => (driver?.profile ? MENU.settings : MENU.register);

// Rolga qarab birinchi tugma: haydovchi — mos yuklar, yuk beruvchi — bo'sh mashinalar
export const matchesLabel = (driver) => (roleOf(driver) === "yuk_beruvchi" ? MENU.trucks : MENU.loads);

// driver — bazadagi foydalanuvchi (yoki null), miniappUrl — config / tunnel'dan; admin — «🛠 Boshqaruv» tugmasi
export function mainMenu(driver, miniappUrl, scope = null, { admin = false } = {}) {
  const label = settingsLabel(driver);
  const role = roleOf(driver);
  // Rol tanlanmagan bo'lsa — oddiy tugma: bot avval "Siz kimsiz?" deb so'raydi
  const url = role ? miniAppUrl(miniappUrl, driver?.profile ?? null, scope, { role }) : null;
  const keyboard = new Keyboard().text(matchesLabel(driver));
  if (url) keyboard.webApp(label, url);
  else keyboard.text(label);
  const paused = Boolean(driver?.profile) && driver.active === false;
  keyboard
    .row()
    .text(paused ? MENU.resume : MENU.pause)
    .text(MENU.apps)
    .row()
    .text(MENU.help);
  // Boshqaruv — faqat Mini App ichida (Azimjon: "botda telegram webi orqali ochib ishlaydigan bo'lsin")
  const adminUrl = admin ? miniAppUrl(miniappUrl, null, scope, { view: "admin", role }) : null;
  if (adminUrl) keyboard.webApp(MENU.admin, adminUrl);
  return keyboard.resized().persistent().placeholder("Menyudan tanlang");
}
