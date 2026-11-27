// Telegram bot (grammY): rol tanlash (haydovchi / yuk beruvchi), pastki menyu, sozlamalar (Mini App yoki chatda savol-javob),
// guruhdagi e'lonlarni navbatga qo'yish, haydovchilarga yuk va yuk beruvchilarga bo'sh mashina yuborish.
// Savol-javob mantig'i wizard.js da, pastki menyu menu.js da, xabar ko'rinishi format.js da,
// «📋 Mos yuklar» dagi «Qayerdan? → Qayerga?» route.js da.
// Telefon raqami — ixtiyoriy: profil saqlangach bir marta so'raladi (/raqam — keyin), /ochirish — ma'lumotlarni o'chirish.
// Kanal va guruhga a'zolik (members.js): .env REQUIRED_CHATS bo'lsa, bot faqat ularning a'zolariga ishlaydi.
// Boshqaruv markazidan bloklangan (store.banOf: id, username yoki raqam) — har xabarga «Uzr, sizga xizmat ko'rsata olmaymiz!».
import { existsSync } from "node:fs";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import {
  BLOCKED_TEXT,
  DEFAULT_DEDUPE_WINDOW_MS,
  FEED_MODES,
  KIND_MATCHERS,
  ROLES,
  ROLE_IDS,
  ROLE_KIND,
  SHIPPER_LOAD_LIMIT,
  formatContactPhone,
  isAdmin,
  feedMode,
  feedLabel,
  feedOf,
  isOwnContact,
  maxFeedSources,
  OWNER_CONTACT,
  planOf,
  sourcesLimitText,
  normalizeContactPhone,
  phoneText,
  planFilter,
  rawProfile,
  roleOf,
  routeChosen,
  sanitizeProfileFor,
  sanitizeShipperLoad,
  shipperLoadText,
  shouldAskPhone,
  sortedReady,
  telegramUsername,
  NEW_DRIVER_FEED_MODE,
  validRole,
  withPrevFeed,
  withRoute,
} from "@yuk/shared";
import { createCommandSync } from "./commands.js";
import { profileFromText } from "./driverText.js";
import { FILTER_CALLBACK, feedSavedText } from "./feed.js";
import { SENDER_TEXT, escapeHtml, formatLoad, formatRaw, formatRawCaption, formatTruck } from "./format.js";
import { APK_DIR, APK_PATH, mediaFileOf, readRelease, sizeText } from "@yuk/store";
import { IDLE_BUTTONS } from "./idle.js";
import { REMIND_EVERY_MS, SUB_CHECK, createMembership, isMember, joinPrompt, remindText } from "./members.js";
import { MENU, OLD_MENU, PHONE, mainMenu, matchesLabel, miniAppUrl, phoneKeyboard, settingsLabel } from "./menu.js";
import { createGroupPoster } from "./groupTopics.js";
import { createNoticeLoop } from "./notices.js";
import { ANY, applyRoute, chosenText, fromStep, toStep, validArea } from "./route.js";
import { LOAD_CALLBACKS, LOAD_TEXT, createLoadDesk, loadIntro, resultText } from "./shipperLoads.js";
import { ADD_GROUP_ABOUT, ADD_GROUP_TEXT, INTAKE, LINK_RE, createSourceIntake, createSourceWatcher, parseSourceLink } from "./userSources.js";
import { applyAction, applyText, describeProfile, newDraft, profileFromDraft, renderStep } from "./wizard.js";

const LOADS_WINDOW_MS = 24 * 60 * 60 * 1000; // "📋 Mos yuklar" / "🚚 Bo'sh mashinalar" — oxirgi 24 soat
const LOADS_SHOWN = 5;
const LOADS_LIMIT = 5000; // 24 soatda ~4 000 yuk — hammasidan sanaladi (store standarti 500)

// Bot haqida — Azimjon yozgan matn (2026-11-10). Bot tavsifi ham, rol tanlanmagandagi /start ham shu bilan boshlanadi.
// «o'zingiz belgilagan guruhlar» — menyudagi «➕ Guruh qo'shish» (raqam ulashganlarda; userSources.js)
const NAME = "Yuk Eksperti";
// 2026-11-19 (Azimjon: «kaltaroq, soddaroq … o'qimagan haydovchi ham, yoshi o'tgan ham tushunsin») — qisqartirildi
const ABOUT = "guruhlardagi yuk e'lonlarini shu yerga, darhol yuboradi. Yuk egasi esa yukini to'g'ridan-to'g'ri haydovchiga beradi.";

// Bot profilidagi matnlar (botni birinchi ochganda "Bu bot nima qila oladi?" o'rnida chiqadi; Telegram cheki — 512 belgi)
// Kanal va guruh havolalari (Azimjon, 2026-11-13: «Bot biosigaham kanalimiz va guruh linklarini qo'sh»)
const LINKS = "📢 Kanal: @Yuk_Ekspert\n💬 Guruh: @Yuk_Ekspert_chat";
export const DESCRIPTION = `🚛 ${NAME} — ${ABOUT}\n\n${LINKS}\n\nBoshlash uchun /start ni bosing!`;
// Bot profilidagi qisqa bio («About»; Telegram cheki — 120 belgi)
// AI yordamchi (2026-11-18, Azimjon: «Botni biosiga AI yordamchi: @YukExperti deb yozib qo'shib qo'y»); .env SUPPORT_USERNAME, bo'sh — yo'q
const BIO_SUPPORT = (process.env.SUPPORT_USERNAME ?? "YukExperti").replace(/^@/, "");
export const SHORT_DESCRIPTION = `Yukni to'g'ridan-to'g'ri haydovchiga.\n${LINKS}${BIO_SUPPORT ? `\n🤖 AI yordamchi: @${BIO_SUPPORT}` : ""}`;

// Rolni almashtirishdan oldin (/rol, «🔄 Rolni almashtirish»)
// Ro'yxatdan o'tishdagi oxirgi qadamdan oldin (forma va raqamdan keyin) — «Qayerdan?» shu matndan keyin keladi
const ROUTE_NEXT = "Endi qayerdan qayerga yuk kerakligini tanlang 👇";
const ROLE_SWITCH_NOTE = "Kerakligini tanlang 👇 Sozlamalaringiz yo'qolmaydi.";

// Nega raqam so'raymiz — so'rashda, /raqam da va /start dagi menyu tavsifida bir xil ma'no
// (raqam keyin ilovaga kirishda ham kerak bo'ladi — Azimjon, 2026-11-07; 2026-11-10 da uning so'zlari bilan qayta yozildi).
// «hech kimga ko'rsatilmaydi … O'chirish — /ochirish» qatori olib tashlandi (uning matni); raqam saqlangach ham faqat
// «Raqamingiz saqlandi! ✅». /ochirish — «Menu» buyruqlari ro'yxatida
// Raqam ulashgandan keyin menyuda «📱 Raqam ulashish» o'rnida «➕ Guruh qo'shish» chiqadi (Azimjon, 2026-11-10:
// «forma to'ldirgandan so'ng raqam ulashishdan avval» aytilsin — shu rejim uchun ham raqam ulashsin).
// Matni — hamma joydagidek bitta jumla (ADD_GROUP_TEXT, userSources.js)
const GROUP_UNLOCK = ADD_GROUP_TEXT;
// Raqam so'rovi (Azimjon, 2026-11-13: «modal ichidagi kontentni chiroyli qilsak … ijobiy tarafdagi kontent kerak»).
// Telegram'ning «Telefon raqamingizni ulashmoqchimisiz?» oynasi matnini o'zgartirib bo'lmaydi — shuning uchun undan
// OLDIN shu xabar chiqadi: menyudagi «📱 Raqam ulashish» ham endi avval shuni ko'rsatadi, Telegram oynasi — keyingi bosishda.
// 2026-11-19: qisqartirildi (3 ta foyda o'rniga 2, bitta harakat)
const PHONE_WHY =
  "✅ Sizni doim taniymiz — sozlamalar yo'qolmaydi\n" +
  "✅ O'z guruhingizni qo'sha olasiz\n" +
  "🔒 Raqamingiz hech kimga ko'rsatilmaydi\n\n" +
  `👇 Pastdagi «${PHONE.share}» tugmasini bosing. Xohlamasangiz — «${PHONE.later}».`;

// Hisob o'chirilgach (bot /ochirish; web'dagi o'chirishda — apps/api public.js DELETED_TEXT, ma'nosi bir xil)
const ACCOUNT_DELETED_TEXT = "✅ Hisobingiz o'chirildi. Endi sizga hech narsa yuborilmaydi.";

// /ochirish: nimani saqlaymiz (inline tugmalar: del:phone | del:all | del:no).
// Hisobni o'chirganda ma'lumot bizda qoladi (Azimjon, 2026-11-09: «Hammasi saqlansin») — matn buni ochiq aytadi,
// «hamma ma'lumotingiz o'chirildi» deb aldamaymiz. «Faqat raqamni o'chirish» esa raqamni haqiqatan o'chiradi.
function storedDataText(driver) {
  return [
    "🗂 <b>Siz haqingizda nimani saqlaymiz</b>",
    "• Telegram'dagi ismingiz va username",
    "• rolingiz va sozlamalaringiz (mashina, yo'nalish)",
    `• telefon raqamingiz — ${driver.phone ? escapeHtml(formatContactPhone(driver.phone)) : "ulashmagansiz"}`,
    "• sizga yuborilgan yuklar va botdagi harakatlaringiz tarixi (qachon kirgansiz, qaysi yo'nalishni tanlagansiz)",
    "",
    "«🗑 Hisobni o'chirish» — bot sizga boshqa hech narsa yubormaydi, qaytsangiz boshidan ro'yxatdan o'tasiz. " +
      "Yuqoridagi ma'lumotlar xizmat yozuvlarida saqlanib qoladi.",
    "",
    "Nima qilamiz?",
  ].join("\n");
}

// /start ning birinchi qatori (faqat /start da — /yordam da emas)
const GREETING = "Assalomu alaykum!";

// Bot haqida (Azimjon matni, 2026-11-10) — /start va /yordam ning boshida, rol bor-yo'qligidan qat'i nazar.
// Rol tanlanmaganda ostida ikki rol va «Iltimos, rolingizni tanlang». Rol tanlanganda 2026-11-07…10 da alohida matn
// edi («…yetkazamiz: vositachisiz, yuk egasining o'zi bilan gaplashasiz» + «Bundan tashqari, katta yuk guruhlaridagi…») —
// Azimjon uni ham shu matnga almashtirdi.
const INTRO = `🚛 <b>${NAME}</b> — ${ABOUT}`;

// AI yordamchi (2026-11-17, Azimjon: «bot boshida agar botni ishlatishga qiynalsangiz bizni AI ga yozing yordam beradi»):
// operator akkaunt — unga yozilganda Claude javob beradi, muammoni egasiga tiket qilib yetkazadi (collector opsResponder.js)
const SUPPORT_USERNAME = (process.env.SUPPORT_USERNAME ?? "YukExperti").replace(/^@/, "");
// Yordamchi javob bermasa (limit, uzilish) — loyiha egasi (2026-11-27); .env OWNER_USERNAME, bo'sh — ko'rsatilmaydi
const OWNER_USERNAME = (process.env.OWNER_USERNAME ?? OWNER_CONTACT).replace(/^@/, "");
const SUPPORT_LINE = SUPPORT_USERNAME
  ? `❓ Tushunmasangiz — @${SUPPORT_USERNAME} ga yozing, yordam beradi.${OWNER_USERNAME ? ` Javob bo'lmasa — @${OWNER_USERNAME}.` : ""}`
  : null;
const introLines = () => [INTRO, ...(SUPPORT_LINE ? ["", SUPPORT_LINE] : [])];

// Rol so'rash (ostida ikki tugma: r:haydovchi / r:yuk_beruvchi). Avval «Siz kimsiz?» edi — Azimjon: qo'pol
const ROLE_QUESTION = "Iltimos, tanlang 👇";

// Rolga qarab so'zlar: nima keladi, sozlamalarda nima so'raladi.
// chosen — rol tanlangach (sozlamalar hali yo'q): haydovchinikini Azimjon yozgan (2026-11-10), yuk beruvchiniki — unga o'xshatib
// Yuk beruvchida «📦 Yuk berish» (2026-11-10) — yuk yuborish asosiy ish, bo'sh mashina e'lonlari esa ixtiyoriy
// (Azimjon: ro'yxatdan o'tish shart emas). chosen — rol tanlangach birinchi qator, ostida loadIntro (shipperLoads.js)
const ROLE_TEXT = {
  haydovchi: {
    chosen: "🚚 Haydovchisiz. Guruhlardagi yuk e'lonlarini darhol shu yerga yo'naltiramiz.", // 2026-11-19: saralash yo'q — tezkor
    one: "yuk",
    many: "yuklar",
    matches: "qayerdan qayerga — tanlaysiz: oxirgi 24 soatdagi mos yuklar chiqadi, yangilari ham shu yo'nalishda keladi",
    settings: "hamma sozlamalar bitta sahifada",
    setup: "transportingizni",
  },
  yuk_beruvchi: {
    chosen: "📦 Yuk beruvchisiz.",
    // Sozlamalar nima beradi — yuk beruvchida u IXTIYORIY (Azimjon, 2026-11-12: ro'yxatdan o'tish umuman shart emas,
    // «1 daqiqalik forma» deb majbur qilinmaydi). «🚚 Ro'yxatdan o'tish» so'zi yuk beruvchida endi ishlatilmaydi.
    // Shaxsiy avtomatik xabarlar uchun profil kerak (store.activeUsers `profile IS NOT NULL`) — matn shuni ma'qul ko'radi.
    register: "ixtiyoriy: qanday mashina kerakligini tanlasangiz, mos bo'sh mashinalar shu yerga keladi",
    one: "bo'sh mashina",
    many: "bo'sh mashinalar",
    matches: "oxirgi 24 soatdagi mos bo'sh mashinalar",
    settings: "yo'nalish va kerakli mashina",
    setup: "yo'nalishingizni va qanday mashina kerakligini",
  },
};

function helpText(driver) {
  const role = roleOf(driver);
  if (!role) {
    return introLines().join("\n");
  }
  const t = ROLE_TEXT[role];
  // Menyudagi tartibda (menu.js mainMenu). Ro'yxatdan o'tmaguncha menyuda faqat 3 tugma — ro'yxat ham shular.
  // Matnlar — Azimjon (2026-11-10; ro'yxatdan o'tmagan haydovchining /start ekrani bo'yicha, umumiy qatorlar hammaga)
  const roleLine = `${MENU.role} — haydovchi yoki yuk egasi`;
  // Yuk beruvchida birinchi qator — «📦 Yuk berish» (menu.js)
  const loadLine = role === "yuk_beruvchi" ? [`${MENU.giveLoad} — yukingizni shu chatga yozing yoki 🎤 ovozli xabar qiling`] : [];
  // Sozlamalar qatori: profil bo'lsa — nima tanlangani, bo'lmasa — nima uchun kerakligi. Yuk beruvchida u qator
  // «ixtiyoriy» ni aytadi (t.register), haydovchida — «1 daqiqalik forma» (/start oxirida)
  const settingsLine = role === "yuk_beruvchi"
    ? `${settingsLabel(driver)} — raqam, Telegram akkaunt, ilova va hisob`
    : driver?.profile
    ? `${settingsLabel(driver)} — ${t.settings}`
    : `${settingsLabel(driver)} — ${t.register ?? "sizga qanday e'lonlar yo'naltirishimiz haqida"}`;
  // Yuk beruvchi (Azimjon, 2026-11-12): ro'yxat shart emas — menyuda hamma tugma bor, yordamda ham shular ro'yxati.
  // Haydovchida esa ro'yxatgacha faqat 2 qator (qolgan tugmalar menyuda yo'q).
  // Azimjon, 2026-11-12 (ya'ni qoida): «⏸ Pauza / ▶️ Davom ettirish» va «➕ Guruh qo'shish» FAQAT haydovchi uchun —
  // yuk_beruvchi yordamida bu qatorlar yo'q (menyu bilan bir xil, menu.js)
  const isShipper = role === "yuk_beruvchi";
  // Haydovchi rejimi (feed.js): «📋 Mos yuklar» faqat saralash bor rejimda; tezkor/guruhlarimda — o'z tugmalari
  const mode = FEED_MODES[feedMode(driver?.profile)];
  const feedLines = isShipper
    ? []
    : [
        `${MENU.feed} — qaysi yuklar kelsin: mashina, joy, guruh`,
      ];
  const menuLines = driver?.profile || isShipper
    ? [
        // Menyu tartibida: birinchi tugma (haydovchida — «🎛 Filtr»), keyin pauza…
        ...(isShipper ? [] : mode.sorted ? [`${matchesLabel(driver)} — ${t.matches}`] : feedLines),
        ...(isShipper ? [] : [`${MENU.pause} — yuk kelishini to'xtatish (${MENU.resume} — qayta yoqish)`]),
        roleLine,
        // Yuk beruvchida raqam qatori yo'q (2026-11-27) — raqam e'lon berishda so'raladi
        ...(isShipper ? [] : [driver.phone ? ADD_GROUP_TEXT : `${MENU.phone} — sizni doim taniymiz, sozlamalar yo'qolmaydi`]),
        settingsLine,
        ...(mode.sorted ? feedLines : []),
      ]
    : [settingsLine, roleLine];
  // 2026-11-19: qisqa — har tugma bitta qator; bot haqidagi matn faqat /start da (rol tanlanmaganda)
  return [
    `<b>Pastdagi tugmalar</b> (siz: ${ROLES[role].icon} ${ROLES[role].name}):`,
    ...loadLine,
    ...menuLines,
    "",
    "Tugmalar yo'qolsa — /start ni bosing.",
    ...(SUPPORT_LINE ? [SUPPORT_LINE] : []),
  ].join("\n");
}

