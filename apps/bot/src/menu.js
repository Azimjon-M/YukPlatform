// Yozuv qatori ostidagi doimiy menyu (reply keyboard). Tugma bosilsa, chatga oddiy matn ketadi va bot uni hears() bilan ushlaydi.
// Sozlamalar tugmasi Mini App'ni ochadi (MINIAPP_URL yoki tunnel bo'lsa). Ilova serverga ?t= tokeni bilan kiradi va
// saqlagach, ma'lumotni sendData bilan botga ham yuboradi (bot «✅ Saqlandi» deb, yangilangan menyuni beradi) —
// Telegram sendData'ni faqat shu pastki menyudagi tugmadan ochilgan Mini App uchun ruxsat beradi.
// Menyu rolga qarab: haydovchi — «📋 Mos yuklar», yuk beruvchi — «🚚 Bo'sh mashinalar»; «🔄 Rolni almashtirish»
// (rol tanlangach); adminga — «🛠 Boshqaruv». «📱 Raqam ulashish» — bosilsa Telegram darhol raqamni so'raydi (request_contact;
// raqami bor odam ham bossa — yangi raqami saqlanadi). Oldingi «📱 Ilovalar» tugmasi o'rnida (Azimjon, 2026-11-07) — endi /ilovalar.
import { Keyboard } from "grammy";
import { FEED_MODES, encodeProfile, feedMode, profileReady, roleOf, usesRawFeed } from "@yuk/shared";

// Eski nomlar (foydalanuvchi telefonidagi eski menyudan kelishi mumkin) — bot.js ularni ham ushlaydi
export const OLD_MENU = { feed: "🎛 Rejim" };

export const MENU = {
  giveLoad: "📦 Yuk berish", // yuk beruvchida birinchi qator: web forma (Mini App) yoki — forma yo'q bo'lsa — oddiy tugma (shipperLoads.js)
  loads: "📋 Mos yuklar",
  trucks: "🚚 Bo'sh mashinalar",
  settings: "⚙️ Sozlamalar",
  register: "🚚 Ro'yxatdan o'tish",
  writeHere: "✍️ Shu chatga yozish", // ro'yxatdan o'tishning 2-yo'li (haydovchi, profilsiz): mashinani oddiy matn bilan yozadi, AI profilga aylantiradi (bot.js, driverText.js)
  pause: "⏸ Pauza",
  resume: "▶️ Davom ettirish",
  phone: "📱 Raqam ulashish", // oddiy tugma → bot afzalliklarni yozib, PHONE.share (request_contact) ni beradi (2026-11-13) — faqat raqami yo'qlarda (bor bo'lsa — /raqam: almashtirish / o'chirish)
  addGroup: "➕ Guruh qo'shish", // raqami borlarda «Raqam ulashish» o'rnida (Azimjon, 2026-11-10; bot.js userSources.js)
  myPhone: "📱 Raqamim", // menyuda yo'q: 2026-11-07 da bir necha daqiqa bor edi — eski menyuda bosilsa /raqam
  apps: "📱 Ilovalar", // menyuda yo'q (eski menyular uchun ushlanadi) — /ilovalar
  role: "🔄 Rolni almashtirish",
  feed: "🎛 Filtr", // haydovchi: qaysi yuklar kelsin (feed.js; 2026-11-19 gacha «🎛 Rejim» — eski menyuda bosilsa ham ishlaydi, OLD_MENU) — /rejim
  fastOff: "⚡ Tezkorni o'chirish", // tezkor rejimda birinchi tugma → saralanganga qaytadi (Azimjon, 2026-11-18: «bir marta yoqsa, keyin o'chmaydigan bo'libdi»)
  groups: "📌 Guruhlarim", // eski menyu tugmasi — endi ilovadagi «🎛 Filtr» ni ochadi
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
  // Raqami bor (/raqam): almashtirish ham, o'chirish ham (Azimjon, 2026-11-10; web sozlamalarida ham shu ikkalasi)
  change: "🔄 Raqamni almashtirish", // request_contact — yangi raqam kontakt bo'lib keladi
  remove: "🗑 Raqamni o'chirish",
};

