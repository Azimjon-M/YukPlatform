// Yozuv qatori ostidagi doimiy menyu (reply keyboard). Tugma bosilsa, chatga oddiy matn ketadi va bot uni hears() bilan ushlaydi.
// Sozlamalar tugmasi Mini App'ni ochadi (MINIAPP_URL bo'lsa). Forma ma'lumotni sendData bilan qaytaradi —
// Telegram buni faqat shu pastki menyudagi tugmadan ochilgan Mini App uchun ruxsat beradi.
import { Keyboard } from "grammy";
import { encodeProfile } from "@yuk/shared";

export const MENU = {
  loads: "📋 Mos yuklar",
  settings: "⚙️ Sozlamalar",
  register: "🚚 Ro'yxatdan o'tish",
  pause: "⏸ Pauza",
  resume: "▶️ Davom ettirish",
  apps: "📱 Ilovalar",
  help: "❓ Yordam",
};

// Mini App manzili. Haydovchining hozirgi sozlamalari ?p= ichida — forma oldindan to'ldirilib ochiladi.
// ?s= — yo'nalish doirasi (.env dagi ROUTE_SCOPE): forma faqat shu doiradagi davlatlarni ko'rsatadi
export function miniAppUrl(base, profile, scope = null) {
  if (!base) return null;
  const url = new URL(base);
  if (profile) url.searchParams.set("p", encodeProfile(profile));
  if (scope) url.searchParams.set("s", scope);
  return url.toString();
}

export const settingsLabel = (driver) => (driver?.profile ? MENU.settings : MENU.register);

// driver — bazadagi haydovchi (yoki null), miniappUrl — config dan
export function mainMenu(driver, miniappUrl, scope = null) {
  const label = settingsLabel(driver);
  const url = miniAppUrl(miniappUrl, driver?.profile ?? null, scope);
  const keyboard = new Keyboard().text(MENU.loads);
  if (url) keyboard.webApp(label, url);
  else keyboard.text(label);
  const paused = Boolean(driver?.profile) && driver.active === false;
  return keyboard
    .row()
    .text(paused ? MENU.resume : MENU.pause)
    .text(MENU.apps)
    .row()
    .text(MENU.help)
    .resized()
    .persistent()
    .placeholder("Menyudan tanlang");
}