const roleKeyboard = () => InlineKeyboard.from(ROLE_IDS.map((id) => [InlineKeyboard.text(ROLES[id].choice, `r:${id}`)]));

// route.js tugmalari: { text, data } — oddiy (callback), { text, webApp } — Mini App (xarita)
const toKeyboard = (rows) =>
  InlineKeyboard.from(rows.map((row) => row.map((b) => (b.webApp ? InlineKeyboard.webApp(b.text, b.webApp) : InlineKeyboard.text(b.text, b.data)))));

// Shaxsiy xabardagi yuk (haydovchiga) yoki bo'sh mashina (kind "mashina", yuk beruvchiga) matni.
// Asl e'lon va qo'ng'iroq — matnda emas, xabar ostidagi tugmalarda (loadButtons)
export function directText(load, post, kind = "yuk") {
  return (kind === "mashina" ? formatTruck(load, post) : formatLoad(load, post)).text;
}

export const SOURCE_BUTTON = "📄 Asl e'lon";
export const CALL_BUTTON = "📞 Telefon qilish";
const MAX_CALL_BUTTONS = 3;

// Yuk xabari ostidagi tugmalar (Azimjon, 2026-11-09): «📄 Asl e'lon» va «📞 Telefon qilish».
// Telegram tugmasiga tel: qo'yib bo'lmaydi (faqat http(s):// va tg://) — shuning uchun «Telefon qilish» bizning https
// sahifamizni ochadi (GET /pub/call, apps/api public.js), u esa raqamni telefonning qo'ng'iroq oynasiga uzatadi:
// raqam yozilgan holda ochiladi, haydovchi yashil tugmani bosadi.
// Oddiy havola (url) tugmasi EMAS, Mini App (web_app) tugmasi: havola tugmasiga Telegram har safar «Havolani ochish?»
// deb so'raydi va sahifani o'z brauzerida ochadi (Azimjon telefonda sinadi: 3 qadam). Mini App tugmasi so'ramaydi,
// sahifa esa qo'ng'iroq oynasi ochilishi bilan Mini App'ni o'zi yopadi. web_app faqat shaxsiy chatda ishlaydi — yuklar shu yerda.
// callUrl(i) — i-raqamning sahifa manzili yoki null (tunnel o'chiq — unda faqat matndagi raqam qoladi).
// Raqam bitta — ikkala tugma bir qatorda; bir nechta — har raqam o'z tugmasida. → InlineKeyboard yoki null (tugma yo'q)
// lichka — username'i yo'q odamga «💬 Lichkasi» tugmasi (tg://user?id=, post.senderId) — faqat bot taniydigan odamga
// (post.senderKnown — botga yozgan, drivers jadvalida): begonasini Telegram BUTTON_USER_INVALID bilan rad etadi.
// Baribir rad etsa (maxfiylik sozlamasi), sendDirect uni olib tashlab qayta yuboradi (lichka: false)
export function loadButtons(load, post, callUrl = () => null, { lichka = true } = {}) {
  // Ovozli xabar / dumaloq video — «🎤 Tinglash» (guruhdagi xabarning o'zi; raqam aytilmagan bo'lsa aloqa ham shu yerda)
  const label = post?.media === "voice" ? "🎤 Tinglash" : post?.media === "round" ? "📹 Ko'rish" : SOURCE_BUTTON;
  const source = post?.link ? InlineKeyboard.url(label, post.link) : null;
  const phones = (load.phones ?? []).slice(0, MAX_CALL_BUTTONS);
  const calls = phones
    .map((phone, i) => {
      const url = callUrl(i);
      if (!url) return null;
      return InlineKeyboard.webApp(phones.length === 1 ? CALL_BUTTON : `📞 ${formatContactPhone(phoneText(phone))}`, url);
    })
    .filter(Boolean);
  const rows = calls.length <= 1 ? [[source, ...calls].filter(Boolean)] : [...(source ? [[source]] : []), ...calls.map((b) => [b])];
  // Username'i bor odamning lichkasi matnda (format.js senderLine, t.me havola); yo'g'ida — id bo'yicha tugma.
  // Bot API sinovi (2026-11-16): matndagi tg://user?id havolasini botga yozmagan odam uchun Telegram olib tashlaydi,
  // tugmani esa qabul qiladi — haydovchining Telegram'i o'sha odamni tanisa (masalan, bir guruhda) ochiladi
  if (lichka && post?.senderKnown && !post?.sender && /^\d+$/.test(String(post?.senderId ?? ""))) rows.push([InlineKeyboard.url(`💬 ${SENDER_TEXT}`, `tg://user?id=${post.senderId}`)]);
  const filled = rows.filter((r) => r.length);
  return filled.length ? InlineKeyboard.from(filled) : null;
}

// Guruh yoki kanal xabaridan navbat uchun e'lon
export function postFromMessage(chat, message) {
  const text = message.text ?? message.caption;
  if (!text || text.trim().length < 20) return null;
  const source = chat.username ? `@${chat.username}` : String(chat.id);
  const link = chat.username
    ? `https://t.me/${chat.username}/${message.message_id}`
    : String(chat.id).startsWith("-100")
      ? `https://t.me/c/${String(chat.id).slice(4)}/${message.message_id}`
      : null;
  // Yozgan odam («💬 Lichkasi»): kanal nomidan yozilgan (sender_chat) yoki bot bo'lsa — yo'q
  const person = message.sender_chat || message.from?.is_bot ? null : message.from;
  const sender = telegramUsername(person?.username);
  return { source, messageId: message.message_id, link, text: text.trim(), postedAt: message.date * 1000, sender };
}