// Raqam yo'q: [📱 Raqam ulashish] / [⏭ Keyinroq]. Raqam bor (/raqam): [🔄 Raqamni almashtirish] / [🗑 Raqamni o'chirish] [↩️ O'zgartirmaslik]
export function phoneKeyboard(hasPhone = false) {
  const keyboard = new Keyboard().requestContact(hasPhone ? PHONE.change : PHONE.share).row();
  if (hasPhone) keyboard.text(PHONE.remove).text(PHONE.keep);
  else keyboard.text(PHONE.later);
  return keyboard.resized().oneTime();
}

// Azimjon, 2026-11-12: yuk beruvchiga ro'yxatdan o'tish umuman kerak emas — uning sozlamalari IXTIYORIY, shuning
// uchun profili bo'lmasa ham tugma «⚙️ Sozlamalar». «🚚 Ro'yxatdan o'tish» endi faqat profil so'raladigan haydovchida.
// Haydovchida — ro'yxatdan o'tish tugaganmi (profileReady: rejimga mashina kerak bo'lsa, u ham kiritilgan)
export const settingsLabel = (driver) =>
  roleOf(driver) === "yuk_beruvchi" || profileReady(driver?.profile) ? MENU.settings : MENU.register;

// Haydovchi menyusi «ro'yxatdan o'tgan» ko'rinishdami: profili bor va undan nimadir keladi — mashinasi bor yoki
// tezkor/guruhlarim rejimida (mashinasiz ham yuk keladi). «Saralangan» ga o'tib mashinasini kiritmagan — hali yo'q
const driverRegistered = (driver) => Boolean(driver?.profile) && (profileReady(driver.profile) || usesRawFeed(driver.profile));

// Rolga qarab birinchi tugma: haydovchi — mos yuklar, yuk beruvchi — bo'sh mashinalar
export const matchesLabel = (driver) => (roleOf(driver) === "yuk_beruvchi" ? MENU.trucks : MENU.loads);

