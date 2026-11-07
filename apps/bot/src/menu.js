// Yozuv qatori ostidagi doimiy menyu (reply keyboard). Tugma bosilsa, chatga oddiy matn ketadi va bot uni hears() bilan ushlaydi.
// Sozlamalar tugmasi Mini App'ni ochadi (MINIAPP_URL yoki tunnel bo'lsa). Ilova serverga ?t= tokeni bilan kiradi va
// saqlagach, ma'lumotni sendData bilan botga ham yuboradi (bot «✅ Saqlandi» deb, yangilangan menyuni beradi) —
// Telegram sendData'ni faqat shu pastki menyudagi tugmadan ochilgan Mini App uchun ruxsat beradi.
// Menyu rolga qarab: haydovchi — «📋 Mos yuklar», yuk beruvchi — «🚚 Bo'sh mashinalar»; «🔄 Rolni almashtirish»
// (rol tanlangach); adminga — «🛠 Boshqaruv». «📱 Raqam ulashish» — bosilsa Telegram darhol raqamni so'raydi (request_contact;
// raqami bor odam ham bossa — yangi raqami saqlanadi). Oldingi «📱 Ilovalar» tugmasi o'rnida (Azimjon, 2026-11-07) — endi /ilovalar.
import { Keyboard } from "grammy";
import { encodeProfile, roleOf } from "@yuk/shared";

export const MENU = {
  loads: "📋 Mos yuklar",
  trucks: "🚚 Bo'sh mashinalar",
  settings: "⚙️ Sozlamalar",
  register: "🚚 Ro'yxatdan o'tish",
  pause: "⏸ Pauza",
  resume: "▶️ Davom ettirish",
  phone: "📱 Raqam ulashish", // request_contact tugmasi (PHONE.share bilan bir xil matn)
  myPhone: "📱 Raqamim", // menyuda yo'q: 2026-11-07 da bir necha daqiqa bor edi — eski menyuda bosilsa /raqam
  apps: "📱 Ilovalar", // menyuda yo'q (eski menyular uchun ushlanadi) — /ilovalar
  role: "🔄 Rolni almashtirish",
  help: "❓ Yordam",
  admin: "🛠 Boshqaruv",
};

// Mini App manzili. Foydalanuvchining hozirgi sozlamalari ?p= ichida — forma oldindan to'ldirilib ochiladi.
// ?s= — yo'nalish doirasi (.env dagi ROUTE_SCOPE): forma faqat shu doiradagi davlatlarni ko'rsatadi.
// ?r= — rol (haydovchi | yuk_beruvchi): server bilan aloqa bo'lmasa ham to'g'ri forma ochilsin.
// ?v= — qaysi bo'lim bilan ochiladi: sozlamalar (standart) yoki admin
// ?t= — shu foydalanuvchining kirish tokeni (@yuk/store sessions.link). Pastki menyu tugmasidan ochilgan Mini App'ga
// Telegram kimligini (initData) bermaydi — ilova shu token bilan kiradi. Tugma faqat o'sha odamning chatida ko'rinadi.
export function miniAppUrl(base, profile, scope = null, { view = "sozlamalar", role = null, token = null } = {}) {
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("v", view);
  if (role) url.searchParams.set("r", role);
  if (profile) url.searchParams.set("p", encodeProfile(profile));
  if (scope) url.searchParams.set("s", scope);
  if (token) url.searchParams.set("t", token);
  return url.toString();
}

// Telefon raqamini so'rash (ixtiyoriy, @yuk/shared contact.js). Bu alohida, bir martalik klaviatura:
// «📱 Raqam ulashish» — Telegram foydalanuvchining O'Z raqamini kontakt qilib yuboradi (request_contact faqat
// shunday pastki tugmada ishlaydi, inline tugmada emas). Ikkinchi tugma bosilsa, bot asosiy menyuni qaytaradi.
export const PHONE = {
  share: "📱 Raqam ulashish",
  later: "⏭ Keyinroq",
  keep: "↩️ O'zgartirmaslik",
};

// hasPhone — raqami bor (/raqam bilan almashtirmoqchi): ikkinchi tugma «O'zgartirmaslik»
export function phoneKeyboard(hasPhone = false) {
  return new Keyboard()
    .requestContact(PHONE.share)
    .row()
    .text(hasPhone ? PHONE.keep : PHONE.later)
    .resized()
    .oneTime();
}

export const settingsLabel = (driver) => (driver?.profile ? MENU.settings : MENU.register);

// Rolga qarab birinchi tugma: haydovchi — mos yuklar, yuk beruvchi — bo'sh mashinalar
export const matchesLabel = (driver) => (roleOf(driver) === "yuk_beruvchi" ? MENU.trucks : MENU.loads);

// driver — bazadagi foydalanuvchi (yoki null), miniappUrl — config / tunnel'dan; admin — «🛠 Boshqaruv» tugmasi;
// token — shu foydalanuvchining kirish tokeni (Mini App u bilan kiradi, yuqorida miniAppUrl)
export function mainMenu(driver, miniappUrl, scope = null, { admin = false, token = null } = {}) {
  const label = settingsLabel(driver);
  const role = roleOf(driver);
  // Rol tanlanmagan bo'lsa — oddiy tugma: bot avval "Siz kimsiz?" deb so'raydi
  const url = role ? miniAppUrl(miniappUrl, driver?.profile ?? null, scope, { role, token }) : null;
  const keyboard = new Keyboard().text(matchesLabel(driver));
  if (url) keyboard.webApp(label, url);
  else keyboard.text(label);
  const paused = Boolean(driver?.profile) && driver.active === false;
  keyboard.row().text(paused ? MENU.resume : MENU.pause);
  // Raqam: bir bosishda ulashish (Telegram «Raqamingizni ulashasizmi?» deb so'raydi); raqami borda — yangilanadi
  keyboard.requestContact(MENU.phone).row();
  // Rolni almashtirish (haydovchi ↔ yuk beruvchi) — /rol bilan bir xil. Odamda bugun yuk, ertaga bo'sh mashina bo'lishi
  // mumkin, /rol ni esa hamma ham topavermaydi. Rol tanlanmagan bo'lsa tugma yo'q: bot baribir «Siz kimsiz?» deb so'raydi
  if (role) keyboard.text(MENU.role);
  keyboard.text(MENU.help);
  // Boshqaruv — faqat Mini App ichida (Azimjon: "botda telegram webi orqali ochib ishlaydigan bo'lsin")
  const adminUrl = admin ? miniAppUrl(miniappUrl, null, scope, { view: "admin", role, token }) : null;
  if (adminUrl) keyboard.row().webApp(MENU.admin, adminUrl);
  // persistent() YO'Q (Azimjon, 2026-11-07: «yozish qatorida 1 ta tugma menyuni ochib-yopsin»): is_persistent=false
  // bo'lsa Telegram yozish qatorining o'ng tomoniga belgi qo'yadi — u menyuni yopadi va qayta ochadi. Bot o'zi u yerga
  // tugma qo'ya olmaydi. Yopilgan menyu yangi menyuli xabar kelguncha yopiq turadi — shuning uchun bot har javobi va
  // har yuk xabari bilan menyuni yuboradi (bot.js deliver): chatga qaytganda menyu odatda ochiq turadi.
  return keyboard.resized().placeholder("Menyudan tanlang");
}