// botInfo — testda Telegram'ga ulanmasdan ishlatish uchun (odatda init() o'zi oladi)
// appUrl — Mini App manzili HOZIR: .env dagi MINIAPP_URL yoki ishlab turgan tunnel bergani (main.js). Tunnel qayta yoqilsa,
// manzil o'zgaradi — shuning uchun har safar shu funksiyadan so'raladi, ishga tushganda bir marta emas.
// linkToken(chatId) — Mini App tugmasiga qo'shiladigan kirish tokeni (main.js: @yuk/store sessions.link; bir hafta bir xil)
// callLink({ loadId, phone, chatId }) — «📞 Telefon qilish» sahifasi tokeni (main.js: @yuk/store createCallLinks); null — tugma yo'q
// postCallLink({ postId, phone, chatId }) — o'sha, tezkor xabar uchun (yuk hali tushunilmagan — e'lonning o'zi bo'yicha)
// parseLoad(text) — yuk beruvchi chatga yozgan yukni tushunish (main.js: qoidaviy parser, bo'lmasa AI; null — AI band);
// onLoadQueued() — yuk beruvchining yuki navbatga tushdi (main.js: ishchi darhol uyg'onadi)
// transcribeVoice(data, mime) — yuk beruvchining ovozli xabari → matn (main.js: Gemini, ilova chati bilan bir xil) | null
// downloadFile(filePath) — Telegram'dagi fayl (getFile.file_path) → Buffer (testda soxta)
export function createBot({
  actionHoldMs = 60_000, // har amaldan keyin e'lonlar shu chatga qancha uzilib turadi (testlar 0 beradi)
  token,
  store,
  config,
  log = console.log,
  botInfo,
  appUrl = () => config.miniappUrl,
  linkToken = () => null,
  callLink = () => null,
  postCallLink = () => null,
  parseLoad = async () => null,
  onLoadQueued = () => {},
  transcribeVoice = async () => null,
  downloadFile = null,
  apkDir = APK_DIR, // Android ilova (serverda yig'ilgan APK + latest.json, @yuk/store appRelease.js)
  mediaDir, // ovozli xabar / dumaloq videoning asl fayllari (collector yozadi); berilmasa — @yuk/store MEDIA_DIR
  catchUpMs = 2 * 60_000, // e'lon olish boshlanganda shuncha oldingi e'lonlar ham (pipeline catchUp)
  catchUpDelayMs = 1500, // javob xabari («✅ Tayyor!») oldin borsin
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const mediaDirFile = (post) => mediaFileOf(post, ...(mediaDir ? [mediaDir] : []));
  // Telegram "juda tez" (429) desa, aytilgan vaqtcha kutib qayta yuboradi
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  // «Menu» tugmasi (buyruqlar ro'yxati) — faqat rol tanlaganlarda (commands.js). main.js commands.start() ni chaqiradi
  const commands = createCommandSync({ api: bot.api, store, log });

  // Ochilmay qolgan oyna chatni uzib qo'ymasin (2026-11-27, Azimjon: «#303983 … 5149275321 ga yetmagan»). Oyna (🎛 Filtr va
  // ro'yxatlari, savol-javob…) avval chatni uzadi (holdWindow, bazada), keyin xabar chiziladi. 26.11 19:00 da «📌 Guruh
  // tanlash» Telegram'dan 400 qaytardi (guruh nomi emoji o'rtasidan kesilgan edi, c3de3b3) — odam oynani ko'rmadi, yopa
  // olmadi, uzilish esa bazada qoldi: bot qayta yoqilgandan keyin ham 20:28 gacha unga birorta e'lon bormadi.
  // Endi: shu update ichida oyna ochilgan bo'lsa-yu, update xato bilan tugasa — uzilish darhol yechiladi
  const openedNow = new Set(); // shu update'da holdWindow chaqirilgan chatlar
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.type === "private" ? ctx.chat.id : null;
    if (chatId != null) openedNow.delete(chatId);
    try {
      await next();
    } catch (error) {
      if (chatId != null && openedNow.has(chatId)) {
        release(chatId);
        log(`${chatId}: oyna ochilmadi (${error.description ?? error.message}) — chat uzilmadi, e'lonlar kelaveradi`);
      }
      throw error;
    } finally {
      if (chatId != null) openedNow.delete(chatId);
    }
  });

  // Collector botga forward qilgan ovozli xabar / dumaloq video (media.js showSender: yozuvchini botga «ko'rsatish», darhol
  // o'chiriladi) — javob yozilmaydi, faollik ham sanalmaydi
  bot.use(async (ctx, next) => {
    const m = ctx.message;
    if (ctx.chat?.type === "private" && m?.forward_origin && (m.voice || m.video_note || m.audio)) return;
    await next();
  });

  // Oxirgi faollik (boshqaruv markazida «🟢 Hozir botda»): shaxsiy chatdagi har xabar yoki tugmadan KEYIN —
  // yangi foydalanuvchining yozuvi handler ichida yaratiladi, /ochirish dan keyin esa yozadigan joy qolmaydi
  // Hisobini o'chirgan odam yana yozsa yoki tugma bossa — qaytdi (store.comeBack: «o'chirilgan» belgisi olinadi, qaytgan
  // vaqti tarixga yoziladi; bot uni yangi odamdek ko'radi). /ochirish tugmalarining o'zi (del:...) qaytish emas.
  bot.use(async (ctx, next) => {
    const personal = ctx.chat?.type === "private" && ctx.from && (ctx.message || ctx.callbackQuery);
    if (personal && !/^del:/.test(ctx.callbackQuery?.data ?? "")) {
      try {
        store.comeBack?.(ctx.from.id, "bot");
      } catch (error) {
        log(`Qaytish yozilmadi: ${error.message}`);
      }
    }
    await next();
    if (!personal) return;
    try {
      store.touchDriver?.(ctx.from.id, "bot");
    } catch (error) {
      log(`Oxirgi faollik yozilmadi: ${error.message}`);
    }
    // Rol hozir tanlandi yoki olib tashlandi (/ochirish) — «Menu» tugmasi darhol paydo bo'ladi / yo'qoladi
    try {
      await commands.sync(ctx.from.id);
    } catch (error) {
      log(`Menu tugmasi yangilanmadi: ${error.description ?? error.message}`);
    }
  });

  // Blok (boshqaruv markazidan; Azimjon, 2026-11-09): id, username (Telegram'dan kelgan hozirgisi) yoki bazadagi raqam
  // ro'yxatda bo'lsa — hech narsa bajarilmaydi, faqat «Uzr, sizga xizmat ko'rsata olmaymiz!» (pastki menyu ham olinadi).
  // Tugma bosilsa — oynachada. .env ADMIN_IDS dagilar bloklanmaydi (egasi o'zini qulflab qo'ymasin).
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || !(ctx.message || ctx.callbackQuery)) return next();
    if ((config.admins ?? []).includes(ctx.from.id)) return next();
    const ban = store.banOf?.({ chatId: ctx.from.id, username: ctx.from.username, phone: store.getDriver(ctx.from.id)?.phone });
    if (!ban) return next();
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: BLOCKED_TEXT, show_alert: true }).catch(() => {});
      return;
    }
    await ctx.reply(BLOCKED_TEXT, { reply_markup: { remove_keyboard: true } });
  });

  // Kanal va guruhga a'zolik (members.js; Azimjon, 2026-11-09). REQUIRED_CHATS bo'sh bo'lsa — yo'q, bot hammaga ishlaydi.
  // Telegram'dan haqiqiy javob kelganda bazaga yoziladi — boshqaruv markazida «🔒 A'zo emas» ko'rinadi
  // Ro'yxat — boshqaruv markazidagi «🔒 A'zolik» (store.requiredChatRefs), u yerda o'zgartirilmagan bo'lsa — .env;
  // syncMembers() (main.js, har 20 s) o'zgarishni oladi. Ro'yxat bo'sh — members.active() false, bot hammaga ishlaydi
  const requiredRefs = () => store.requiredChatRefs?.(config.requiredChats ?? []) ?? config.requiredChats ?? [];
  const members = createMembership({
    api: bot.api,
    refs: requiredRefs(),
    log,
    onChecked: (userId, result) => {
      try {
        store.setSubscription?.(userId, result);
      } catch (error) {
        log(`A'zolik yozilmadi: ${error.message}`);
      }
    },
  });
  const syncMembers = () => members.reload(requiredRefs(), bot.botInfo?.id);

  // To'siq: shaxsiy chatdagi xabar yoki tugma — avval a'zolik. A'zo bo'lmasa — «a'zo bo'ling» xabari va tugmalar,
  // xabarning o'zi bajarilmaydi (next() chaqirilmaydi). Guruh va kanal postlari, «✅ A'zo bo'ldim», /ochirish va uning
  // tugmalari (ma'lumotini o'chirish huquqi a'zolikka bog'liq emas), /id va adminlar — tekshirilmaydi.
  // A'zo natijasi 10 daqiqa eslab qolinadi (Telegram'ga har xabarda so'rov ketmaydi), «a'zo emas» — har safar qayta so'raladi.
  const FREE_COMMAND = /^\/(ochirish|id)(@\w+)?(\s|$)/;
  // A'zo bo'lmay ilovaga kirmoqchi bo'lgan: userId → { code, at }. A'zo bo'lgach («✅ A'zo bo'ldim») — bog'lash so'raladi
  const pendingAppLogin = new Map();
  const PENDING_APP_MS = 10 * 60_000; // ilovadagi kod ham 10 daqiqa (store appLogins.js)
  bot.use(async (ctx, next) => {
    if (!members.active() || ctx.chat?.type !== "private" || !ctx.from || !(ctx.message || ctx.callbackQuery)) return next();
    const data = ctx.callbackQuery?.data ?? "";
    // Ilovaga kirish (/start app_…, «✅ Ha, bog'layman») ham to'siqdan o'tmaydi (Azimjon, 2026-11-26: «majburiy a'zo
    // bo'lmagunigacha bot umuman yordam ko'rsatmasin»). Kod eslab qolinadi — «✅ A'zo bo'ldim» dan keyin so'raladi
    if (data === SUB_CHECK || /^del:/.test(data) || FREE_COMMAND.test(ctx.message?.text ?? "")) return next();
    if (isAdmin(store.getDriver(ctx.from.id) ?? { chatId: ctx.from.id }, config.admins ?? [])) return next();
    rememberUser(ctx); // yangi odam ham boshqaruv markazida ko'rinsin (va a'zoligi yozilsin)
    const result = await members.check(ctx.from.id, { fresh: true });
    if (result.ok) return next();
    const app = /^\/start(?:@\w+)? app_([A-Za-z0-9_-]{20,48})$/.exec(ctx.message?.text ?? "");
    if (app) pendingAppLogin.set(ctx.from.id, { code: app[1], at: Date.now() });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Avval kanal va guruhimizga a'zo bo'ling" }).catch(() => {});
    await sendJoinPrompt(ctx, result.missing);
  });

  // Har qanday amal ham chatni uzadi (2026-11-19, Azimjon: «botda amal sodir bo'lganida ham … Filtr tugmasini bosganimda
  // vahokazo btn yoki /... qilinganida»): shaxsiy chatdagi har xabar, tugma yoki buyruq kelishi bilan e'lonlar shu chatga
  // ACTION_HOLD_MS uziladi va yo'ldagi e'lon yetib borguncha kutiladi — botning javobi doim e'londan keyin chiqadi, javobni
  // o'qiyotganda e'lon aralashmaydi. Oxirgi amaldan ACTION_HOLD_MS o'tgach o'zi ulanadi. Sozlash oynalari (Filtr, guruhlar…)
  // esa amal tugaguncha ushlaydi (holdWindow, bazada); «✅ Tayyor», saqlash, «⏸ Pauza / ▶️ Davom ettirish» — darhol ulaydi.
  // Ochiq amal bor bo'lsa, har bosish uning vaqtini yangilaydi (eslatma oxirgi bosishdan HOLD_REMIND_MS keyin)
  const ACTION_HOLD_MS = actionHoldMs;
  const HOLD_END = "hold:end"; // eslatmadagi «✅ Tugatish» tugmasi
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private" && ctx.from && (ctx.message || ctx.callbackQuery)) {
      const open = store.getDriver(ctx.chat.id)?.hold;
      if (open && ctx.callbackQuery?.data !== HOLD_END) store.setHold?.(ctx.chat.id, open.kind);
      await (ACTION_HOLD_MS > 0 ? hold(ctx.chat.id, ACTION_HOLD_MS) : drain(ctx.chat.id));
    }
    return next();
  });

  const isChannel = (chat) =>
    config.channel && (chat.id === config.channelId || (chat.username && `@${chat.username}`.toLowerCase() === config.channel.toLowerCase()));
  const isOwnEcho = (message) =>
    message.is_automatic_forward ||
    (message.sender_chat && isChannel(message.sender_chat)) ||
    (bot.botInfo && message.from?.id === bot.botInfo.id) ||
    message.via_bot?.id === bot.botInfo?.id;

  const scope = config.routeScope; // yo'nalish doirasi: sozlamalarda qaysi davlatlar tanlanadi
  // Pastki menyu (Mini App manzili + shu odamning tokeni har safar yangidan — tunnel yoki hafta almashsa ham to'g'ri).
  // Rol tanlanmaguncha menyu YO'Q (Azimjon, 2026-11-10: «rol tanlamagunigacha pastki menyu chiqmasin») — tugmalarini
  // bosib adashmasin. Ilgari ko'rsatilgan menyu bo'lsa (masalan, hisobdan chiqqan odamda) — olib tashlanadi.
  // Rol tanlangach (chooseRole) birinchi javob bilan menyu chiqadi.
  const menu = (driver) => {
    if (!roleOf(driver)) return { reply_markup: { remove_keyboard: true } };
    const url = appUrl() ?? null;
    const token = driver?.chatId != null && url ? linkToken(driver.chatId) : null;
    return { reply_markup: mainMenu(driver, url, scope, { admin: isAdmin(driver, config.admins ?? []), token }) };
  };
  // Raqamni bot o'zi bir marta so'raydi — faqat haydovchidan (2026-11-27: yuk beruvchida raqam e'lon berishda so'raladi)
  const askPhoneFor = (driver) => roleOf(driver) !== "yuk_beruvchi" && shouldAskPhone(driver);
  const html = (driver) => ({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...menu(driver) });

  // «📞 Telefon qilish» sahifasining manzili: Mini App bilan bir server (nginx /pub/ ni haydovchilar serveriga uzatadi).
  // Faqat https — Telegram tugmada boshqasini qabul qilmaydi (xabar umuman ketmay qolardi). loadId — loads jadvalidagi id
  const callUrl = (chatId, loadId) => (phone) => {
    const base = appUrl();
    if (loadId == null || !base?.startsWith("https://")) return null;
    const link = callLink({ loadId, phone, chatId });
    return link ? new URL(`/pub/call?c=${link}`, base).href : null;
  };
  // Tezkor xabardagi «📞 Telefon qilish»: o'sha sahifa, token e'lon id'si bilan (server raqamni e'lon matnidan oladi)
  const rawCallUrl = (chatId, postId) => (phone) => {
    const base = appUrl();
    if (postId == null || !base?.startsWith("https://")) return null;
    const link = postCallLink({ postId, phone, chatId });
    return link ? new URL(`/pub/call?c=${link}`, base).href : null;
  };

  // Profil matni: «📌 Guruhlar» qatorida @nomi o'rniga guruh sarlavhasi (bo'lsa)
  const describe = (profile, role) => {
    const titles = store.sourceTitles?.() ?? {};
    return describeProfile(profile, scope, role, { sourceName: (name) => titles[name.toLowerCase()] ?? name });
  };

  // «🗺 Xaritadan tanlash» (yo'nalish; Azimjon, 2026-11-10) — web ilovaning xarita sahifasi (?v=yonalish, f — tanlangan
  // «Qayerdan»). Faqat https (Telegram web_app tugmasi boshqasini qabul qilmaydi). Kirish tokeni (?t=) QO'SHILMAYDI:
  // inline tugmadan ochilgan Mini App'ga Telegram kimlikni o'zi beradi (initData), inline tugmali xabarni esa boshqaga
  // yo'naltirish (forward) mumkin — token u bilan begona qo'lga o'tmasin
  const routeMapUrl = (from = null) => {
    const base = appUrl();
    if (!base?.startsWith("https://")) return null;
    const url = new URL(miniAppUrl(base, null, scope, { view: "yonalish", role: "haydovchi" }));
    if (from) url.searchParams.set("f", from);
    return url.href;
  };

  // Haydovchi ro'yxatdan o'tish formasi (matndan preview'dagi «✏️ Formada tuzatish» uchun). Inline Mini App initData oladi,
  // shuning uchun ?t= token shart emas (route.js xaritasidagidek)
  const regFormUrl = () => {
    const base = appUrl();
    return base ? miniAppUrl(base, null, scope, { role: "haydovchi" }) : null;
  };

  // Botga yozilgan yuk: tushunish → raqam (yo'q bo'lsa) → tasdiqlash → navbat (shipperLoads.js)
  // «✏️ Formada tuzatish» yo'q (2026-11-27: yuk faqat chatda — matn yoki ovoz; xato bo'lsa qaytadan yozadi)
  const desk = createLoadDesk({ store, parse: parseLoad, scope, onQueued: () => onLoadQueued() });

  function rememberUser(ctx) {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return store.saveDriver(ctx.chat.id, { name, username: from.username ?? null });
  }

  // Oxirgi 24 soatdagi mos e'lonlar: haydovchiga yuklar, yuk beruvchiga bo'sh mashinalar
  // Profil bo'lmasa (yuk beruvchi — Azimjon, 2026-11-12: ro'yxatdan o'tish shart emas) — {} bilan tekshiramiz:
  // matchTruck uchun bo'sh cheklovlar = cheklov yo'q, ya'ni ro'yxatsiz yuk beruvchi FILTRSIZ ro'yxat oladi
  function matching(user) {
    // Tezkor / guruhlarim yoki mashinasi kiritilmagan haydovchi — saralangan ro'yxat yo'q (matchLoad mashinasiz hammasini olardi)
    if (roleOf(user) === "haydovchi" && !sortedReady(user.profile)) return [];
    const kind = ROLE_KIND[roleOf(user)];
    const matches = KIND_MATCHERS[kind];
    const allowed = planFilter(user, store.sourceOwners); // obuna: yopiq guruh — Max / Pro'ning o'ziniki; ovozli — Pro/Max
    return store
      .recentLoads({ sinceMs: LOADS_WINDOW_MS, limit: LOADS_LIMIT, kind })
      .filter((row) => allowed(row.post.source, row.post.media) && matches(row.load, user.profile ?? {}).ok);
  }

  // Yangi xabar yoki o'sha xabarni o'zgartirish (tugma bosilganda). "message is not modified" — o'sha tugma ikki marta bosildi.
  // → xabar raqami (message_id) yoki null
  async function render(ctx, text, options, edit) {
    const shown = ctx.callbackQuery?.message?.message_id ?? null;
    if (edit) {
      try {
        await ctx.editMessageText(text, options);
        return shown;
      } catch (error) {
        if (error instanceof GrammyError && /not modified/.test(error.description)) return shown;
      }
    }
    const message = await ctx.reply(text, options);
    return message?.message_id ?? null;
  }

  // Chatdagi yo'nalish tanlash xabari: xaritada tanlansa, bot aynan shu xabarni «✅ Yo'nalish: …» ga almashtiradi
  function rememberRouteMessage(chatId, messageId) {
    try {
      store.setRouteMessage?.(chatId, messageId);
    } catch (error) {
      log(`Yo'nalish xabari yozilmadi: ${error.message}`);
    }
  }

  // «🔒 Botdan foydalanish uchun ... a'zo bo'ling» + a'zo bo'lish tugmalari + «✅ A'zo bo'ldim» (members.js joinPrompt)
  async function sendJoinPrompt(ctx, missing, { edit = false } = {}) {
    const { text, keyboard } = joinPrompt(members.chats(), missing);
    await render(ctx, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard }, edit);
  }

  // A'zo bo'lmagan foydalanuvchiga eslatma (yuk kelganda yoki kanaldan chiqqanda): kuniga ko'pi bilan bir marta
  // (drivers.sub_reminded_at). reason: "load" | "left" (members.js remindText)
  async function remindJoin(chatId, missing, reason) {
    const user = store.getDriver(chatId);
    if (!user || user.deletedAt || isAdmin(user, config.admins ?? [])) return;
    if (user.subRemindedAt != null && Date.now() - user.subRemindedAt < REMIND_EVERY_MS) return;
    const t = ROLE_TEXT[roleOf(user)] ?? ROLE_TEXT.haydovchi;
    const { text, keyboard } = remindText(members.chats(), missing, { reason, one: t.one, many: t.many });
    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard });
      store.markSubReminded?.(chatId);
    } catch (error) {
      // 403 — botni bloklagan: deliver dagidek pauza
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(chatId, { active: false, why: "blocked" });
      else log(`A'zolik eslatmasi yuborilmadi (${chatId}): ${error.description ?? error.message}`);
    }
  }

  // «📋 Mos yuklar» → «📍 Qayerdan yuk olasiz?» (route.js). Tugmalarda yuklar soni yo'q (2026-11-10 dan);
  // oxirida «🗺 Xaritadan tanlash» (web xaritasi, https manzil bo'lsa)
  async function askRoute(ctx, driver, { edit = false } = {}) {
    const { text, keyboard } = fromStep({ profile: driver.profile, scope, mapUrl: routeMapUrl() });
    rememberRouteMessage(ctx.chat.id, await render(ctx, text, { parse_mode: "HTML", reply_markup: toKeyboard(keyboard) }, edit));
  }

  // «Iltimos, rolingizni tanlang» (yoki /rol da — hozirgi rol) — ikki tugma (r:haydovchi / r:yuk_beruvchi).
  // Azimjon, 2026-11-12 (aniqlik): pastki menyu (reply keyboard) va menyuni ochib-yopuvchi tugma FAQAT rol
  // tanlanmagan hisobda yo'q bo'ladi; rol tanlangan odamda «🔄 Rolni almashtirish» / /rol so'rovi paytida
  // ham pastki menyu KO'RINIB TURADI. Shuning uchun bu yerda remove_keyboard yo'q — oddiy bitta xabar va
  // inline roleKeyboard(); inline tugmalar reply keyboardni yashirmaydi. Menyu faqat menu()ning
  // remove_keyboard'ida (rol yo'q) va /start oldidan o'chiriladi.
  async function askRole(ctx, driver = null) {
    const role = roleOf(driver);
    const text = role
      ? `Hozir siz: <b>${ROLES[role].icon} ${ROLES[role].name}</b>.\n${ROLE_SWITCH_NOTE}`
      : ROLE_QUESTION;
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: roleKeyboard() });
  }

  async function showStep(ctx, draft, { edit = false } = {}) {
    const { text, keyboard } = renderStep(draft);
    const options = { reply_markup: toKeyboard(keyboard) };
    if (edit) {
      try {
        await ctx.editMessageText(text, options);
        return;
      } catch (error) {
        // "message is not modified" — o'sha tugma ikki marta bosildi, hech narsa qilmaymiz
        if (error instanceof GrammyError && /not modified/.test(error.description)) return;
      }
    }
    await ctx.reply(text, options);
  }

  // Chatni e'lonlardan uzish — ikki xil (2026-11-19, Azimjon):
  // 1) Ochiq amal (holdWindow): sozlash oynasi (🎛 Filtr va uning ro'yxatlari, savol-javob, «➕ Guruh qo'shish», raqam so'rovi)
  //    ochilgan — e'lonlar shu chatga AMAL TUGAGUNCHA umuman kelmaydi («3 daqiqada o'zi tugasin — xato! amal yakunlanmaguncha
  //    e'lon kelishi xato»). Bazada (drivers.hold_kind) — bot qayta yoqilsa ham saqlanadi. Tugaydi: «✅ Tayyor», saqlash,
  //    havola qabul qilindi, raqam ulashildi / «Keyinroq», ⏸/▶️ yoki eslatmadagi «✅ Tugatish» (release). Odam tashlab ketsa —
  //    HOLD_REMIND_MS dan keyin BIR marta eslatma (holdReminder), e'lonlar baribir kelmaydi.
  // 2) Har qanday amal (hold, xotirada): tugma/buyruq/xabar — ACTION_HOLD_MS (60 s) uziladi, javobni o'qib olsin.
  // Ikkalasi ham yo'ldagi e'lon yetib borishini kutadi (drain) — botning javobi doim e'londan keyin.
  const HOLD_REMIND_MS = 3 * 60_000;
  const busy = new Map(); // chatId → qachongacha (faqat 2-tur)
  // ms — qancha vaqt uzilib turadi (oldingi uzunroq muddat qisqartirilmaydi)
  const hold = (chatId, ms) => (busy.set(chatId, Math.max(busy.get(chatId) ?? 0, Date.now() + ms)), drain(chatId));
  const holdWindow = (chatId, kind) => (openedNow.add(chatId), store.setHold?.(chatId, kind), drain(chatId));
  // release — haydovchi e'lon olishni (qayta) boshlaydi: oxirgi catchUpMs dagi mos e'lonlar ham yuboriladi (main.js
  // setCatchUp → pipeline catchUp). Biroz keyin — saqlash va javob xabari tugasin; pauza bosilgan bo'lsa catchUp o'zi qaytadi
  let catchUpFn = null;
  const release = (chatId) => {
    busy.delete(chatId);
    store.clearHold?.(chatId);
    if (!catchUpFn) return;
    const since = Date.now() - catchUpMs;
    const timer = setTimeout(() => {
      try {
        catchUpFn(chatId, since);
      } catch (error) {
        log(`${chatId}: oxirgi e'lonlar yuborilmadi — ${error.message}`);
      }
    }, catchUpDelayMs);
    timer.unref?.();
  };
  function isBusy(chatId) {
    if (store.getDriver(chatId)?.hold) return true;
    const until = busy.get(chatId);
    if (until == null) return false;
    if (Date.now() <= until) return true;
    busy.delete(chatId);
    return false;
  }

  // «Charxpalak» (2026-11-19, Azimjon: «pauza — charxpalakni to'xtatish emas, uzib qo'yish; charxpalak aylanaverishi kerak»):
  // e'lon yuborish hammaga davom etadi, lekin pauza/sozlash oynasi bosilgan chat o'sha zahoti uziladi. Har bir yuk xabari
  // (tezkor, yuk beruvchining o'zi yuborgani) shaxsiy chatga faqat guarded() orqali ketadi: tekshiruv — so'rov jo'natilishidan
  // bir zum oldin (oraliqda await yo'q), jo'natilayotgan so'rov inflight'da turadi. Pauza / oyna handleri avval holatni
  // yozadi, keyin drain() bilan yo'ldagi so'rov tugashini kutib, shundan keyingina javob beradi — «⏸ To'xtatildi» doim oxirgi
  const inflight = new Map(); // chatId → Set<Promise> — hozir Telegram'ga ketayotgan yuk xabarlari
  function gateReason(chatId) {
    if (isBusy(chatId)) return "band: sozlash oynasi ochiq";
    if (store.getDriver(chatId)?.active === false) return "pauza";
    return null;
  }
  function guarded(chatId, send) {
    const why = gateReason(chatId);
    if (why) return Promise.resolve({ ok: false, error: why });
    const job = (async () => send())();
    const set = inflight.get(chatId) ?? new Set();
    set.add(job);
    inflight.set(chatId, set);
    const done = () => {
      set.delete(job);
      if (!set.size && inflight.get(chatId) === set) inflight.delete(chatId);
    };
    job.then(done, done);
    return job;
  }
  function drain(chatId) {
    const set = inflight.get(chatId);
    return set ? Promise.allSettled([...set]).then(() => {}) : Promise.resolve();
  }

  async function startWizard(ctx, profile = null, role = "haydovchi") {
    await holdWindow(ctx.chat.id, "wizard");
    const draft = newDraft(profile, scope, role);
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  }

  // Sozlamalar: Mini App bo'lsa — pastki menyudagi tugma uni ochadi; bo'lmasa — chatda savol-javob.
  // Yuk beruvchida savol-javob yo'q (Azimjon, 2026-11-12: ro'yxatdan o'tish shart emas) — iqtisodiy qisqa javob:
  // uning uchun sozlamalar IXTIYORIY, «🚚 Bo'sh mashinalar» sozlamasiz ham ochiladi
  async function openSettings(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    if (!appUrl()) {
      if (role === "yuk_beruvchi") {
        await ctx.reply(`📦 Yukingizni shu chatga yozing yoki ovozli xabar qiling — sozlash shart emas.`, menu(driver));
        return;
      }
      return startWizard(ctx, driver.profile, role);
    }
    await ctx.reply(`Pastdagi «${settingsLabel(driver)}» tugmasini bosing — forma ochiladi. To'ldirib, «Saqlash» ni bosasiz.`, menu(driver));
  }

  async function saved(ctx, profile, role) {
    release(ctx.chat.id);
    // Mini App boshqa rol bilan saqladi (masalan, formada rolni almashtirib) — avval eski rolning sozlamalarini saqlab qo'yamiz
    if (store.getDriver(ctx.chat.id)?.role !== role) store.switchRole(ctx.chat.id, role);
    // Haydovchi formasida yo'nalish yo'q (u «📋 Mos yuklar» da tanlanadi) — eskisi qoladi. Rejimni yubormagan forma
    // (chatdagi savol-javob, eski Mini App) — rejim ham eskisicha (withPrevFeed)
    if (role === "haydovchi") {
      const prev = store.getDriver(ctx.chat.id)?.profile;
      profile = withRoute(withPrevFeed(profile, prev), prev);
    }
    // Pauza saqlanadi (2026-11-25): sozlamani saqlash pauzani bekor qilmaydi, faqat birinchi ro'yxatdan o'tish yoqadi
    const wasSet = Boolean(store.getDriver(ctx.chat.id)?.profile);
    const driver = store.saveDriver(ctx.chat.id, { role, profile, draft: null, ...(wasSet ? {} : { active: true }) });
    const t = ROLE_TEXT[role];
    // Yangi haydovchi: yo'nalish tanlanmaguncha yuk yuborilmaydi. Tartib (Azimjon, 2026-11-10): forma → raqam (bir marta,
    // ixtiyoriy) → yo'nalish. Raqamga javob bergach (ulashdi yoki «Keyinroq») — afterPhone() yo'nalishni so'raydi.
    // 2026-11-07…10 da raqam yo'nalishdan KEYIN so'ralardi.
    if (role === "haydovchi" && sortedReady(profile) && !routeChosen(profile)) {
      if (askPhoneFor(driver)) {
        // Faqat «✅ Saqlandi.» — sozlamalar ro'yxatisiz (Azimjon, 2026-11-10): uzun ro'yxat keyingi raqam savolini
        // ekrandan chiqarib yuborardi; xato bo'lsa — «⚙️ Sozlamalar» da ko'radi va tuzatadi.
        // Menyusiz: darhol keyingi xabardagi raqam klaviaturasi uning o'rnini oladi, menyu javobdan keyin qaytadi
        await ctx.reply("✅ Saqlandi.");
        await askPhone(ctx, driver);
        return;
      }
      await ctx.reply(`✅ Saqlandi.\n\n${describe(profile, role)}\n\n${ROUTE_NEXT}`, menu(driver));
      await askRoute(ctx, driver);
      return;
    }
    // Birinchi marta sozlagach (yuk beruvchi, yoki yo'nalishi tiklangan haydovchi) — raqamni bir marta so'raymiz (ixtiyoriy).
    // Shunda ham faqat «✅ Saqlandi.» (Azimjon, 2026-11-10: yuk beruvchida ham — ro'yxat raqam savolini ekrandan chiqarardi)
    if (askPhoneFor(driver)) {
      await ctx.reply("✅ Saqlandi.");
      await askPhone(ctx, driver);
      return;
    }
    // Qayta saqlash (raqam allaqachon so'ralgan) — sozlamalar ro'yxati va 24 soatdagi mos e'lonlar soni bilan
    const count = matching(driver).length;
    const extra = count ? `\n\nOxirgi 24 soatda sizga mos ${count} ta ${t.one} bor — «${matchesLabel(driver)}» ni bosing.` : "";
    const head = role === "haydovchi" && !sortedReady(profile) ? "✅ Saqlandi." : `✅ Saqlandi. Endi mos ${t.many} shu yerga keladi.`;
    await ctx.reply(`${head}\n\n${describe(profile, role)}${extra}`, menu(driver));
  }

  // Raqam so'rash: bir martalik klaviatura «📱 Raqam ulashish» / «⏭ Keyinroq» (yoki raqami bo'lsa — «O'zgartirmaslik»).
  // Qachon so'ralgani yoziladi — bot o'zi boshqa so'ramaydi (faqat /raqam bilan foydalanuvchining o'zi).
  const askPhone = (ctx, driver) => askPhoneIn(ctx.chat.id, driver);
  // chatId bo'yicha — xaritadan kelgan topshiriqda ham (routeFromWeb; u yerda ctx yo'q)
  async function askPhoneIn(chatId, driver) {
    store.saveDriver(chatId, { phoneAskedAt: Date.now() });
    const text = driver.phone
      ? `📱 Sizning raqamingiz: <b>${escapeHtml(formatContactPhone(driver.phone))}</b>\n` +
        `Almashtirish uchun pastdagi «${PHONE.change}», o'chirish uchun «${PHONE.remove}» tugmasini bosing.`
      : `📱 <b>Telefon raqamingizni ulashasizmi?</b>\n${PHONE_WHY}`;
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: phoneKeyboard(Boolean(driver.phone)) });
  }

  // Raqamga javobdan keyin (ulashdi / «Keyinroq» / «O'zgartirmaslik»): menyu qaytadi; yo'nalishi yo'q haydovchiga —
  // darhol «Qayerdan?» (ro'yxatdan o'tish shu bilan tugaydi: forma → raqam → yo'nalish)
  // hint: false — «Endi qayerdan qayerga…» qo'shilmaydi (raqam saqlangach — faqat «Raqamingiz saqlandi! ✅»)
  async function afterPhone(ctx, driver, text, { hint = true } = {}) {
    const needsRoute = roleOf(driver) === "haydovchi" && sortedReady(driver.profile) && !routeChosen(driver.profile);
    await ctx.reply(needsRoute && hint ? `${text}\n\n${ROUTE_NEXT}` : text, menu(driver));
    if (needsRoute) await askRoute(ctx, driver);
  }

  // Rol tanlandi. Har rolning sozlamalari alohida saqlanadi (store.switchRole): bu rolda avval to'ldirgan bo'lsa —
  // o'shalar tiklanadi, bo'lmasa — to'ldirishni so'raymiz (haydovchi profili yuk beruvchiga to'g'ri kelmaydi).
  async function chooseRole(ctx, role) {
    const before = rememberUser(ctx);
    const changed = roleOf(before) !== role;
    const driver = changed ? store.switchRole(ctx.chat.id, role) : before;
    if (!changed && driver.profile) {
      await ctx.reply(`Siz allaqachon ${ROLES[role].name.toLowerCase()}siz — hech narsa o'zgarmadi.`, menu(driver));
      return;
    }
    if (driver.profile) {
      const t = ROLE_TEXT[role];
      await ctx.reply(
        `${ROLES[role].icon} Siz: <b>${ROLES[role].name}</b>. Oldingi sozlamalaringiz tiklandi — mos ${t.many} yana shu yerga keladi.\n\n` +
          `${escapeHtml(describe(driver.profile, role))}\n\nO'zgartirish — «${settingsLabel(driver)}».`,
        html(driver),
      );
      return;
    }
    // Yuk beruvchi (2026-11-10): darhol «📦 Yuk berish» — forma yoki oddiy xabar; bo'sh mashinalar uchun ro'yxatdan o'tish ixtiyoriy
    if (role === "yuk_beruvchi") {
      const t = ROLE_TEXT[role];
      // 2026-11-19: faqat «yukingizni yozing» — sozlamalar haqida gap yo'q (ixtiyoriy, /yordam da bor)
      await ctx.reply(loadIntro(), html(driver));
      return;
    }
    // Haydovchi, sozlamalar hali yo'q (2026-11-14): avval rejim — «mana shunaqa rejimlar bor» (feed.js). Saralangan
    // tanlansa — ro'yxatdan o'tishning 2 yo'li (registerPaths), tezkor/guruhlarim — mashinasiz, darhol
    // 2026-11-19 (Azimjon: «oddiy haydovchiga default tezkor rejimi, hamma tezkor rejimda!»): rejim so'ralmaydi — darhol tezkor
    // 2026-11-19: alohida «🚚 Haydovchisiz…» xabari yo'q (u eskirgan menyu bilan kelardi) — darhol «✅ Tayyor!» (feedSavedText)
    await startFeed(ctx);
  }

  // Saralangan rejim tanlandi, mashina hali yo'q: ro'yxatdan o'tishning 2 yo'li — forma yoki shu chatga yozish (driverText.js)
  async function registerPaths(ctx, driver, head = null) {
    const role = "haydovchi";
    if (appUrl()) {
      await ctx.reply(
        `${head ?? ROLE_TEXT[role].chosen}\n\n` +
          "Ro'yxatdan o'tishning 2 yo'li bor:\n" +
          `• «${settingsLabel(driver)}» — 1 daqiqalik forma;\n` +
          `• «${MENU.writeHere}» — mashinangizni shu chatga oddiy yozasiz, qolganini men qilaman.`,
        html(driver),
      );
      return;
    }
    await ctx.reply(head ?? ROLE_TEXT[role].chosen, html(driver));
    await startWizard(ctx, driver.profile, role);
  }

  // --- Yetkazish rejimi (feed.js; Azimjon, 2026-11-14) ---
  // «🎛 Filtr» endi faqat Mini App'da (2026-11-27, Azimjon: «Filtrni MiniApp da aloxida … saxifa och … Bo't chatidan olib
  // tashla»): transport, viloyat va guruhlar (🌍 Global / 👤 Akkauntimdagi) — ilovaning «🎛 Filtr» bo'limi (?v=filtr).
  // Pastki menyudagi tugma ilovani o'zi ochadi (menu.js); eski menyu tugmasi, /rejim va eski xabarlardagi fm:/fg:/fr:/ft:
  // tugmalari — shu xabar: ilovani ochadigan inline tugma. Inline tugmada token yo'q (Telegram kimlikni o'zi beradi)
  const filterUrl = () => {
    const base = appUrl();
    if (!base?.startsWith("https://")) return null;
    return miniAppUrl(base, null, scope, { view: "filtr", role: "haydovchi" });
  };
  async function openFilter(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    if (role !== "haydovchi") return ctx.reply("🎛 Filtr — haydovchilar uchun (qaysi yuklar kelsin). Rolni almashtirish: /rol", menu(driver));
    release(ctx.chat.id); // eski chat oynasidan qolgan uzilish bo'lsa — yechiladi
    const url = filterUrl();
    if (!url) return ctx.reply("🎛 Filtr ilovada ochiladi — ilova hozir ishlamayapti, birozdan keyin urinib ko'ring.", menu(driver));
    await ctx.reply("🎛 <b>Filtr ilovada</b>: mashina turi, qayerdan va qaysi guruhlardan yuk kelsin — shu yerda tanlaysiz 👇", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().webApp("🎛 Filtrni ochish", url),
    });
  }

  // Yangi haydovchi — darhol «🌐 Hamma guruhlar» (NEW_DRIVER_FEED_MODE, 2026-11-19); filtrni keyin ilovada o'zgartiradi
  async function startFeed(ctx) {
    const driver = rememberUser(ctx);
    const prev = feedOf(driver.profile);
    const feed = { mode: NEW_DRIVER_FEED_MODE, sources: [], ...(prev.regions.length ? { regions: prev.regions } : {}), ...(prev.trucks.length ? { trucks: prev.trucks } : {}) };
    const updated = store.saveDriver(ctx.chat.id, { role: "haydovchi", profile: rawProfile(feed, driver.profile), draft: null, ...(driver.profile ? {} : { active: true }) });
    await feedSaved(ctx, updated);
  }

  // Rejim saqlandi → matn (+ kerak bo'lsa ro'yxatdan o'tish, yo'nalish yoki raqam savoli). driver — bazadagi yangi holat
  async function feedSaved(ctx, driver) {
    release(ctx.chat.id);
    const { profile } = driver;
    const feed = feedOf(profile);
    const needsVehicle = FEED_MODES[feed.mode].vehicle && !profile.vehicle;
    await ctx.reply(feedSavedText(feed, { needsVehicle }), html(driver));
    if (driver.active === false) await ctx.reply(`⏸ Siz pauzadasiz — e'lonlar kelmaydi. Yoqish — «${MENU.resume}».`, menu(driver));
    if (needsVehicle && !FEED_MODES[feed.mode].groups) return registerPaths(ctx, driver, "👇 Mashinangizni kiriting.");
    if (sortedReady(profile) && !routeChosen(profile)) {
      await ctx.reply(ROUTE_NEXT, menu(driver));
      return askRoute(ctx, driver);
    }
    if (askPhoneFor(driver)) await askPhone(ctx, driver);
  }

  async function setActive(ctx, active) {
    release(ctx.chat.id);
    const driver = rememberUser(ctx);
    // Azimjon, 2026-11-12: «⏸ Pauza / ▶️ Davom ettirish» tugmalari pastki menyuda FAQAT haydovchida. Lekin handler
    // O'CHIRILMAGAN — eski menyuda bosilsa yoki idle DM'dagi inline «▶️ Davom ettirish» kelib qolsa ishlayveradi,
    // shuning uchun yuk beruvchida ham pauza profilsiz qabul qilinadi (profil faqat shaxsiy avtomatik xabarlar uchun)
    if (!driver.profile && roleOf(driver) !== "yuk_beruvchi") return openSettings(ctx);
    const updated = store.saveDriver(ctx.chat.id, { active });
    if (!active) await drain(ctx.chat.id); // yo'ldagi e'lon yetib borsin — «⏸ To'xtatildi» undan keyin, oxirgi xabar bo'ladi
    // Bot pauzasi faqat botniki — ilova (Yuk Ekspert) o'z pauzasi bilan alohida (Azimjon, 2026-11-25: «Ajrat!»)
    await ctx.reply(
      active ? "▶️ Yoqildi — botga yuklar yana keladi." : `⏸ To'xtatildi — botga yuk kelmaydi (ilovada alohida).\nQayta yoqish — «${MENU.resume}».`,
      menu(updated),
    );
  }

  // «📋 Mos yuklar» (haydovchi) yoki «🚚 Bo'sh mashinalar» (yuk beruvchi) — eski menyu tugmasi bosilsa ham hozirgi rol bo'yicha.
  // Haydovchidan avval yo'nalish so'raladi (route.js), yuk beruvchiga — darhol ro'yxat.
  // Yuk beruvchi profilsiz ham darhol ro'yxatni oladi (Azimjon, 2026-11-12: ro'yxatdan o'tish shart emas) — filtr
  // bo'lmagani cheklov yo'qligi (matching → matchTruck({})). Haydovchida esa avvalgi xatti-harakat: profil so'raladi
  async function showMatches(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    const t = ROLE_TEXT[role];
    if (!driver.profile && role !== "yuk_beruvchi") {
      await ctx.reply(`Avval ${t.setup} kiriting: «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    if (role === "haydovchi" && !sortedReady(driver.profile)) {
      const mode = FEED_MODES[feedMode(driver.profile)];
      // Tezkor / guruhlarim: ro'yxat kerak emas — yuklar o'zi darhol keladi
      if (!mode.sorted) {
        await ctx.reply(`Yuk e'lonlari o'zi darhol shu yerga keladi (${mode.icon} ${mode.name}). O'zgartirish — «${MENU.feed}».`, menu(driver));
        return;
      }
      await ctx.reply(`Avval ${t.setup} kiriting: «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    if (role === "haydovchi") return askRoute(ctx, driver);
    await listMatches(ctx, driver);
  }

  // Oxirgi 24 soatdagi mos e'lonlar (eng yangi LOADS_SHOWN tasi)
  const listMatches = (ctx, driver) => listMatchesIn(ctx.chat.id, driver);
  // chatId bo'yicha — xaritadan kelgan topshiriqda ham (routeFromWeb)
  async function listMatchesIn(chatId, driver) {
    const say = (text, other) => bot.api.sendMessage(chatId, text, other);
    const role = roleOf(driver);
    const t = ROLE_TEXT[role];
    const found = matching(driver);
    if (!found.length) {
      await say(`Oxirgi 24 soatda sizga mos ${t.one} chiqmadi. Yangisi chiqishi bilan shu yerga yuboraman.`, menu(driver));
      return;
    }
    const kind = ROLE_KIND[role];
    const icon = role === "yuk_beruvchi" ? "🚚" : "📋";
    const more = found.length > LOADS_SHOWN ? `, eng yangi ${LOADS_SHOWN} tasi` : "";
    await say(`${icon} Oxirgi 24 soatda sizga mos ${found.length} ta ${t.one}${more}:`, menu(driver));
    // Eskisidan yangisiga: eng yangisi chatda eng pastda turadi
    for (const row of found.slice(0, LOADS_SHOWN).reverse()) {
      const buttons = loadButtons(row.load, row.post, callUrl(chatId, row.id));
      await say(directText(row.load, row.post, kind), { ...html(driver), ...(buttons ? { reply_markup: buttons } : {}) });
    }
    if (driver.active === false) await say(`⏸ Siz pauzadasiz: yangi ${t.many} o'zi kelmaydi. Yoqish: «${MENU.resume}»`, menu(driver));
  }

  // Haydovchi yo'nalishni web xaritasida tanladi (server PUT /pub/me/route { notify: true } → bot_notices "route").
  // Chatda tugmalar bilan tanlagandagi kabi: «Qayerdan?» xabari «✅ Yo'nalish: …» ga almashadi (topilmasa — yangi xabar),
  // keyin mos yuklar ro'yxati va (hali so'ralmagan bo'lsa) raqam savoli.
  // Kanal/guruhga a'zo bo'lmasa — ro'yxat yo'q (bot unga baribir javob bermasdi), faqat yo'nalish xabari
  async function routeFromWeb(chatId) {
    const driver = store.getDriver(chatId);
    if (!driver || driver.deletedAt || roleOf(driver) !== "haydovchi" || !driver.profile || !routeChosen(driver.profile)) return;
    const text = chosenText(driver.profile);
    const messageId = store.routeMessage?.(chatId) ?? null;
    let shown = false;
    if (messageId) {
      try {
        await bot.api.editMessageText(chatId, messageId, text, { parse_mode: "HTML" });
        shown = true;
      } catch (error) {
        shown = error instanceof GrammyError && /not modified/.test(error.description);
      }
      rememberRouteMessage(chatId, null);
    }
    if (!shown) await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    if (members.active() && !isAdmin(driver, config.admins ?? []) && !(await members.check(chatId)).ok) return;
    await listMatchesIn(chatId, driver);
    if (askPhoneFor(driver)) await askPhoneIn(chatId, driver);
  }
  // Raqamini web sozlamalarida o'chirdi (server DELETE /pub/me/phone → bot_notices "phone_deleted"). Chatdagi pastki
  // menyu eskirdi («➕ Guruh qo'shish» turibdi) — botdagi «Faqat raqamni o'chirish» kabi yozib, menyuni yangilaymiz.
  // Shu orada qayta ulashgan bo'lsa (Mini App'dagi «📱 Raqam ulashish») — hech narsa demaymiz
  async function phoneDeletedFromWeb(chatId) {
    const driver = store.getDriver(chatId);
    if (!driver || driver.deletedAt || driver.phone) return;
    await bot.api.sendMessage(chatId, "✅ Raqamingiz o'chirildi.", menu(driver));
  }
  const notices = createNoticeLoop({ store, log, handlers: { route: routeFromWeb, phone_deleted: phoneDeletedFromWeb } });

  let apkFileId = null; // bir marta yuklangach, Telegram fayl id'si bilan qayta yuboriladi
  async function showApps(ctx) {
    const driver = rememberUser(ctx);
    const link = (url, text) => `<a href="${escapeHtml(url)}">${text}</a>`;
    const lines = ["📱 <b>Yuk Ekspert ilovalari</b>", ""];
    // Serverda yig'ilgan eng so'nggi APK — sayt orqali yuklab olinadi (botga 25 MB dan kattasi sig'maydi, 2026-11-25)
    const apk = readRelease(apkDir);
    const base = appUrl();
    const apkUrl = apk && base ? new URL(APK_PATH, base).href : null;
    if (apkUrl) {
      lines.push(`🤖 Android: ${link(apkUrl, "yuklab olish")} — versiya ${escapeHtml(apk.version)}, ${sizeText(apk.size)}`);
      lines.push("   Telefon «noma'lum manbadan o'rnatish» ga ruxsat so'rasa — ruxsat bering. Yangi versiya eskisining ustidan o'rnatiladi.");
    } else lines.push(`🤖 Android: ${config.androidUrl ? link(config.androidUrl, "yuklab olish") : config.apkFile ? "o'rnatish fayli pastda 👇" : "tez orada"}`);
    lines.push(`🍏 iPhone: ${config.iosUrl ? link(config.iosUrl, "App Store") : "tez orada"}`);
    if (appUrl() && roleOf(driver)) lines.push(`💬 Telegram ichida: pastdagi «${settingsLabel(driver)}» tugmasi ilovani ochadi`);
    if (config.channelLoads && config.channel?.startsWith("@")) lines.push(`📢 Hamma yangi yuklar kanalda: ${config.channel}`);
    const extra = apkUrl ? { ...html(driver), reply_markup: new InlineKeyboard().url(`⬇️ Android ilovani yuklab olish (${apk.version})`, apkUrl) } : html(driver);
    await ctx.reply(lines.join("\n"), extra);
    if (apkUrl || !config.apkFile) return;
    if (!apkFileId && !existsSync(config.apkFile)) {
      log(`APK fayl topilmadi: ${config.apkFile}`);
      return;
    }
    try {
      const caption = "🤖 Android uchun o'rnatish fayli. Telefon «noma'lum manbadan o'rnatish» ga ruxsat so'rasa — ruxsat bering.";
      const message = await ctx.replyWithDocument(apkFileId ?? new InputFile(config.apkFile), { caption });
      apkFileId ??= message.document?.file_id ?? null;
    } catch (error) {
      log(`APK yuborilmadi: ${error.description ?? error.message}`);
    }
  }

  const privateChat = bot.chatType("private");

  // «➕ Guruh qo'shish» → raqami yo'q → raqam so'raldi. Azimjon (2026-11-10): raqam guruh uchun ulashilgan bo'lsa,
  // keyin yo'nalish savoli («Qayerdan yuk olasiz?») emas — guruh qo'shishning o'zi kelsin. Shuning uchun shu niyat
  // (va havola yuborgan bo'lsa — o'sha guruh nomi) eslab qolinadi. Raqam savoliga javobdan (kontakt yoki «Keyinroq»)
  // boshqa har qanday xabar yoki tugma uni unutadi — keyin menyudan raqam ulashsa, odatdagidek. Faqat xotirada:
  // bot qayta ishga tushsa, unutiladi (raqam odatda bir necha soniyada ulashiladi).
  const GROUP_INTENT_MS = 30 * 60_000;
  const groupIntents = new Map(); // chatId → { username: "Yuk_Guruh" | null, at }
  privateChat.use((ctx, next) => {
    if (!ctx.message?.contact && ctx.message?.text !== PHONE.later) groupIntents.delete(ctx.chat.id);
    return next();
  });
  // Bir marta olinadi (olingach o'chadi); eskirgani — yo'q hisob
  function takeGroupIntent(chatId) {
    const intent = groupIntents.get(chatId);
    groupIntents.delete(chatId);
    return intent && Date.now() - intent.at < GROUP_INTENT_MS ? intent : null;
  }

  // «✍️ Shu chatga yozish» (haydovchi, profilsiz): mashinasini oddiy matn bilan yozsa — AI/qoidalar profilga aylantiradi
  // (driverText.js). regText — tugma bosilgan, keyingi matn mashina tavsifi; regPreview — tasdiqlash kutilayotgan profil.
  // Faqat xotirada, 30 daqiqa; bot qayta ishga tushsa unutiladi (foydalanuvchi qaytadan yozadi).
  const REG_TEXT_MS = 30 * 60_000;
  const regText = new Map(); // chatId → { at }
  const regPreview = new Map(); // chatId → { profile, at }
  const regTextActive = (chatId) => {
    const v = regText.get(chatId);
    if (v && Date.now() - v.at < REG_TEXT_MS) return true;
    regText.delete(chatId);
    return false;
  };
  const WRITE_HERE_EXAMPLE =
    "✍️ Mashinangiz haqida yozing — men o'zim to'ldiraman.\n\n" +
    "Masalan:\n" +
    "• «Fura, tent, 20 tonna, qo'shni davlatlarga ham chiqaman»\n" +
    "• «Isuzu, ref, 5 tonna, faqat O'zbekiston»\n" +
    "• «Labo, 1 tonna»";

  // /start (kanaldagi "🤖 Menga mos yuklar" havolasi ham shu yerga keladi: /start kanal).
  // «✅ A'zo bo'ldim» tasdiqlansa ham shu ekran chiqadi. Rol tanlanmagan odam nima bossa yoki yozsa ham shu ekran:
  // salom + bot haqida (pastki menyu olib tashlanadi — menu()), ostida «Iltimos, rolingizni tanlang» va ikki tugma
  async function showStart(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    const hello = `${GREETING}\n\n${helpText(driver)}`; // salomdan keyin bo'sh qator (Azimjon, 2026-11-10)
    if (!role) {
      await ctx.reply(hello, html(driver));
      await askRole(ctx);
      return;
    }
    if (driver.profile) {
      await ctx.reply(`${hello}\n\n<b>Sizning sozlamalaringiz:</b>\n${escapeHtml(describe(driver.profile, role))}`, html(driver));
      // Raqam so'rash paydo bo'lishidan oldin ro'yxatdan o'tganlar — bir marta shu yerda so'raladi
      if (askPhoneFor(driver)) await askPhone(ctx, driver);
      return;
    }
    // Yuk beruvchi: ro'yxatdan o'tish shart emas — «📦 Yuk berish» (forma yoki oddiy xabar)
    if (role === "yuk_beruvchi") {
      await ctx.reply(`${hello}\n\n${loadIntro()}`, html(driver));
      return;
    }
    // Haydovchi, hali ro'yxatdan o'tmagan (2026-11-14): salom + rejim tanlash (feed.js). Saralangan → forma / yozish
    await ctx.reply(hello, html(driver));
    await startFeed(ctx);
  }
  // Ilovaga kirish (2026-11-23, store appLogins.js): ilova t.me/<bot>?start=app_<kod> ni ochadi — odam o'zi tasdiqlaydi.
  // Tasdiqsiz kirgizmaymiz: begona odam havolani yuborib, uni bosgan kishining hisobiga kirib olmasin
  const APP_LOGIN_START = /^app_([A-Za-z0-9_-]{20,48})$/;
  async function askAppLogin(ctx, code) {
    rememberUser(ctx);
    const keyboard = new InlineKeyboard().text("✅ Ha, bog'layman", `al:ok:${code}`).row().text("❌ Yo'q, bog'lamayman", "al:no");
    await ctx.reply(
      "📱 <b>Akkauntingizni Yuk Ekspert ilovasiga bog'laysizmi?</b>\n\n" +
        "«Ha» ni bossangiz — ilova shu Telegram akkauntingiz bilan avtomatik kiradi.\n" +
        "Ilovada «Bot orqali» ni <b>o'zingiz</b> bosmagan bo'lsangiz (havolani boshqa birov yuborgan bo'lsa) — <b>bog'lamang</b>.",
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  }
  privateChat.command("start", (ctx) => {
    const app = APP_LOGIN_START.exec(ctx.match ?? "");
    return app ? askAppLogin(ctx, app[1]) : showStart(ctx);
  });
  bot.callbackQuery(/^al:(?:ok:([A-Za-z0-9_-]{20,48})|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const code = ctx.match[1];
    if (!code) return ctx.editMessageText("❌ Bog'lanmadi. Kerak bo'lsa — ilovada qaytadan «Bot orqali» ni bosing.").catch(() => {});
    const ok = store.confirmAppLogin(code, ctx.chat.id);
    await ctx
      .editMessageText(ok ? "✅ Bog'landi — ilovaga qayting, u o'zi kiradi." : "⌛️ Bu havola eskirgan yoki ishlatilgan. Ilovada qaytadan «Bot orqali» ni bosing.")
      .catch(() => {});
  });

  // /rol va «🔄 Rolni almashtirish»: rol bor — hozirgisi va ikki tugma; rol yo'q — /start ekrani
  const switchRolePrompt = (ctx) => {
    const driver = rememberUser(ctx);
    return roleOf(driver) ? askRole(ctx, driver) : showStart(ctx);
  };

  privateChat.command("sozlamalar", openSettings);
  privateChat.command("rol", switchRolePrompt);
  privateChat.command("pauza", (ctx) => setActive(ctx, false));
  privateChat.command("davom", (ctx) => setActive(ctx, true));
  const showHelp = (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    return ctx.reply(helpText(driver), html(driver));
  };
  privateChat.command("yordam", showHelp);
  privateChat.command("id", (ctx) => ctx.reply(`Sizning Telegram id: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" }));

  // --- Telefon raqami (ixtiyoriy) ---
  privateChat.command("raqam", (ctx) => askPhone(ctx, rememberUser(ctx)));
  // Eski menyudagi «📱 Raqamim» (2026-11-07 da bir necha daqiqa bor edi). Hozirgi «📱 Raqam ulashish» — kontakt (pastda)
  privateChat.hears(MENU.myPhone, (ctx) => askPhone(ctx, rememberUser(ctx)));
  // Menyudagi «📱 Raqam ulashish» — endi oddiy tugma: avval afzalliklar (PHONE_WHY), Telegram oynasi — keyingi bosishda
  // (2026-11-13). Eski menyulardagi request_contact tugmasi kontakt yuboradi — u pastdagi message:contact da saqlanadi
  privateChat.hears(MENU.phone, (ctx) => askPhone(ctx, rememberUser(ctx)));

  // «📱 Raqam ulashish» bosildi (menyuda yoki /raqam da, yoki Mini App'dagi requestContact): Telegram kontakt yuboradi.
  // Faqat O'Z kontaktini saqlaymiz — ilova menyusidan birovning kontaktini ham yuborish mumkin.
  privateChat.on("message:contact", async (ctx) => {
    const driver = rememberUser(ctx);
    const { contact } = ctx.message;
    if (!isOwnContact(contact, ctx.from.id)) {
      const button = driver.phone ? PHONE.change : PHONE.share;
      await ctx.reply(`⚠️ Bu boshqa odamning kontakti — uni saqlamaymiz. O'z raqamingiz uchun pastdagi «${button}» tugmasini bosing.`, {
        reply_markup: phoneKeyboard(Boolean(driver.phone)),
      });
      return;
    }
    const phone = normalizeContactPhone(contact.phone_number);
    if (!phone) {
      await ctx.reply("⚠️ Raqamni o'qib bo'lmadi. Keyinroq /raqam bilan qayta urinib ko'ring.", menu(driver));
      return;
    }
    const updated = store.saveDriver(ctx.chat.id, { phone, phoneAskedAt: driver.phoneAskedAt ?? Date.now() });
    if (driver.hold?.kind === "raqam") release(ctx.chat.id); // raqam so'rovi tugadi
    // Raqam «➕ Guruh qo'shish» uchun ulashildi — yo'nalish savoli o'rniga guruh qo'shishga qaytamiz
    const intent = takeGroupIntent(ctx.chat.id);
    if (intent && roleOf(updated)) return groupAfterPhone(ctx, updated, intent);
    // Faqat shu (Azimjon, 2026-11-10). Raqamning o'zi — /raqam da, o'chirish — /ochirish (buyruqlar ro'yxatida)
    await afterPhone(ctx, updated, "Raqamingiz saqlandi! ✅", { hint: false });
  });

  // «⏭ Keyinroq» / «↩️ O'zgartirmaslik» — asosiy menyu qaytadi, bot boshqa so'ramaydi
  privateChat.hears([PHONE.later, PHONE.keep], async (ctx) => {
    const driver = rememberUser(ctx);
    if (driver.hold?.kind === "raqam") release(ctx.chat.id); // raqam so'rovi tugadi
    const text = driver.phone ? "Raqamingiz o'zgarmadi." : `Mayli 👍 Keyin xohlasangiz — «${MENU.phone}».`;
    // Guruh qo'shish uchun so'ralgan edi — faqat menyu (yo'nalish savolisiz)
    if (takeGroupIntent(ctx.chat.id)) return ctx.reply(text, menu(driver));
    await afterPhone(ctx, driver, text);
  });

  // /raqam → «🗑 Raqamni o'chirish» (Azimjon, 2026-11-10). /ochirish dagi «Faqat raqamni o'chirish» bilan bir xil:
  // phoneAskedAt qoladi — bot o'zi qayta so'ramaydi; menyuda «➕ Guruh qo'shish» o'rnida yana «📱 Raqam ulashish»
  privateChat.hears(PHONE.remove, async (ctx) => {
    const driver = rememberUser(ctx);
    if (!driver.phone) return ctx.reply("Sizda saqlangan raqam yo'q.", menu(driver));
    const updated = store.saveDriver(ctx.chat.id, { phone: null });
    await ctx.reply(`✅ Raqamingiz o'chirildi.\nXohlasangiz, keyin yana ulashasiz — pastdagi «${MENU.phone}» yoki /raqam.`, menu(updated));
  });

  // /ochirish — nimani saqlashimizni ko'rsatadi va o'chirishni taklif qiladi
  privateChat.command("ochirish", async (ctx) => {
    const driver = rememberUser(ctx);
    const keyboard = new InlineKeyboard();
    if (driver.phone) keyboard.text("📱 Faqat raqamni o'chirish", "del:phone").row();
    keyboard.text("🗑 Hisobni o'chirish", "del:all").row().text("Bekor qilish", "del:no");
    await ctx.reply(storedDataText(driver), { parse_mode: "HTML", reply_markup: keyboard });
  });

  // Admin: .env dagi ADMIN_IDS yoki boshqaruv markazida «Admin» belgisi
  privateChat.command("holat", async (ctx) => {
    if (!isAdmin(store.getDriver(ctx.chat.id) ?? { chatId: ctx.from.id }, config.admins ?? [])) return;
    const s = store.stats();
    await ctx.reply(
      [
        `Haydovchilar: ${s.drivers.active} faol / ${s.drivers.total}`,
        `Yuk beruvchilar: ${s.shippers.active} faol / ${s.shippers.total}`,
        `E'lonlar: ${Object.entries(s.posts).map(([k, v]) => `${k} ${v}`).join(", ") || "yo'q"}`,
        `Oxirgi 24 soat: ${s.loads24h.total} yangi yuk (${s.loads24h.sent} ta yuborildi), ` +
          `${s.trucks24h.total} bo'sh mashina (${s.trucks24h.sent} ta yuborildi)`,
      ].join("\n"),
    );
  });

  // --- «➕ Guruh qo'shish» (userSources.js; Azimjon, 2026-11-10) ---
  // Faqat raqamini ulashganlar: menyuda tugma ham faqat ularda. Raqamsiz odam havola yuborsa — avval raqam.
  // Havola (t.me/…, @nomi) chatga qachon yozilsa ham shu yerga keladi (tugmani bosish shart emas)
  const sourceIntake = createSourceIntake({ api: bot.api, store, log, ours: [config.channel, ...(config.requiredChats ?? [])] });
  // Raqam so'raladi va niyat eslab qolinadi (yuqorida groupIntents): username — havola yuborgan bo'lsa, o'sha guruh
  async function needPhone(ctx, username = null) {
    const settled = holdWindow(ctx.chat.id, "raqam");
    groupIntents.set(ctx.chat.id, { username, at: Date.now() });
    await settled;
    return ctx.reply(INTAKE.needPhone(Boolean(username)), { reply_markup: phoneKeyboard(false) });
  }
  // Raqam guruh uchun ulashilgach: havolasi bor edi — o'sha darhol tekshiriladi, yo'q edi — «havolani yuboring» xabari
  async function groupAfterPhone(ctx, driver, { username }) {
    if (!username) await holdWindow(ctx.chat.id, "guruh"); // endi havola kutilyapti
    const text = username ? await sourceIntake.submit(ctx.chat.id, username) : sourceIntake.intro(ctx.chat.id);
    await ctx.reply(`Raqamingiz saqlandi! ✅\n\n${text}`, html(driver));
  }
  async function showAddGroup(ctx) {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    if (!driver.phone) return needPhone(ctx);
    await holdWindow(ctx.chat.id, "guruh"); // havola kutilyapti — shu orada e'lon chalg'itmasin
    await ctx.reply(sourceIntake.intro(ctx.chat.id), html(driver));
  }
  // /account_qosh (Azimjon, 2026-11-13): o'z Telegram akkauntini collector'ga ulash — Mini App Sozlamalardagi
  // «📡 Telegram akkauntlarim» (apps/web TgAccounts mine). Inline web_app tugma, tokensiz (routeMapUrl dagidek: Telegram
  // kimlikni initData bilan beradi). Kod va 2FA parol chatga emas, faqat Mini App'ga yoziladi
  const ACCOUNT_BUTTON = "📡 Telegram akkauntni ulash";
  async function showAddAccount(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    // Ro'yxatdan o'tayotgan haydovchiga Sozlamalarda bu bo'lim hali ko'rinmaydi
    if (role === "haydovchi" && !driver.profile) {
      return ctx.reply(`Avval ro'yxatdan o'ting: pastdagi «${settingsLabel(driver)}» tugmasini bosing — keyin /account_qosh.`, html(driver));
    }
    const base = appUrl();
    if (!base?.startsWith("https://")) return ctx.reply("Bu imkoniyat hozircha ishlamayapti — ilova manzili sozlanmagan.", html(driver));
    const url = miniAppUrl(base, null, scope, { view: "akkaunt", role });
    await ctx.reply(
      [
        "📡 <b>Telegram akkauntingizni ulang</b>",
        "",
        "Akkauntingiz a'zo bo'lgan yuk guruhlari (yopiqlari ham) o'qiladi va Filtrda «👤 Akkauntimdagi» bo'limida ko'rinadi.",
        "Ulash bepul. Yopiq guruhlaringizdagi e'lonlar ⭐ Pro obunada keladi.",
        "",
        "Pastdagi tugma ilovani ochadi: raqam → Telegram yuborgan kod → (bo'lsa) 2FA parol.",
        "⚠️ Kod va parolni faqat ilovaga yozing — hech qanday chatga yubormang (chatga yozilgan kodni Telegram bekor qiladi).",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: InlineKeyboard.from([[InlineKeyboard.webApp(ACCOUNT_BUTTON, url)]]) },
    );
  }
  privateChat.command("account_qosh", showAddAccount); // «Menu» ro'yxatida ham (commands.js)

  privateChat.hears(MENU.addGroup, showAddGroup);
  privateChat.command("guruh_qoshish", showAddGroup); // «Menu» ro'yxatida ham (commands.js)
  privateChat.hears(LINK_RE, async (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    const link = parseSourceLink(ctx.message.text);
    if (!driver.phone) return needPhone(ctx, link.username ?? null);
    const text = link.error ? INTAKE[link.error] : await sourceIntake.submit(ctx.chat.id, link);
    if (!link.error) release(ctx.chat.id); // havola qabul qilindi — guruh qo'shish tugadi (xato bo'lsa — yana kutamiz)
    await ctx.reply(text, html(driver));
  });
  // O'zi qo'shgan guruh sinovga olindi yoki o'tdi va haydovchi «📌 Mening guruhlarim» rejimida — guruh uning tanloviga
  // o'zi qo'shiladi (aks holda yana «📌 Guruhlarim» da belgilashi kerak edi). → xabarga qo'shimcha qator yoki ""
  function addToFeed(chatId, source) {
    if (!source || !["trial", "ok"].includes(source.checkState)) return "";
    try {
      const driver = store.getDriver(chatId);
      const feed = feedOf(driver?.profile);
      if (roleOf(driver) !== "haydovchi" || !FEED_MODES[feed.mode].groups) return "";
      if (feed.sources.some((name) => name.toLowerCase() === source.name.toLowerCase())) return "";
      const sources = store.allowedFeedSources(chatId, [...feed.sources, source.name], { plan: planOf(driver) });
      if (sources.length === feed.sources.length || sources.length > maxFeedSources(driver)) return "";
      store.saveDriver(chatId, { profile: { ...driver.profile, feed: { ...feed, sources } } });
      return `\n\n📌 «${MENU.groups}» ga qo'shildi — undagi yuk e'lonlari darhol keladi.`;
    } catch (error) {
      log(`Guruh tanlovga qo'shilmadi (${chatId}): ${error.message}`);
      return "";
    }
  }
  // Natijani (sinovga olindi / rad etildi / doimiy qo'shildi / o'chirildi) qo'shgan odamga yozadi — pastki menyu bilan
  const sources = createSourceWatcher({
    store,
    log,
    send: (chatId, text, source = null) => bot.api.sendMessage(chatId, `${text}${addToFeed(chatId, source)}`, html(store.getDriver(chatId))),
    onInvite: (check) => sourceIntake.finishInvite(check),
  });

  // Pastki menyu tugmalari (savol-javob o'rtasida bosilsa ham ishlaydi, qoralama saqlanib qoladi)
  privateChat.hears(MENU.loads, showMatches);
  // «🚚 Bo'sh mashinalar» menyudan olindi (2026-11-27: faqat yuk e'lonlari) — eski menyuda bosilsa: yuk berish yo'li
  privateChat.hears(MENU.trucks, async (ctx) => {
    const driver = rememberUser(ctx);
    if (roleOf(driver) !== "yuk_beruvchi") return showMatches(ctx);
    await ctx.reply(`🚚 Bo'sh mashinalar bo'limi endi yo'q — biz yuk e'lonlari bilan ishlaymiz.\n\n${loadIntro()}`, html(driver));
  });
  privateChat.hears([MENU.settings, MENU.register], openSettings);
  // «✍️ Shu chatga yozish» (haydovchi, profilsiz): namuna beramiz, keyingi matnni mashina tavsifi deb o'qiymiz (readRegText)
  privateChat.hears(MENU.writeHere, async (ctx) => {
    const driver = rememberUser(ctx);
    if (roleOf(driver) !== "haydovchi") return showStart(ctx);
    if (driver.profile?.vehicle) {
      await ctx.reply(`Siz allaqachon ro'yxatdan o'tgansiz. O'zgartirish — «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    regText.set(ctx.chat.id, { at: Date.now() });
    await ctx.reply(WRITE_HERE_EXAMPLE, menu(driver));
  });
  privateChat.hears(MENU.pause, (ctx) => setActive(ctx, false));
  privateChat.hears(MENU.resume, (ctx) => setActive(ctx, true));
  privateChat.hears(MENU.apps, showApps); // eski menyudagi tugma (endi menyuda raqam tugmasi)
  privateChat.command("ilovalar", showApps);
  privateChat.hears(MENU.role, switchRolePrompt);
  privateChat.hears(MENU.help, showHelp);
  privateChat.hears([MENU.feed, OLD_MENU.feed, MENU.fastOff, MENU.groups], openFilter);
  privateChat.command("rejim", openFilter);
  // Eski xabarlardagi chat-filtr tugmalari (rejim, guruh, viloyat, transport) — ilovaga yo'naltiriladi
  bot.callbackQuery(FILTER_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    await ctx.editMessageReplyMarkup().catch(() => {});
    return openFilter(ctx);
  });

  // --- «📦 Yuk berish» (yuk beruvchi; shipperLoads.js, 2026-11-10) ---
  // Pastki menyudagi tugma odatda formani ochadi (Mini App) va chatga hech narsa yubormaydi. Forma manzili yo'q bo'lsa —
  // oddiy tugma: bosilganda «shu yerga oddiy xabar qilib yozing»
  privateChat.hears(MENU.giveLoad, async (ctx) => {
    const driver = rememberUser(ctx);
    if (roleOf(driver) !== "yuk_beruvchi") return showStart(ctx);
    await ctx.reply(loadIntro(), html(driver));
  });

  // Desk ko'rinishi ({ text, keyboard? }) → xabar. Tugmali xabarda pastki menyu bo'lmaydi (Telegram: bitta xabar — bitta
  // markup), tugmasizida — menyu
  async function showLoadView(ctx, view, driver, { edit = false } = {}) {
    const markup = view.keyboard ? { reply_markup: view.keyboard } : menu(driver);
    await render(ctx, view.text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }, edit);
  }

  // Yuk beruvchi chatga oddiy xabar yozdi — yuk deb o'qiymiz (AI bir necha soniya o'ylashi mumkin: «yozmoqda...» belgisi)
  async function readLoad(ctx, driver, text = ctx.message.text) {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const view = await desk.read(ctx.chat.id, text, driver);
    await showLoadView(ctx, view, driver);
  }

  // Yuk beruvchining ovozli xabari (2026-11-27, Azimjon: «Ilovadagi kabi yozib … yoki audioham jo'nataversin»): fayl
  // Telegram'dan olinadi → Gemini matnga o'giradi → «🎤 Eshitdim: …» → keyin oddiy yozilgan matndek (desk.read)
  const VOICE_MAX_S = 120; // ilovadagi kabi — 2 daqiqagacha
  const fetchFile = downloadFile ?? (async (filePath) => {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!res.ok) throw new Error(`fayl olinmadi: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  async function readVoiceLoad(ctx, driver) {
    const media = ctx.message.voice ?? ctx.message.audio;
    if ((media.duration ?? 0) > VOICE_MAX_S) return ctx.reply(LOAD_TEXT.voiceLong, menu(driver));
    await ctx.replyWithChatAction("typing").catch(() => {});
    let text = null;
    try {
      const file = await ctx.api.getFile(media.file_id);
      const data = await fetchFile(file.file_path);
      text = (await transcribeVoice(data, ctx.message.voice ? "audio/ogg" : (media.mime_type ?? "audio/mpeg")))?.trim() || null;
    } catch (error) {
      log(`Yuk beruvchining ovozi o'qilmadi (${ctx.chat.id}): ${error.description ?? error.message}`);
    }
    if (!text) return ctx.reply(LOAD_TEXT.voiceFail, html(driver));
    await ctx.reply(LOAD_TEXT.heard(text), { parse_mode: "HTML" });
    return readLoad(ctx, driver, text);
  }

  // Haydovchi «✍️ Shu chatga yozish» → mashinasini yozdi. parseLoad (qoidalar, bo'lmasa AI) bilan tushunamiz → profil
  // (driverText.js) → preview (tasdiqlash tugmalari). AI band bo'lsa yoki tushunmasa — tushunarli matn; regText qoladi,
  // foydalanuvchi aniqroq qayta yozishi mumkin.
  async function readRegText(ctx, driver) {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const parsed = await parseLoad(ctx.message.text);
    if (!parsed) {
      await ctx.reply("⏳ Tizim hozir band. Birozdan keyin qayta yozing yoki «🚚 Ro'yxatdan o'tish» formasidan to'ldiring.", menu(driver));
      return;
    }
    // Rejimi (saralangan / + saralangan) saqlanadi — matndan faqat mashina olinadi
    const fromText = profileFromText(parsed, ctx.message.text, { scope });
    const { error } = fromText;
    const profile = fromText.profile && driver.profile?.feed ? { ...fromText.profile, feed: driver.profile.feed } : fromText.profile;
    if (error) {
      await ctx.reply(error, menu(driver));
      return;
    }
    regPreview.set(ctx.chat.id, { profile, at: Date.now() });
    const keyboard = new InlineKeyboard().text("✅ Ha, saqlash", "rt:ok");
    const formUrl = regFormUrl();
    if (formUrl) keyboard.webApp("✏️ Formada tuzatish", formUrl);
    keyboard.row().text("❌ Bekor", "rt:no");
    await ctx.reply(`Mana, tushunganim 👇\n\n${escapeHtml(describe(profile, "haydovchi"))}\n\nTo'g'rimi?`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
  }

  // Formadan (web) kelgan yuk — server bilan aloqa bo'lmaganda Mini App uni sendData bilan shu yerga yuboradi
  // (odatda forma serverga — POST /pub/loads — yuboradi). Ma'lumotga ishonmaymiz: sanitizeShipperLoad
  async function loadFromForm(ctx, driver, data) {
    if (roleOf(driver) !== "yuk_beruvchi") return ctx.reply("⚠️ Yuk berish — faqat yuk beruvchilar uchun. Rolni almashtirish: /rol", menu(driver));
    if (store.shipperPostCount(ctx.chat.id) >= SHIPPER_LOAD_LIMIT) return ctx.reply(LOAD_TEXT.limit(SHIPPER_LOAD_LIMIT), menu(driver));
    const { load, error } = sanitizeShipperLoad(data?.load, { scope });
    if (error) return ctx.reply(`⚠️ Yuborilmadi: ${error}. Formani qaytadan oching.`, menu(driver));
    store.addDirectPost({ chatId: ctx.chat.id, text: shipperLoadText(load), loads: [load], via: "web", sender: telegramUsername(ctx.from.username) });
    store.setLoadPhones(ctx.chat.id, load.phones);
    if (data.fromDraft) store.setLoadDraft(ctx.chat.id, null);
    onLoadQueued();
    await ctx.reply("📤 Yukingiz qabul qilindi — natijasini hozir yozaman.", menu(driver));
  }

  // [✅ Yuborish] — navbatga; ishchi yuboradi va natijani alohida xabarda yozadi (directDone)
  bot.callbackQuery(LOAD_CALLBACKS.send, async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    const sent = roleOf(driver) === "yuk_beruvchi" ? desk.send(ctx.chat.id, driver, { sender: telegramUsername(ctx.from.username) }) : { ok: false, reason: "stale" };
    if (!sent.ok) {
      const text = sent.reason === "limit" ? `24 soatda ${SHIPPER_LOAD_LIMIT} ta yuk — chegara. Birozdan keyin yuboring.` : sent.reason === "phone" ? "Avval raqamni yozing" : LOAD_TEXT.stale;
      await ctx.answerCallbackQuery({ text, show_alert: true });
      if (sent.reason === "stale") await ctx.editMessageReplyMarkup().catch(() => {});
      return;
    }
    await ctx.answerCallbackQuery({ text: "📤 Yuborildi" });
    const shown = sent.loads.map((load) => formatLoad(load, {}).text).join("\n\n");
    await ctx.editMessageText(`${LOAD_TEXT.sending}\n\n${shown}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => {});
  });

  // [❌ Bekor qilish]
  bot.callbackQuery(LOAD_CALLBACKS.cancel, async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    desk.cancel(ctx.chat.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(LOAD_TEXT.cancelled).catch(() => {});
  });

  // Matndan ro'yxatdan o'tish preview'i (driverText.js). [✅ Ha, saqlash] — profilni saqlaydi, keyin odatdagi oqim (raqam → yo'nalish)
  bot.callbackQuery("rt:ok", async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    const preview = regPreview.get(ctx.chat.id);
    regPreview.delete(ctx.chat.id);
    if (!preview || Date.now() - preview.at > REG_TEXT_MS || driver.profile?.vehicle) {
      await ctx.editMessageReplyMarkup().catch(() => {});
      await ctx.reply(`Bu taklif eskirdi. «${MENU.writeHere}» ni qayta bosing yoki «${settingsLabel(driver)}».`, menu(driver));
      return;
    }
    regText.delete(ctx.chat.id);
    await ctx.editMessageReplyMarkup().catch(() => {}); // tugmalar qayta bosilmasin
    await saved(ctx, preview.profile, "haydovchi");
  });

  // [❌ Bekor] — preview rad etildi
  bot.callbackQuery("rt:no", async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    regPreview.delete(ctx.chat.id);
    regText.delete(ctx.chat.id);
    const driver = rememberUser(ctx);
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(`Bekor qilindi. Xohlasangiz «${MENU.writeHere}» yoki «${settingsLabel(driver)}».`, menu(driver));
  });

  // [📞 +998 …] — oldin yozgan raqami bilan
  bot.callbackQuery(LOAD_CALLBACKS.phone, async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    const view = desk.pickPhone(ctx.chat.id, Number(ctx.match[1]), driver);
    if (!view) {
      await ctx.answerCallbackQuery({ text: LOAD_TEXT.stale, show_alert: true });
      await ctx.editMessageReplyMarkup().catch(() => {});
      return;
    }
    await ctx.answerCallbackQuery();
    await showLoadView(ctx, view, driver, { edit: true });
  });

  // Mini App formasi "Saqlash" bosilganda: { type: "profile", role?, profile }. Ma'lumotga ishonmaymiz — tekshiramiz.
  // role bo'lmasa (eski forma) — bazadagi rol; forma boshqa rolni yuborsa — rol ham almashadi.
  privateChat.on("message:web_app_data", async (ctx) => {
    const driver = rememberUser(ctx);
    let data = null;
    try {
      data = JSON.parse(ctx.message.web_app_data.data);
    } catch {
      // buzilgan JSON — pastda xato deb javob beriladi
    }
    if (data?.type === "load") return loadFromForm(ctx, driver, data); // «📦 Yuk berish» formasi (server bilan aloqa yo'q edi)
    const role = validRole(data?.role) ?? roleOf(driver);
    // Rejimni yubormagan (eski) forma — rejim eskisicha (withPrevFeed). Guruhlar — faqat shu odamga ko'rinadiganlari
    const input = role === "haydovchi" ? withPrevFeed(data?.profile, driver.profile) : data?.profile;
    let { profile, error } = data?.type === "profile" ? sanitizeProfileFor(role, input, { scope }) : { error: "noma'lum ma'lumot keldi" };
    if (profile?.feed && FEED_MODES[profile.feed.mode].groups) {
      const sources = store.allowedFeedSources(ctx.chat.id, profile.feed.sources, { plan: planOf(driver) });
      if (!sources.length) error = "tanlangan guruhlar ro'yxatda topilmadi";
      else if (sources.length > maxFeedSources(driver)) error = sourcesLimitText(planOf(driver));
      else profile = { ...profile, feed: { ...profile.feed, sources } };
    }
    if (error) {
      await ctx.reply(`⚠️ Saqlanmadi: ${error}. Formani qaytadan oching.`, menu(driver));
      return;
    }
    await saved(ctx, profile, role);
  });

  // «Iltimos, rolingizni tanlang» tugmalari
  bot.callbackQuery(/^r:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const role = validRole(ctx.match[1]);
    if (!role || ctx.chat?.type !== "private") return;
    // «Iltimos, rolingizni tanlang» o'rnida — tanlangani, belgi oxirida (Azimjon, 2026-11-10)
    await ctx.editMessageText(`${ROLES[role].choice} ✅`).catch(() => {});
    await chooseRole(ctx, role);
  });

  // «✅ A'zo bo'ldim»: qayta tekshiramiz. Hali a'zo emas — ogohlantirish (oyna) va ro'yxat yangilanadi
  // (bittasiga a'zo bo'lgan bo'lsa, u ✅ bo'ladi); a'zo — «Rahmat» va /start ekrani
  bot.callbackQuery(SUB_CHECK, async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    if (!members.active()) {
      await ctx.answerCallbackQuery();
      return showStart(ctx);
    }
    rememberUser(ctx);
    const result = await members.check(ctx.from.id, { fresh: true });
    if (!result.ok) {
      const names = result.missing.map((c) => c.title).join(" va ");
      await ctx.answerCallbackQuery({ text: `Hali a'zo emassiz: ${names}. A'zo bo'lib, qayta bosing.`, show_alert: true });
      await sendJoinPrompt(ctx, result.missing, { edit: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "✅ Rahmat!" });
    await ctx.editMessageText("✅ Rahmat! Kanal va guruhimizga a'zosiz.").catch(() => {});
    const pending = pendingAppLogin.get(ctx.from.id);
    pendingAppLogin.delete(ctx.from.id);
    if (pending && Date.now() - pending.at < PENDING_APP_MS) return askAppLogin(ctx, pending.code);
    await showStart(ctx);
  });

  // Kanal yoki guruhga kimdir qo'shildi / chiqdi (bot u yerda admin, main.js allowed_updates: chat_member).
  // Eslab qolingan natija o'chiriladi. Bot foydalanuvchisi chiqib ketsa va yuk olib turgan bo'lsa — darrov eslatma
  bot.on("chat_member", async (ctx) => {
    if (!members.active() || !members.watches(ctx.chat)) return;
    const { old_chat_member: before, new_chat_member: after } = ctx.chatMember;
    members.forget(after.user.id);
    const driver = store.getDriver(after.user.id);
    if (!driver) return; // botdan foydalanmagan odam — bazaga yozilmaydi
    const result = await members.check(after.user.id);
    if (isMember(before) && !isMember(after) && !result.ok && driver.profile && driver.active) {
      await remindJoin(after.user.id, result.missing, "left");
    }
  });

  // /ochirish tugmalari
  bot.callbackQuery(/^del:(phone|all|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const what = ctx.match[1];
    if (what === "no") {
      await ctx.editMessageText("Hech narsa o'chirilmadi.").catch(() => {});
      return;
    }
    if (what === "phone") {
      // phoneAskedAt qoladi — bot boshqa o'zi so'ramaydi
      const updated = store.saveDriver(ctx.chat.id, { phone: null });
      await ctx.editMessageText("✅ Raqamingiz o'chirildi.").catch(() => {});
      await ctx.reply("Xohlasangiz, keyin yana ulashasiz — /raqam", menu(updated));
      return;
    }
    store.deleteDriver(ctx.chat.id, { via: "bot" });
    await ctx.editMessageText(ACCOUNT_DELETED_TEXT).catch(() => {});
    await ctx.reply("Qaytadan boshlash — /start", { reply_markup: { remove_keyboard: true } });
  });

  // Avtomatik pauza xabarlaridagi tugmalar (idle.js). Bosishning o'zi — faollik (yuqoridagi middleware touchDriver):
  // «✅ Ha, davom etsin» — 48 soatlik soat qaytadan boshlanadi; «▶️ Davom ettirish» — pauzadan chiqaradi
  // Ochiq amal tashlab ketildi — bir marta eslatma (e'lonlar baribir kelmaydi, amal tugaguncha) va «✅ Tugatish» tugmasi
  const HOLD_NAMES = { filtr: "🎛 Filtr", wizard: "Ro'yxatdan o'tish", guruh: "➕ Guruh qo'shish", raqam: "📱 Raqam ulashish" };
  async function remindHolds() {
    for (const { chatId, kind } of store.holdsToRemind?.(Date.now() - HOLD_REMIND_MS) ?? []) {
      store.markHoldReminded(chatId);
      const driver = store.getDriver(chatId);
      if (!driver || driver.active === false || driver.deletedAt != null) continue; // pauzada — e'lon baribir kelmaydi
      const name = HOLD_NAMES[kind] ?? "Sozlash";
      const text = `⏳ <b>${name}</b> hali tugamadi — shuning uchun e'lonlar kelmayapti.\nTugatsangiz, e'lonlar yana keladi 👇`;
      await bot.api
        .sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("✅ Tugatish — e'lonlar kelsin", HOLD_END) })
        .catch((error) => log(`Ochiq amal eslatmasi yuborilmadi (${chatId}): ${error.description ?? error.message}`));
    }
  }
  let holdTimer = null;
  const holdReminder = {
    start(everyMs = 30_000) {
      holdTimer ??= setInterval(() => remindHolds().catch((error) => log(`Ochiq amal eslatmasida xato: ${error.message}`)), everyMs);
      holdTimer.unref?.();
    },
    stop() {
      clearInterval(holdTimer);
      holdTimer = null;
    },
    run: remindHolds,
  };
  bot.callbackQuery(HOLD_END, async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    release(ctx.chat.id);
    groupIntents.delete(ctx.chat.id);
    await ctx.answerCallbackQuery({ text: "✅ Tugadi" });
    await ctx.editMessageText("▶️ Tugadi — e'lonlar yana keladi.").catch(() => {});
    if (driver.active === false) await ctx.reply(`⏸ Siz pauzadasiz. Yoqish — «${MENU.resume}».`, menu(driver));
  });

  bot.callbackQuery([IDLE_BUTTONS.ok, IDLE_BUTTONS.resume], async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    await ctx.answerCallbackQuery(ctx.callbackQuery.data === IDLE_BUTTONS.ok ? { text: "✅ Rahmat!" } : undefined);
    await ctx.editMessageReplyMarkup().catch(() => {}); // tugma qayta bosilmasin
    if (driver.profile && driver.active === false) return setActive(ctx, true);
    release(ctx.chat.id); // «kelaversin» dedi — ochiq qolgan amal bo'lsa ham tugadi
    const t = ROLE_TEXT[roleOf(driver)] ?? ROLE_TEXT.haydovchi;
    await ctx.reply(`✅ Yaxshi, ${t.many} kelishda davom etadi.`, menu(driver));
  });

  // «📋 Mos yuklar»: mr:f:<qayerdan> → «Qayerga?», mr:t:<qayerdan>:<qayerga> → saqlash va ro'yxat,
  // mr:back — «Qayerdan?» ga qaytish, mr:last — oxirgi yo'nalish bilan ro'yxat (endi chiqarilmaydi, chatdagi eski tugmalar uchun)
  bot.callbackQuery(/^mr:(?:f:(.+)|t:([^:]+):(.+)|last|back)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const driver = store.getDriver(ctx.chat.id);
    if (roleOf(driver) !== "haydovchi" || !sortedReady(driver.profile)) {
      await ctx.editMessageText("Bu tugma eskirgan.").catch(() => {});
      return showMatches(ctx);
    }
    const [, from, routeFrom, routeTo] = ctx.match;
    const data = ctx.callbackQuery.data;
    if (data === "mr:back") return askRoute(ctx, driver, { edit: true });
    if (data === "mr:last") {
      await ctx.editMessageText(chosenText(driver.profile), { parse_mode: "HTML" }).catch(() => {});
      return listMatches(ctx, driver);
    }
    if (from != null) {
      if (!validArea(driver.profile, scope, from)) return askRoute(ctx, driver, { edit: true });
      // «🗺 Xaritadan tanlash» bu qadamda «Qayerdan» bilan ochiladi (xaritada faqat «Qayerga?» qoladi; "*" — eski tugma)
      const { text, keyboard } = toStep({ profile: driver.profile, scope, from, mapUrl: routeMapUrl(from === ANY ? null : from) });
      return rememberRouteMessage(ctx.chat.id, await render(ctx, text, { parse_mode: "HTML", reply_markup: toKeyboard(keyboard) }, true));
    }
    if (!validArea(driver.profile, scope, routeFrom) || !validArea(driver.profile, scope, routeTo)) return askRoute(ctx, driver, { edit: true });
    const updated = store.saveDriver(ctx.chat.id, { profile: applyRoute(driver.profile, routeFrom, routeTo) });
    rememberRouteMessage(ctx.chat.id, null);
    await ctx.editMessageText(chosenText(updated.profile), { parse_mode: "HTML" }).catch(() => {});
    await listMatches(ctx, updated);
    // Odatda raqam formadan keyin so'ralgan bo'ladi (saved). Bu — forma botga kelmagan hollar uchun (masalan, web saytda
    // to'ldirgan yoki 2026-11-10 dan oldin yo'nalishsiz qolgan): raqam baribir bir marta so'raladi
    if (askPhoneFor(updated)) await askPhone(ctx, updated);
  });

  // Chatdagi savol-javob (Mini App bo'lmasa)
  bot.callbackQuery(/^w:(\w+):(.+)$/, async (ctx) => {
    if (ctx.chat) await holdWindow(ctx.chat.id, "wizard"); // savol-javob davom etyapti
    const [, step, value] = ctx.match;
    const driver = store.getDriver(ctx.chat.id);
    const role = roleOf(driver);
    const result = role && driver.draft ? applyAction(driver.draft, step, value) : null;
    await ctx.answerCallbackQuery(result?.notice ? { text: result.notice, show_alert: true } : undefined);
    if (!role) return showStart(ctx);
    if (!result) return startWizard(ctx, driver.profile, role);
    const { draft, saved: done } = result;
    if (done) {
      await ctx.editMessageText("✅ Javoblar qabul qilindi.");
      await saved(ctx, profileFromDraft(draft), draft.role ?? role);
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft, { edit: true });
  });

  privateChat.on(["message:voice", "message:audio"], async (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    if (roleOf(driver) !== "yuk_beruvchi") return ctx.reply("Pastdagi tugmalardan birini bosing 👇", menu(driver));
    return readVoiceLoad(ctx, driver);
  });

  privateChat.on("message:text", async (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx); // menyu yo'q — avval rol
    // Yuk beruvchi oddiy xabar yozdi — bu uning yuki («📦 Yuk berish», shipperLoads.js). Chatdagi sozlamalar savol-javobi
    // (draft) ochiq bo'lsa — avval u
    if (!driver.draft && roleOf(driver) === "yuk_beruvchi") return readLoad(ctx, driver);
    // Haydovchi «✍️ Shu chatga yozish» ni bosgan (profilsiz) — bu matnni mashina tavsifi deb o'qiymiz
    if (!driver.draft && roleOf(driver) === "haydovchi" && !driver.profile?.vehicle && regTextActive(ctx.chat.id)) return readRegText(ctx, driver);
    if (!driver.draft) {
      await ctx.reply("Pastdagi tugmalardan birini bosing 👇", menu(driver));
      return;
    }
    const { draft, error } = applyText(driver.draft, ctx.message.text);
    if (error) {
      await ctx.reply(error);
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  });

  // Bot admin bo'lgan guruh va kanallardagi e'lonlar navbatga tushadi (o'z kanalimizdan tashqari).
  // Guruhda hamma xabarni ko'rish uchun bot admin bo'lishi yoki BotFather'da privacy mode o'chirilgan bo'lishi kerak.
  bot.on(["message", "channel_post"], (ctx, next) => {
    const chat = ctx.chat;
    if (chat.type === "private") return next();
    if (isChannel(chat)) return;
    // Kanalga ulangan muhokama guruhiga kanal postlari avtomatik nusxalanadi — ular bizning o'z yuklarimiz
    if (isOwnEcho(ctx.msg)) return;
    const post = postFromMessage(chat, ctx.msg);
    if (!post) return;
    const added = store.addPost(post, { dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS });
    if (added) log(`navbatga: ${post.source} #${post.messageId} (${added.status})`);
  });

  bot.catch((error) => log(`Bot xatosi: ${error.error?.message ?? error.message}`));

  // --- Yuborish (pipeline shularni chaqiradi) ---
  // Kanalda pastki menyu bo'lmaydi, shuning uchun u yerda tugmalar xabar ostida.
  // Faqat CHANNEL_LOADS yoqilganda (standart o'chiq): yuklar haydovchilarga shaxsiy xabarda boradi.
  // Guruh bo'limlari (GROUP_LOADS): yuk navbatga qo'yiladi, groupTopics.js o'zi sekin-asta yuboradi — bu yerda kutilmaydi
  const group = config.groupLoads
    ? createGroupPoster({ api: bot.api, store, chat: config.groupLoads, botUsername: () => bot.botInfo?.username, log })
    : null;

  async function publish(load, post) {
    // Guruh bo'limlariga AI ko'rinishi faqat yuk beruvchining o'z yukiga; guruh e'lonlari asl matn bilan (groupRaw) ketadi
    if (post.shipper != null) group?.push(load, post);
    if (!config.channel || !config.channelLoads) return null;
    const { text, url } = formatLoad(load, post);
    const keyboard = new InlineKeyboard();
    if (url) keyboard.url("📄 Asl e'lon", url);
    if (bot.botInfo) keyboard.url("🤖 Menga mos yuklar", `https://t.me/${bot.botInfo.username}?start=kanal`);
    try {
      const message = await bot.api.sendMessage(config.channel, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
      return message.message_id;
    } catch (error) {
      log(`Kanalga yuborilmadi: ${error.description ?? error.message}`);
      return null;
    }
  }

  // Pipeline har yukdan oldin so'raydi: kanal va guruhga a'zomi? A'zo emas — yuk yuborilmaydi, o'rniga eslatma
  // (kuniga bir marta). Adminlar va REQUIRED_CHATS bo'lmasa — hammaga. Natija 10 daqiqa eslab qolinadi.
  async function canReceive(user) {
    if (!members.active() || isAdmin(user, config.admins ?? [])) return true;
    const result = await members.check(user.chatId);
    if (result.ok) return true;
    await remindJoin(user.chatId, result.missing, "load");
    return false;
  }

  // kind — "yuk" (haydovchiga) yoki "mashina" (yuk beruvchiga); loadId — loads jadvalidagi id («📞 Telefon qilish» uchun)
  // Xabar ostida «📄 Asl e'lon» va «📞 Telefon qilish» tugmalari (loadButtons). Bitta xabarda yo inline tugmalar, yo pastki
  // menyu bo'ladi — ikkalasi emas. Shuning uchun pastki menyu (Mini App manzili va tokeni bilan) faqat tugmasiz yuk xabarida
  // keladi, qolgan payt — botning har javobida (/start, menyu tugmalari). 2026-11-07 dan 11-09 gacha har yuk menyu bilan borardi.
  // → { ok: true } yoki { ok: false, error } — pipeline buni deliveries ga yozadi (boshqaruv markazi «Olgan yuklari»)
  // Yozgan odam bot foydalanuvchisimi (unga «💬 Lichkasi» ID bo'yicha ishlaydi)
  // Bot taniydi: botga yozgan (drivers) yoki collector botga forward qilib ko'rsatgan (store.senderReachable, 2026-11-20)
  const knows = (id) => Boolean(store.getDriver(Number(id))) || Boolean(store.senderReachable?.(id));
  const withSender = (post) => (post?.senderId && !post.sender ? { ...post, senderKnown: knows(post.senderId) } : post);

  async function deliver(chatId, load, rawPost, kind = "yuk", loadId = null) {
    const post = withSender(rawPost);
    const url = callUrl(chatId, loadId);
    return guarded(chatId, () => sendDirect(chatId, directText(load, post, kind), loadButtons(load, post, url), () => loadButtons(load, post, url, { lichka: false })));
  }

  // «⚡ Tezkor» / «📌 Mening guruhlarim» (pipeline.js createWorker deps.deliverRaw): e'lonning ASL matni, AI'siz.
  // Tugmalar yukdagidek: «📄 Asl e'lon» + «📞 Telefon qilish» (raqamlar — e'lon matnidan, @yuk/parser extractPhones)
  // Bitta chatga sur'at (2026-11-19): saralash o'chiq — tezkor yo'lda bir haydovchiga daqiqasiga ~30 ta e'lon; to'plangan
  // e'lonlar bir zumda ketsa Telegram 429 «retry after 527» bilan chatni ~9 daqiqaga yopib qo'ydi (haydovchi hech narsa
  // olmaydi). Endi: bir chatga xabarlar orasida kamida RAW_CHAT_GAP_MS; 429 bo'lsa — Telegram aytgan vaqtgacha bu chatga
  // urinilmaydi (har urinish blokni uzaytirishi mumkin), o'sha paytdagi e'lonlar o'tkazib yuboriladi (eskirgan bo'ladi)
  // 2026-11-19: 1,1 s yetmadi — 3 chatga har ~5 daqiqada 429 tushib, Telegram jazoni 6–18 soatga oshirdi (retry after 21585…64913).
  // 3 s (daqiqasiga ~20 ta) — zaxira bilan; .env RAW_CHAT_GAP_MS bilan o'zgartiriladi. Navbatda 5 daqiqadan eskisi tashlanadi
  const RAW_CHAT_GAP_MS = Math.max(1_000, Number(process.env.RAW_CHAT_GAP_MS) || 3_000);
  const rawLastAt = new Map(); // chatId → oxirgi yuborilgan vaqt
  const rawBlockedUntil = new Map(); // chatId → 429 tugaydigan vaqt
  async function deliverRaw(chatId, rawPost, opts = {}) {
    const blocked = rawBlockedUntil.get(chatId) ?? 0;
    if (Date.now() < blocked) return { ok: false, error: `429: ${Math.ceil((blocked - Date.now()) / 1000)} s kutish` };
    const waitMs = (rawLastAt.get(chatId) ?? 0) + RAW_CHAT_GAP_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    // Kutish paytida (≤ 3 s) odam «🎛 Filtr» ni ochgan yoki pauza bosgan bo'lishi mumkin (2026-11-19 tiket) — guarded()
    // yuborishning o'zidan bir zum oldin tekshiradi va so'rovni inflight'ga qo'yadi (pauza handleri uni kutadi)
    if (gateReason(chatId)) return { ok: false, error: gateReason(chatId) };
    rawLastAt.set(chatId, Date.now());
    const outcome = await guarded(chatId, () => deliverRawNow(chatId, rawPost, opts));
    const retry = Number(/retry after (\d+)/i.exec(outcome?.error ?? "")?.[1]);
    if (retry > 0) {
      rawBlockedUntil.set(chatId, Date.now() + retry * 1000);
      log(`Telegram ${chatId} chatiga ${retry} s yozishni chekladi — shu vaqt tezkor e'lonlar unga yuborilmaydi`);
    }
    return outcome;
  }

  async function deliverRawNow(chatId, rawPost, { phones = [] } = {}) {
    const post = withSender(rawPost);
    const mode = FEED_MODES[feedMode(store.getDriver(chatId)?.profile)];
    const options = { phones, label: mode.groups ? "📌 Guruhingizdan" : mode.regions ? "📍 Hududingizdan" : "⚡ Yangi e'lon" };
    const url = rawCallUrl(chatId, post.id);
    const buttons = loadButtons({ phones }, post, url);
    const fallback = () => loadButtons({ phones }, post, url, { lichka: false });
    // Ovozli xabar / dumaloq video: asl fayl + ostida matn, bitta xabarda (2026-11-20, Azimjon: matnga o'girish xato bo'lishi
    // mumkin — haydovchi asl ovozni ham eshitsin). Fayl yo'q (24 soatdan eski, saqlanmagan) yoki Telegram qabul qilmasa — matn
    const file = mediaFile(post);
    if (file && existsSync(file)) {
      const outcome = await sendDirect(chatId, formatRawCaption(post, options), buttons, fallback, { file, kind: post.media });
      if (outcome.ok || !/Bad Request|wrong|file|caption/i.test(outcome.error ?? "")) return outcome;
      log(`#${post.id}: asl fayl yuborilmadi (${outcome.error}) — faqat matn`);
    }
    const { text } = formatRaw(post, options);
    return sendDirect(chatId, text, buttons, fallback);
  }

  // Asl faylning Telegram'dagi nusxasi: birinchi haydovchiga yuklanadi, keyingilariga file_id bilan (qayta yuklanmaydi)
  const mediaFile = (post) => (post?.source && /^(@|-)/.test(post.source) ? mediaDirFile(post) : null);
  const fileIds = new Map(); // fayl yo'li → file_id
  async function sendMedia(chatId, media, caption, markup) {
    const options = { caption, parse_mode: "HTML", ...markup };
    const input = fileIds.get(media.file) ?? new InputFile(media.file);
    // Dumaloq videoga izoh qo'shib bo'lmaydi (sendVideoNote'da caption yo'q) — oddiy video bo'lib, izohi bilan boradi
    const message = media.kind === "round" ? await bot.api.sendVideo(chatId, input, { ...options, supports_streaming: true }) : await bot.api.sendVoice(chatId, input, options);
    const id = (message?.voice ?? message?.video ?? message?.document)?.file_id;
    if (id) {
      fileIds.set(media.file, id);
      if (fileIds.size > 1000) fileIds.delete(fileIds.keys().next().value);
    }
    return message;
  }

  // Shaxsiy xabar (yuk yoki tezkor e'lon) — tugmalar bilan, ular yo'q bo'lsa pastki menyu bilan
  // fallback() — Telegram tugmalarni rad etsa sinab ko'riladigan ikkinchi to'plam («💬 Lichkasi» siz); faqat kerak bo'lganda quriladi
  // media — { file, kind } bo'lsa xabar o'rniga asl fayl yuboriladi, text esa uning izohi (caption)
  async function sendDirect(chatId, rawText, buttons, fallback = null, media = null) {
    const driver = store.getDriver(chatId);
    // E'lon matnida buzuq belgi (yarim emoji — guruhdagi xabar o'zi shunday yoki kesilgan) bo'lsa Telegram butun xabarni
    // «text must be encoded in UTF-8» bilan rad etadi — e'lon haydovchiga umuman bormaydi (2026-11-27 06:59, 5149275321;
    // 16.11 dan 14 marta). toWellFormed — buzuq bo'lagini «�» bilan almashtiradi, qolgan matn o'zgarmaydi
    const text = String(rawText ?? "").toWellFormed();
    const send = media
      ? (markup) => sendMedia(chatId, media, text, markup)
      : (markup) => bot.api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup });
    try {
      try {
        await send(buttons ? { reply_markup: buttons } : driver ? menu(driver) : {});
      } catch (error) {
        // Telegram tugmani qabul qilmasa (400, masalan manzil yaroqsiz) — yuk baribir yetib borsin: tugmalarsiz
        if (!buttons || !(error instanceof GrammyError) || error.error_code !== 400) throw error;
        let sent = false;
        const other = fallback?.() ?? null;
        if (other && JSON.stringify(other) !== JSON.stringify(buttons)) {
          try {
            await send({ reply_markup: other });
            sent = true;
            log(`«💬 Lichkasi» tugmasi qabul qilinmadi (${error.description}) — usiz yuborildi`);
          } catch (again) {
            if (!(again instanceof GrammyError) || again.error_code !== 400) throw again;
          }
        }
        if (!sent) {
          log(`Yuk tugmalari qabul qilinmadi (${error.description}) — tugmalarsiz yuborildi`);
          await send(driver ? menu(driver) : {});
        }
      }
      return { ok: true };
    } catch (error) {
      const reason = error.description ?? error.message;
      // 403 — foydalanuvchi botni bloklagan yoki o'chirgan: unga boshqa yubormaymiz
      if (error instanceof GrammyError && error.error_code === 403) store.saveDriver(chatId, { active: false, why: "blocked" });
      else log(`Foydalanuvchiga yuborilmadi (${chatId}): ${reason}`);
      return { ok: false, error: reason };
    }
  }

  // Yuk beruvchining yuki yuborib bo'lindi (pipeline.js createWorker deps.onDirect) — nechta haydovchiga ketgani.
  // Botdan ham, web formadan ham — natija chatga keladi. Hisobini o'chirgan bo'lsa — yozilmaydi
  async function directDone(post, outcome) {
    const driver = store.getDriver(post.shipper);
    if (!driver || driver.deletedAt) return;
    await bot.api.sendMessage(post.shipper, resultText(outcome), html(driver));
  }

  // Bot profilidagi matn faqat o'zgargan bo'lsa yangilanadi (Telegram bu so'rovlarni cheklaydi)
  async function syncProfileTexts() {
    const current = await bot.api.getMyDescription().catch(() => null);
    if (current && current.description !== DESCRIPTION) await bot.api.setMyDescription(DESCRIPTION);
    const short = await bot.api.getMyShortDescription().catch(() => null);
    if (short && short.short_description !== SHORT_DESCRIPTION) await bot.api.setMyShortDescription(SHORT_DESCRIPTION);
  }

  async function init() {
    await bot.init();
    // Haydovchilar web'idagi «Telegram bilan kirish» tugmasi bot username'ini shu yerdan oladi (apps/api public.js)
    store.setSetting?.("bot_username", bot.botInfo.username);
    // Buyruqlar ro'yxati endi hamma uchun emas — har chatga alohida (commands.js; main.js commands.start)
    await syncProfileTexts().catch((error) => log(`Bot tavsifi yangilanmadi: ${error.description ?? error.message}`));
    if (config.channel?.startsWith("-100")) config.channelId = Number(config.channel);
    else if (config.channel) config.channelId = (await bot.api.getChat(config.channel).catch(() => null))?.id ?? null;
    // A'zolik: kanal/guruh nomlari va havolalari, bot u yerda adminmi
    await members.init(bot.botInfo.id);
  }

  // notices — server (apps/api) qo'ygan topshiriqlar (xaritada yo'nalish tanlandi): main.js notices.start()
  // sources — foydalanuvchi qo'shgan guruhlar kuzatuvchisi: main.js sources.start()
  // directDone — yuk beruvchiga natija (main.js worker deps.onDirect)
  // Guruh bo'limlariga asl matn (pipeline.js quick chaqiradi; GROUP_LOADS bo'lmasa — null)
  const groupRaw = group ? (post, look) => group.pushRaw(post, look) : null;
  const setCatchUp = (fn) => (catchUpFn = fn);
  return { bot, init, publish, deliver, deliverRaw, groupRaw, setCatchUp, isBusy, canReceive, directDone, members, syncMembers, commands, notices, sources, group, holdReminder };
}