// driver — bazadagi foydalanuvchi (yoki null), miniappUrl — config / tunnel'dan; admin — «🛠 Boshqaruv» tugmasi;
// token — shu foydalanuvchining kirish tokeni (Mini App u bilan kiradi, yuqorida miniAppUrl).
// Bot bu menyuni faqat rol tanlangan odamga yuboradi (bot.js menu(): rol yo'q — remove_keyboard)
// Tartib (Azimjon, 2026-11-10): 1 Mos yuklar, 2 Pauza/Davom ettirish, 3 Rolni almashtirish, 4 Raqam ulashish
// (raqami bo'lsa — Guruh qo'shish), 5 Yordam, 6 Sozlamalar, keyin qolganlari (Boshqaruv) — har qatorda ikkitadan:
//   [📦 Yuk berish]  — faqat yuk beruvchida (bitta, keng)
//   [📋 Mos yuklar]        [⏸ Pauza]
//   [🔄 Rolni almashtirish] [📱 Raqam ulashish] / [➕ Guruh qo'shish]
//   [❓ Yordam]             [⚙️ Sozlamalar]
//   [🛠 Boshqaruv]  — faqat adminga
export function mainMenu(driver, miniappUrl, scope = null, { admin = false, token = null } = {}) {
  const label = settingsLabel(driver);
  const role = roleOf(driver);
  // Rol tanlanmagan bo'lsa — oddiy tugma (bot uni ko'rsatmaydi, lekin funksiya baribir xato bermasin)
  const url = role ? miniAppUrl(miniappUrl, driver?.profile ?? null, scope, { role, token }) : null;
  const settingsButton = (keyboard) => (url ? keyboard.webApp(label, url) : keyboard.text(label));
  // Yuk beruvchi: «📦 Yuk berish» — alohida, birinchi qatorda (Azimjon, 2026-11-10: rol tanlanishi bilan, ro'yxatdan
  // o'tmasdan ham). Oddiy tugma: bot namunani ko'rsatadi, yuk shu chatga matn yoki ovoz bilan yoziladi (Azimjon,
  // 2026-11-27: «Ilovadagi kabi yozib (abrazavanyaga qarab) yoki audioham jo'nataversin … Formaga yo'naltirish kerak emas»)
  const loadRow = (keyboard) => (role === "yuk_beruvchi" ? keyboard.text(MENU.giveLoad).row() : keyboard);

  // Rol tanlangan, lekin ro'yxatdan o'tmagan (forma hali to'ldirilmagan) — FAQAT 3 tugma (Azimjon, 2026-11-10):
  //   [🚚 Ro'yxatdan o'tish]
  //   [🔄 Rolni almashtirish] [❓ Yordam]
  // Bu endi FAQAT haydovchiga qo'llanadi (Azimjon, 2026-11-12: «Bizga yuk beruvchi uchun Ro'yxatdan o'tish kerak emas!») —
  // yuk beruvchi profili bo'lmasa ham pastdagi TO'LIQ menyuni oladi («📦 Yuk berish» uning asosiy ishi,
  // «🚚 Bo'sh mashinalar» ixtiyoriy sozlamalarsiz ham filtrsiz ro'yxat bo'lib ochiladi).
  // Mos yuklar, pauza, raqam, Boshqaruv — formadan keyin (haydovchida bu bosqichda ular ishlamaydi yoki chalg'itadi;
  // raqam formadan keyin baribir so'raladi).
  if (role !== "yuk_beruvchi" && !driverRegistered(driver)) {
    const keyboard = settingsButton(loadRow(new Keyboard())).row();
    // Ro'yxatdan o'tishning 2-yo'li: mashinani shu chatga oddiy matn bilan yozish (bot.js: AI → profil → tasdiqlash)
    keyboard.text(MENU.writeHere).row();
    if (role) keyboard.text(MENU.role);
    keyboard.text(MENU.help);
    return keyboard.resized().placeholder("Menyudan tanlang");
  }

  // Azimjon, 2026-11-12: «⏸ Pauza / ▶️ Davom ettirish» va «➕ Guruh qo'shish» FAQAT haydovchi roli uchun —
  // yuk_beruvchida menyuda yo'q (handlerlar saqlangan: eski menyuda bosilsa yoki idle DM'dagi inline
  // «▶️ Davom ettirish» bosilsa ishlayveradi). «📱 Raqam ulashish» ikkala rolda ham bor (raqam — umumiy
  // identifikatsiya). Yuk beruvchi tartibi: [📦 Yuk berish] / [🔄 Rolni almashtirish, ❓ Yordam] / [⚙️ Sozlamalar] /
  // (adminga [🛠 Boshqaruv]). «📱 Raqam ulashish» ham yo'q (Azimjon, 2026-11-27: raqam e'londa baribir so'raladi, matnda yoki
  // ovozda aytiladi; oxirgi raqamlari tugma bo'lib turadi) — /raqam va Mini App Sozlamalaridagi «📱 Telefon raqam» qoladi. «🚚 Bo'sh mashinalar» yo'q (Azimjon, 2026-11-27: «biz faqat yuk
  // e'lonlarini qidiramiz endi bo'sh mashinalarniham qidirsak ortiqcha!») — eski menyuda bosilsa bot tushuntiradi
  if (role === "yuk_beruvchi") {
    // Rol tanlangan (shu tarmoq shartiga ko'ra) — «🔄 Rolni almashtirish» har doim qo'yiladi
    const shipperKb = loadRow(new Keyboard()).text(MENU.role).text(MENU.help).row();
    settingsButton(shipperKb);
    const shipperAdminUrl = admin ? miniAppUrl(miniappUrl, null, scope, { view: "admin", role, token }) : null;
    if (shipperAdminUrl) shipperKb.row().webApp(MENU.admin, shipperAdminUrl);
    return shipperKb.resized().placeholder("Menyudan tanlang");
  }

  // Haydovchi (Azimjon, 2026-11-10 tartibi — O'ZGARMAYDI; rejim tugmalari — oxirida, «keyin qolganlari»)
  // Pauza holati: profil to'ldirilganda pauza tugmasi ishlaydi; u pauzaga tushsa tugma «▶️ Davom ettirish» bo'ladi
  // Birinchi tugma rejimga qarab (2026-11-14): saralangan bor — «📋 Mos yuklar»; faqat guruhlarim — «📌 Guruhlarim»;
  // tezkor — «⚡ Tezkorni o'chirish» (2026-11-18; avval «🎛 Rejim» edi — o'chirish yo'li ko'rinmasdi, odamlar pauza bilan
  // to'xtatib yurgan). «🎛 Rejim» pastki qatorga tushadi
  const paused = driver.active === false;
  const modeId = feedMode(driver.profile);
  const mode = FEED_MODES[modeId];
  // 2026-11-19: saralash olib tashlandi, hamma tezkor — «⚡ Tezkorni o'chirish» yo'q (o'chirsa qaytadigan rejim qolmadi)
  // 2026-11-19 (soddalashtirish): hamma tezkor rejimda birinchi tugma — «🎛 Filtr» (guruhlar ham shu oynada), alohida
  // «📌 Guruhlarim» qatori yo'q
  const first = mode.sorted ? matchesLabel(driver) : MENU.feed;
  // «🎛 Filtr» — Mini App'ning «🎛 Filtr» bo'limini ochadi (2026-11-27: filtr chatda emas, faqat ilovada); manzil yo'q — oddiy tugma
  const filterUrl = miniAppUrl(miniappUrl, null, scope, { view: "filtr", role, token });
  const button = (kb, text) => (text === MENU.feed && filterUrl ? kb.webApp(text, filterUrl) : kb.text(text));
  const keyboard = button(loadRow(new Keyboard()), first).text(paused ? MENU.resume : MENU.pause).row();
  // Rolni almashtirish (haydovchi ↔ yuk beruvchi) — /rol bilan bir xil. Odamda bugun yuk, ertaga bo'sh mashina bo'lishi
  // mumkin, /rol ni esa hamma ham topavermaydi. Rol tanlanmagan bo'lsa tugma yo'q
  if (role) keyboard.text(MENU.role);
  // Raqam: avval bot afzalliklarni tushuntiradi, keyin Telegram «Raqamingizni ulashasizmi?» deb so'raydi (2026-11-13). Raqami borda shu joyda
  // «➕ Guruh qo'shish» (Azimjon, 2026-11-10: raqam ulashgandan keyin paydo bo'lsin — ishonchlilik uchun, yangi tugmaga
  // joy ochmasdan). Raqamni almashtirish — /raqam
  if (driver.phone) keyboard.text(MENU.addGroup).row();
  else keyboard.text(MENU.phone).row();
  settingsButton(keyboard.text(MENU.help));
  // Rejim tugmalari: birinchi qatorda bo'lmaganlari — shu yerda, ikkitadan
  const extra = [first !== MENU.feed ? MENU.feed : null].filter(Boolean);
  if (extra.length) {
    keyboard.row();
    for (const text of extra) button(keyboard, text);
  }
  // Boshqaruv — faqat Mini App ichida (Azimjon: "botda telegram webi orqali ochib ishlaydigan bo'lsin")
  const adminUrl = admin ? miniAppUrl(miniappUrl, null, scope, { view: "admin", role, token }) : null;
  if (adminUrl) keyboard.row().webApp(MENU.admin, adminUrl);
  // persistent() YO'Q (Azimjon, 2026-11-07: «yozish qatorida 1 ta tugma menyuni ochib-yopsin»): is_persistent=false
  // bo'lsa Telegram yozish qatorining o'ng tomoniga belgi qo'yadi — u menyuni yopadi va qayta ochadi. Bot o'zi u yerga
  // tugma qo'ya olmaydi. Yopilgan menyu yangi menyuli xabar kelguncha yopiq turadi — shuning uchun bot har javobi va
  // har yuk xabari bilan menyuni yuboradi (bot.js deliver): chatga qaytganda menyu odatda ochiq turadi.
  return keyboard.resized().placeholder("Menyudan tanlang");
}

