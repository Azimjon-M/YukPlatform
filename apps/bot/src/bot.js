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
  KIND_MATCHERS,
  ROLES,
  ROLE_IDS,
  ROLE_KIND,
  SHIPPER_LOAD_LIMIT,
  formatContactPhone,
  isAdmin,
  isOwnContact,
  normalizeContactPhone,
  phoneText,
  roleOf,
  routeChosen,
  sanitizeProfileFor,
  sanitizeShipperLoad,
  shipperLoadText,
  shouldAskPhone,
  telegramUsername,
  validRole,
  withRoute,
} from "@yuk/shared";
import { createCommandSync } from "./commands.js";
import { escapeHtml, formatLoad, formatTruck } from "./format.js";
import { IDLE_BUTTONS } from "./idle.js";
import { REMIND_EVERY_MS, SUB_CHECK, createMembership, isMember, joinPrompt, remindText } from "./members.js";
import { MENU, PHONE, mainMenu, matchesLabel, miniAppUrl, phoneKeyboard, settingsLabel } from "./menu.js";
import { createNoticeLoop } from "./notices.js";
import { ANY, applyRoute, chosenText, fromStep, toStep, validArea } from "./route.js";
import { LOAD_CALLBACKS, LOAD_TEXT, createLoadDesk, loadIntro, resultText } from "./shipperLoads.js";
import { ADD_GROUP_TEXT, INTAKE, LINK_RE, createSourceIntake, createSourceWatcher, parseSourceLink } from "./userSources.js";
import { applyAction, applyText, describeProfile, newDraft, profileFromDraft, renderStep } from "./wizard.js";

const LOADS_WINDOW_MS = 24 * 60 * 60 * 1000; // "📋 Mos yuklar" / "🚚 Bo'sh mashinalar" — oxirgi 24 soat
const LOADS_SHOWN = 5;
const LOADS_LIMIT = 5000; // 24 soatda ~4 000 yuk — hammasidan sanaladi (store standarti 500)

// Bot haqida — Azimjon yozgan matn (2026-11-10). Bot tavsifi ham, rol tanlanmagandagi /start ham shu bilan boshlanadi.
// «o'zingiz belgilagan guruhlar» — menyudagi «➕ Guruh qo'shish» (raqam ulashganlarda; userSources.js)
const NAME = "Yuk Eksperti";
const ABOUT =
  "Yuk beruvchidan yukni to'g'ridan-to'g'ri olib, haydovchilarga yetkazamiz. Shuningdek, yirik guruhlar yoki o'zingiz " +
  "belgilagan guruhlardan e'lonlarni yo'nalishingiz va transportingizga mos e'lonni shaxsiy xabaringizga yuboramiz.";

// Bot profilidagi matnlar (botni birinchi ochganda "Bu bot nima qila oladi?" o'rnida chiqadi; Telegram cheki — 512 belgi)
const DESCRIPTION = `🚛 ${NAME} — ${ABOUT}\n\nBoshlash uchun /start ni bosing!`;
const SHORT_DESCRIPTION = "Yuk beruvchidan haydovchiga — to'g'ridan-to'g'ri. Katta yuk guruhlaridan mos yuklar va bo'sh mashinalar.";

// Rolni almashtirishdan oldin (/rol, «🔄 Rolni almashtirish»)
// Ro'yxatdan o'tishdagi oxirgi qadamdan oldin (forma va raqamdan keyin) — «Qayerdan?» shu matndan keyin keladi
const ROUTE_NEXT = "Endi qayerdan qayerga yuk kerakligini tanlang 👇";
const ROLE_SWITCH_NOTE ="Har rolning sozlamalari alohida saqlanadi — qaytib kelsangiz, qaytadan kiritish shart emas.";

// Nega raqam so'raymiz — so'rashda, /raqam da va /start dagi menyu tavsifida bir xil ma'no
// (raqam keyin ilovaga kirishda ham kerak bo'ladi — Azimjon, 2026-11-07; 2026-11-10 da uning so'zlari bilan qayta yozildi).
// «hech kimga ko'rsatilmaydi … O'chirish — /ochirish» qatori olib tashlandi (uning matni); raqam saqlangach ham faqat
// «Raqamingiz saqlandi! ✅». /ochirish — «Menu» buyruqlari ro'yxatida
// Raqam ulashgandan keyin menyuda «📱 Raqam ulashish» o'rnida «➕ Guruh qo'shish» chiqadi (Azimjon, 2026-11-10:
// «forma to'ldirgandan so'ng raqam ulashishdan avval» aytilsin — shu rejim uchun ham raqam ulashsin).
// Matni — hamma joydagidek bitta jumla (ADD_GROUP_TEXT, userSources.js)
const GROUP_UNLOCK = ADD_GROUP_TEXT;
const PHONE_WHY =
  "Raqamingizni ulashsangiz, botni o'chirib qayta yoqsangiz yoki keyin ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi " +
  "va joyidan davom etaverasiz — qaytadan ro'yxatdan o'tish shart emas.\n\n" +
  GROUP_UNLOCK +
  "\n\nRaqamingizni ulashish ixtiyoriy!";

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

// Rol so'rash (ostida ikki tugma: r:haydovchi / r:yuk_beruvchi). Avval «Siz kimsiz?» edi — Azimjon: qo'pol
const ROLE_QUESTION = "Iltimos, rolingizni tanlang 👇";

// Rolga qarab so'zlar: nima keladi, sozlamalarda nima so'raladi.
// chosen — rol tanlangach (sozlamalar hali yo'q): haydovchinikini Azimjon yozgan (2026-11-10), yuk beruvchiniki — unga o'xshatib
// Yuk beruvchida «📦 Yuk berish» (2026-11-10) — yuk yuborish asosiy ish, bo'sh mashina e'lonlari esa ixtiyoriy
// (Azimjon: ro'yxatdan o'tish shart emas). chosen — rol tanlangach birinchi qator, ostida loadIntro (shipperLoads.js)
const ROLE_TEXT = {
  haydovchi: {
    chosen: "🚚 Haydovchisiz. Sizga to'g'ri keladigan yuk e'lonlarini (transportingiz va yo'nalishingizga mos) yo'naltiramiz.",
    one: "yuk",
    many: "yuklar",
    matches: "qayerdan qayerga — tanlaysiz: oxirgi 24 soatdagi mos yuklar chiqadi, yangilari ham shu yo'nalishda keladi",
    settings: "transport va qayerda ishlashingiz",
    setup: "transportingizni",
  },
  yuk_beruvchi: {
    chosen: "📦 Yuk beruvchisiz.",
    // Ro'yxatdan o'tish (sozlamalar) nima beradi — yuk beruvchida u ixtiyoriy
    register: "bo'sh mashina e'lonlari ham kerak bo'lsa: yo'nalishingiz va qanday mashina kerakligi (1 daqiqalik forma)",
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
    return [
      INTRO,
      "",
      `${ROLES.yuk_beruvchi.icon} Yuk beruvchilarga — yukingizga mos transportlar;`,
      `${ROLES.haydovchi.icon} Haydovchilarga — transportingizga mos yuklar.`,
    ].join("\n");
  }
  const t = ROLE_TEXT[role];
  // Menyudagi tartibda (menu.js mainMenu). Ro'yxatdan o'tmaguncha menyuda faqat 3 tugma — ro'yxat ham shular.
  // Matnlar — Azimjon (2026-11-10; ro'yxatdan o'tmagan haydovchining /start ekrani bo'yicha, umumiy qatorlar hammaga)
  const roleLine = `${MENU.role} — haydovchi va yuk beruvchi`;
  // Yuk beruvchida birinchi qator — «📦 Yuk berish» (menu.js)
  const loadLine = role === "yuk_beruvchi" ? [`${MENU.giveLoad} — yukingizni haydovchilarga yuborish: forma yoki shu yerga oddiy xabar`] : [];
  const menuLines = driver?.profile
    ? [
        `${matchesLabel(driver)} — ${t.matches}`,
        `${MENU.pause} / ${MENU.resume} — yuborishni to'xtatish va yoqish`,
        roleLine,
        driver.phone
          ? ADD_GROUP_TEXT
          : `${MENU.phone} — raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi va joyidan davom etasiz`,
        `${settingsLabel(driver)} — ${t.settings}`,
      ]
    : [`${settingsLabel(driver)} — ${t.register ?? "sizga qanday e'lonlar yo'naltirishimiz haqida"}`, roleLine]; // «1 daqiqalik forma» — /start oxirida
  return [
    INTRO,
    "",
    "<b>Pastdagi menyu:</b>",
    ...loadLine,
    ...menuLines,
    "",
    `Siz: ${ROLES[role].icon} ${ROLES[role].name}siz.`, // «Haydovchisiz» / «Yuk beruvchisiz»
    "Menyuni yozish qatorining o'ng tomonidagi belgi orqali ochib-yopiladi, umuman yo'qolsa — /start ni bosing.",
    // /ochirish bu yerda yo'q (Azimjon matni) — u «Menu» buyruqlari ro'yxatida va raqam so'rash/saqlash xabarlarida bor
    "Telefon ilovalari — /ilovalar.",
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
export function loadButtons(load, post, callUrl = () => null) {
  const source = post?.link ? InlineKeyboard.url(SOURCE_BUTTON, post.link) : null;
  const phones = (load.phones ?? []).slice(0, MAX_CALL_BUTTONS);
  const calls = phones
    .map((phone, i) => {
      const url = callUrl(i);
      if (!url) return null;
      return InlineKeyboard.webApp(phones.length === 1 ? CALL_BUTTON : `📞 ${formatContactPhone(phoneText(phone))}`, url);
    })
    .filter(Boolean);
  const rows = calls.length <= 1 ? [[source, ...calls].filter(Boolean)] : [...(source ? [[source]] : []), ...calls.map((b) => [b])];
  return rows[0].length ? InlineKeyboard.from(rows) : null;
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
// parseLoad(text) — yuk beruvchi chatga yozgan yukni tushunish (main.js: qoidaviy parser, bo'lmasa AI; null — AI band);
// onLoadQueued() — yuk beruvchining yuki navbatga tushdi (main.js: ishchi darhol uyg'onadi)
export function createBot({
  token,
  store,
  config,
  log = console.log,
  botInfo,
  appUrl = () => config.miniappUrl,
  linkToken = () => null,
  callLink = () => null,
  parseLoad = async () => null,
  onLoadQueued = () => {},
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  // Telegram "juda tez" (429) desa, aytilgan vaqtcha kutib qayta yuboradi
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  // «Menu» tugmasi (buyruqlar ro'yxati) — faqat rol tanlaganlarda (commands.js). main.js commands.start() ni chaqiradi
  const commands = createCommandSync({ api: bot.api, store, log });

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
  const members = config.requiredChats?.length
    ? createMembership({
        api: bot.api,
        refs: config.requiredChats,
        log,
        onChecked: (userId, result) => {
          try {
            store.setSubscription?.(userId, result);
          } catch (error) {
            log(`A'zolik yozilmadi: ${error.message}`);
          }
        },
      })
    : null;

  // To'siq: shaxsiy chatdagi xabar yoki tugma — avval a'zolik. A'zo bo'lmasa — «a'zo bo'ling» xabari va tugmalar,
  // xabarning o'zi bajarilmaydi (next() chaqirilmaydi). Guruh va kanal postlari, «✅ A'zo bo'ldim», /ochirish va uning
  // tugmalari (ma'lumotini o'chirish huquqi a'zolikka bog'liq emas), /id va adminlar — tekshirilmaydi.
  // A'zo natijasi 10 daqiqa eslab qolinadi (Telegram'ga har xabarda so'rov ketmaydi), «a'zo emas» — har safar qayta so'raladi.
  const FREE_COMMAND = /^\/(ochirish|id)(@\w+)?(\s|$)/;
  bot.use(async (ctx, next) => {
    if (!members || ctx.chat?.type !== "private" || !ctx.from || !(ctx.message || ctx.callbackQuery)) return next();
    const data = ctx.callbackQuery?.data ?? "";
    if (data === SUB_CHECK || /^del:/.test(data) || FREE_COMMAND.test(ctx.message?.text ?? "")) return next();
    if (isAdmin(store.getDriver(ctx.from.id) ?? { chatId: ctx.from.id }, config.admins ?? [])) return next();
    rememberUser(ctx); // yangi odam ham boshqaruv markazida ko'rinsin (va a'zoligi yozilsin)
    const result = await members.check(ctx.from.id, { fresh: true });
    if (result.ok) return next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Avval kanal va guruhimizga a'zo bo'ling" }).catch(() => {});
    await sendJoinPrompt(ctx, result.missing);
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
  const html = (driver) => ({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...menu(driver) });

  // «📞 Telefon qilish» sahifasining manzili: Mini App bilan bir server (nginx /pub/ ni haydovchilar serveriga uzatadi).
  // Faqat https — Telegram tugmada boshqasini qabul qilmaydi (xabar umuman ketmay qolardi). loadId — loads jadvalidagi id
  const callUrl = (chatId, loadId) => (phone) => {
    const base = appUrl();
    if (loadId == null || !base?.startsWith("https://")) return null;
    const link = callLink({ loadId, phone, chatId });
    return link ? new URL(`/pub/call?c=${link}`, base).href : null;
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

  // «📦 Yuk berish» formasi (web ilovaning «yuk» bo'limi). Inline «✏️ Formada tuzatish» tugmasi uchun — tokensiz
  // (routeMapUrl dagidek: inline tugmadan ochilganda Telegram kimlikni o'zi beradi), d=1 — botdagi qoralama bilan ochiladi.
  // Pastki menyudagi «📦 Yuk berish» tugmasi — menu.js (u yerda token bilan). Faqat https
  const loadFormUrl = ({ draft = false } = {}) => {
    const base = appUrl();
    if (!base?.startsWith("https://")) return null;
    const url = new URL(miniAppUrl(base, null, scope, { view: "yuk", role: "yuk_beruvchi" }));
    if (draft) url.searchParams.set("d", "1");
    return url.href;
  };
  // Botga yozilgan yuk: tushunish → raqam (yo'q bo'lsa) → tasdiqlash → navbat (shipperLoads.js)
  const desk = createLoadDesk({ store, parse: parseLoad, scope, onQueued: () => onLoadQueued(), editUrl: () => loadFormUrl({ draft: true }) });

  function rememberUser(ctx) {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return store.saveDriver(ctx.chat.id, { name, username: from.username ?? null });
  }

  // Oxirgi 24 soatdagi mos e'lonlar: haydovchiga yuklar, yuk beruvchiga bo'sh mashinalar
  function matching(user) {
    const kind = ROLE_KIND[roleOf(user)];
    const matches = KIND_MATCHERS[kind];
    return store.recentLoads({ sinceMs: LOADS_WINDOW_MS, limit: LOADS_LIMIT, kind }).filter((row) => matches(row.load, user.profile).ok);
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

  // «Iltimos, rolingizni tanlang» (yoki /rol da — hozirgi rol) — ikki tugma (r:haydovchi / r:yuk_beruvchi)
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

  async function startWizard(ctx, profile = null, role = "haydovchi") {
    const draft = newDraft(profile, scope, role);
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft);
  }

  // Sozlamalar: Mini App bo'lsa — pastki menyudagi tugma uni ochadi; bo'lmasa — chatda savol-javob
  async function openSettings(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    if (!appUrl()) return startWizard(ctx, driver.profile, role);
    await ctx.reply(`Pastdagi «${settingsLabel(driver)}» tugmasini bosing — forma ochiladi. To'ldirib, «Saqlash» ni bosasiz.`, menu(driver));
  }

  async function saved(ctx, profile, role) {
    // Mini App boshqa rol bilan saqladi (masalan, formada rolni almashtirib) — avval eski rolning sozlamalarini saqlab qo'yamiz
    if (store.getDriver(ctx.chat.id)?.role !== role) store.switchRole(ctx.chat.id, role);
    // Haydovchi formasida yo'nalish yo'q (u «📋 Mos yuklar» da tanlanadi) — eskisi qoladi
    if (role === "haydovchi") profile = withRoute(profile, store.getDriver(ctx.chat.id)?.profile);
    const driver = store.saveDriver(ctx.chat.id, { role, profile, draft: null, active: true });
    const t = ROLE_TEXT[role];
    // Yangi haydovchi: yo'nalish tanlanmaguncha yuk yuborilmaydi. Tartib (Azimjon, 2026-11-10): forma → raqam (bir marta,
    // ixtiyoriy) → yo'nalish. Raqamga javob bergach (ulashdi yoki «Keyinroq») — afterPhone() yo'nalishni so'raydi.
    // 2026-11-07…10 da raqam yo'nalishdan KEYIN so'ralardi.
    if (role === "haydovchi" && !routeChosen(profile)) {
      if (shouldAskPhone(driver)) {
        // Faqat «✅ Saqlandi.» — sozlamalar ro'yxatisiz (Azimjon, 2026-11-10): uzun ro'yxat keyingi raqam savolini
        // ekrandan chiqarib yuborardi; xato bo'lsa — «⚙️ Sozlamalar» da ko'radi va tuzatadi.
        // Menyusiz: darhol keyingi xabardagi raqam klaviaturasi uning o'rnini oladi, menyu javobdan keyin qaytadi
        await ctx.reply("✅ Saqlandi.");
        await askPhone(ctx, driver);
        return;
      }
      await ctx.reply(`✅ Saqlandi.\n\n${describeProfile(profile, scope, role)}\n\n${ROUTE_NEXT}`, menu(driver));
      await askRoute(ctx, driver);
      return;
    }
    // Birinchi marta sozlagach (yuk beruvchi, yoki yo'nalishi tiklangan haydovchi) — raqamni bir marta so'raymiz (ixtiyoriy).
    // Shunda ham faqat «✅ Saqlandi.» (Azimjon, 2026-11-10: yuk beruvchida ham — ro'yxat raqam savolini ekrandan chiqarardi)
    if (shouldAskPhone(driver)) {
      await ctx.reply("✅ Saqlandi.");
      await askPhone(ctx, driver);
      return;
    }
    // Qayta saqlash (raqam allaqachon so'ralgan) — sozlamalar ro'yxati va 24 soatdagi mos e'lonlar soni bilan
    const count = matching(driver).length;
    const extra = count ? `\n\nOxirgi 24 soatda sizga mos ${count} ta ${t.one} bor — «${matchesLabel(driver)}» ni bosing.` : "";
    await ctx.reply(`✅ Saqlandi. Endi mos ${t.many} shu yerga keladi.\n\n${describeProfile(profile, scope, role)}${extra}`, menu(driver));
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
    const needsRoute = roleOf(driver) === "haydovchi" && Boolean(driver.profile) && !routeChosen(driver.profile);
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
          `${escapeHtml(describeProfile(driver.profile, scope, role))}\n\nO'zgartirish — «${settingsLabel(driver)}».`,
        html(driver),
      );
      return;
    }
    // Yuk beruvchi (2026-11-10): darhol «📦 Yuk berish» — forma yoki oddiy xabar; bo'sh mashinalar uchun ro'yxatdan o'tish ixtiyoriy
    if (role === "yuk_beruvchi") {
      const t = ROLE_TEXT[role];
      await ctx.reply(`${t.chosen}\n\n${loadIntro({ form: Boolean(loadFormUrl()) })}\n\n«${settingsLabel(driver)}» — ${t.register}.`, html(driver));
      return;
    }
    // Rol tanlandi, sozlamalar hali yo'q (Azimjon matni, 2026-11-10): nima keladi + «Ro'yxatdan o'tish» tugmasi
    const next = appUrl() ? `\n\n👇 Endi pastdagi «${settingsLabel(driver)}» tugmasini bosing — 1 daqiqalik forma.` : "";
    await ctx.reply(`${ROLE_TEXT[role].chosen}${next}`, html(driver));
    if (!appUrl()) await startWizard(ctx, null, role);
  }

  async function setActive(ctx, active) {
    const driver = rememberUser(ctx);
    if (!driver.profile) return openSettings(ctx);
    const updated = store.saveDriver(ctx.chat.id, { active });
    await ctx.reply(active ? "▶️ Yuk yuborish yoqildi." : `⏸ Yuk yuborish to'xtatildi. Qayta yoqish: «${MENU.resume}»`, menu(updated));
  }

  // «📋 Mos yuklar» (haydovchi) yoki «🚚 Bo'sh mashinalar» (yuk beruvchi) — eski menyu tugmasi bosilsa ham hozirgi rol bo'yicha.
  // Haydovchidan avval yo'nalish so'raladi (route.js), yuk beruvchiga — darhol ro'yxat
  async function showMatches(ctx) {
    const driver = rememberUser(ctx);
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    const t = ROLE_TEXT[role];
    if (!driver.profile) {
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
    if (members && !isAdmin(driver, config.admins ?? []) && !(await members.check(chatId)).ok) return;
    await listMatchesIn(chatId, driver);
    if (shouldAskPhone(driver)) await askPhoneIn(chatId, driver);
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
    lines.push(`🤖 Android: ${config.androidUrl ? link(config.androidUrl, "yuklab olish") : config.apkFile ? "o'rnatish fayli pastda 👇" : "tez orada"}`);
    lines.push(`🍏 iPhone: ${config.iosUrl ? link(config.iosUrl, "App Store") : "tez orada"}`);
    if (appUrl() && roleOf(driver)) lines.push(`💬 Telegram ichida: pastdagi «${settingsLabel(driver)}» tugmasi ilovani ochadi`);
    if (config.channelLoads && config.channel?.startsWith("@")) lines.push(`📢 Hamma yangi yuklar kanalda: ${config.channel}`);
    await ctx.reply(lines.join("\n"), html(driver));
    if (!config.apkFile) return;
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
      await ctx.reply(`${hello}\n\n<b>Sizning sozlamalaringiz:</b>\n${escapeHtml(describeProfile(driver.profile, scope, role))}`, html(driver));
      // Raqam so'rash paydo bo'lishidan oldin ro'yxatdan o'tganlar — bir marta shu yerda so'raladi
      if (shouldAskPhone(driver)) await askPhone(ctx, driver);
      return;
    }
    // Yuk beruvchi: ro'yxatdan o'tish shart emas — «📦 Yuk berish» (forma yoki oddiy xabar)
    if (role === "yuk_beruvchi") {
      await ctx.reply(`${hello}\n\n${loadIntro({ form: Boolean(loadFormUrl()) })}`, html(driver));
      return;
    }
    if (appUrl()) {
      // «pastdagi» dan keyin yangi qator: tor ekranda «…pastdagi «🚚» bo'lib tugma nomi bo'linib qolardi (Azimjon, 2026-11-10)
      await ctx.reply(`${hello}\n\n👇 Boshlash uchun pastdagi\n«${settingsLabel(driver)}» tugmasini bosing — 1 daqiqalik forma.`, html(driver));
      return;
    }
    await ctx.reply(hello, html(driver));
    await startWizard(ctx, null, role);
  }
  privateChat.command("start", showStart);

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
    // Raqam «➕ Guruh qo'shish» uchun ulashildi — yo'nalish savoli o'rniga guruh qo'shishga qaytamiz
    const intent = takeGroupIntent(ctx.chat.id);
    if (intent && roleOf(updated)) return groupAfterPhone(ctx, updated, intent);
    // Faqat shu (Azimjon, 2026-11-10). Raqamning o'zi — /raqam da, o'chirish — /ochirish (buyruqlar ro'yxatida)
    await afterPhone(ctx, updated, "Raqamingiz saqlandi! ✅", { hint: false });
  });

  // «⏭ Keyinroq» / «↩️ O'zgartirmaslik» — asosiy menyu qaytadi, bot boshqa so'ramaydi
  privateChat.hears([PHONE.later, PHONE.keep], async (ctx) => {
    const driver = rememberUser(ctx);
    const text = driver.phone ? "Raqamingiz o'zgarmadi." : `Mayli. Xohlasangiz, keyin pastdagi «${MENU.phone}» tugmasi bilan ulashasiz.`;
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
  function needPhone(ctx, username = null) {
    groupIntents.set(ctx.chat.id, { username, at: Date.now() });
    return ctx.reply(INTAKE.needPhone(Boolean(username)), { reply_markup: phoneKeyboard(false) });
  }
  // Raqam guruh uchun ulashilgach: havolasi bor edi — o'sha darhol tekshiriladi, yo'q edi — «havolani yuboring» xabari
  async function groupAfterPhone(ctx, driver, { username }) {
    const text = username ? await sourceIntake.submit(ctx.chat.id, username) : sourceIntake.intro(ctx.chat.id);
    await ctx.reply(`Raqamingiz saqlandi! ✅\n\n${text}`, html(driver));
  }
  async function showAddGroup(ctx) {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    if (!driver.phone) return needPhone(ctx);
    await ctx.reply(sourceIntake.intro(ctx.chat.id), html(driver));
  }
  privateChat.hears(MENU.addGroup, showAddGroup);
  privateChat.command("guruh_qoshish", showAddGroup); // «Menu» ro'yxatida ham (commands.js)
  privateChat.hears(LINK_RE, async (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx);
    const link = parseSourceLink(ctx.message.text);
    if (!driver.phone) return needPhone(ctx, link.username ?? null);
    const text = link.error ? INTAKE[link.error] : await sourceIntake.submit(ctx.chat.id, link.username);
    await ctx.reply(text, html(driver));
  });
  // Natijani (sinovga olindi / rad etildi / doimiy qo'shildi / o'chirildi) qo'shgan odamga yozadi — pastki menyu bilan
  const sources = createSourceWatcher({
    store,
    log,
    send: (chatId, text) => bot.api.sendMessage(chatId, text, html(store.getDriver(chatId))),
  });

  // Pastki menyu tugmalari (savol-javob o'rtasida bosilsa ham ishlaydi, qoralama saqlanib qoladi)
  privateChat.hears([MENU.loads, MENU.trucks], showMatches);
  privateChat.hears([MENU.settings, MENU.register], openSettings);
  privateChat.hears(MENU.pause, (ctx) => setActive(ctx, false));
  privateChat.hears(MENU.resume, (ctx) => setActive(ctx, true));
  privateChat.hears(MENU.apps, showApps); // eski menyudagi tugma (endi menyuda raqam tugmasi)
  privateChat.command("ilovalar", showApps);
  privateChat.hears(MENU.role, switchRolePrompt);
  privateChat.hears(MENU.help, showHelp);

  // --- «📦 Yuk berish» (yuk beruvchi; shipperLoads.js, 2026-11-10) ---
  // Pastki menyudagi tugma odatda formani ochadi (Mini App) va chatga hech narsa yubormaydi. Forma manzili yo'q bo'lsa —
  // oddiy tugma: bosilganda «shu yerga oddiy xabar qilib yozing»
  privateChat.hears(MENU.giveLoad, async (ctx) => {
    const driver = rememberUser(ctx);
    if (roleOf(driver) !== "yuk_beruvchi") return showStart(ctx);
    await ctx.reply(loadIntro({ form: Boolean(loadFormUrl()) }), html(driver));
  });

  // Desk ko'rinishi ({ text, keyboard? }) → xabar. Tugmali xabarda pastki menyu bo'lmaydi (Telegram: bitta xabar — bitta
  // markup), tugmasizida — menyu
  async function showLoadView(ctx, view, driver, { edit = false } = {}) {
    const markup = view.keyboard ? { reply_markup: view.keyboard } : menu(driver);
    await render(ctx, view.text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }, edit);
  }

  // Yuk beruvchi chatga oddiy xabar yozdi — yuk deb o'qiymiz (AI bir necha soniya o'ylashi mumkin: «yozmoqda...» belgisi)
  async function readLoad(ctx, driver) {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const view = await desk.read(ctx.chat.id, ctx.message.text, driver, { form: Boolean(loadFormUrl()) });
    await showLoadView(ctx, view, driver);
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
    const { profile, error } = data?.type === "profile" ? sanitizeProfileFor(role, data.profile, { scope }) : { error: "noma'lum ma'lumot keldi" };
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
    if (!members) {
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
    await showStart(ctx);
  });

  // Kanal yoki guruhga kimdir qo'shildi / chiqdi (bot u yerda admin, main.js allowed_updates: chat_member).
  // Eslab qolingan natija o'chiriladi. Bot foydalanuvchisi chiqib ketsa va yuk olib turgan bo'lsa — darrov eslatma
  bot.on("chat_member", async (ctx) => {
    if (!members?.watches(ctx.chat)) return;
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
  bot.callbackQuery([IDLE_BUTTONS.ok, IDLE_BUTTONS.resume], async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery();
    const driver = rememberUser(ctx);
    await ctx.answerCallbackQuery(ctx.callbackQuery.data === IDLE_BUTTONS.ok ? { text: "✅ Rahmat!" } : undefined);
    await ctx.editMessageReplyMarkup().catch(() => {}); // tugma qayta bosilmasin
    if (driver.profile && driver.active === false) return setActive(ctx, true);
    const t = ROLE_TEXT[roleOf(driver)] ?? ROLE_TEXT.haydovchi;
    await ctx.reply(`✅ Yaxshi, ${t.many} kelishda davom etadi.`, menu(driver));
  });

  // «📋 Mos yuklar»: mr:f:<qayerdan> → «Qayerga?», mr:t:<qayerdan>:<qayerga> → saqlash va ro'yxat,
  // mr:back — «Qayerdan?» ga qaytish, mr:last — oxirgi yo'nalish bilan ro'yxat (endi chiqarilmaydi, chatdagi eski tugmalar uchun)
  bot.callbackQuery(/^mr:(?:f:(.+)|t:([^:]+):(.+)|last|back)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    const driver = store.getDriver(ctx.chat.id);
    if (roleOf(driver) !== "haydovchi" || !driver.profile) {
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
    if (shouldAskPhone(updated)) await askPhone(ctx, updated);
  });

  // Chatdagi savol-javob (Mini App bo'lmasa)
  bot.callbackQuery(/^w:(\w+):(.+)$/, async (ctx) => {
    const [, step, value] = ctx.match;
    const driver = store.getDriver(ctx.chat.id);
    await ctx.answerCallbackQuery();
    const role = roleOf(driver);
    if (!role) return showStart(ctx);
    if (!driver.draft) return startWizard(ctx, driver.profile, role);
    const { draft, saved: done } = applyAction(driver.draft, step, value);
    if (done) {
      await ctx.editMessageText("✅ Javoblar qabul qilindi.");
      await saved(ctx, profileFromDraft(draft), draft.role ?? role);
      return;
    }
    store.saveDriver(ctx.chat.id, { draft });
    await showStep(ctx, draft, { edit: true });
  });

  privateChat.on("message:text", async (ctx) => {
    const driver = rememberUser(ctx);
    if (!roleOf(driver)) return showStart(ctx); // menyu yo'q — avval rol
    // Yuk beruvchi oddiy xabar yozdi — bu uning yuki («📦 Yuk berish», shipperLoads.js). Chatdagi sozlamalar savol-javobi
    // (draft) ochiq bo'lsa — avval u
    if (!driver.draft && roleOf(driver) === "yuk_beruvchi") return readLoad(ctx, driver);
    if (!driver.draft) {
      await ctx.reply("Pastdagi menyudan tanlang 👇", menu(driver));
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
  async function publish(load, post) {
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
    if (!members || isAdmin(user, config.admins ?? [])) return true;
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
  async function deliver(chatId, load, post, kind = "yuk", loadId = null) {
    const driver = store.getDriver(chatId);
    const buttons = loadButtons(load, post, callUrl(chatId, loadId));
    const send = (markup) =>
      bot.api.sendMessage(chatId, directText(load, post, kind), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup });
    try {
      try {
        await send(buttons ? { reply_markup: buttons } : driver ? menu(driver) : {});
      } catch (error) {
        // Telegram tugmani qabul qilmasa (400, masalan manzil yaroqsiz) — yuk baribir yetib borsin: tugmalarsiz
        if (!buttons || !(error instanceof GrammyError) || error.error_code !== 400) throw error;
        log(`Yuk tugmalari qabul qilinmadi (${error.description}) — tugmalarsiz yuborildi`);
        await send(driver ? menu(driver) : {});
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
    if (members) await members.init(bot.botInfo.id);
  }

  // notices — server (apps/api) qo'ygan topshiriqlar (xaritada yo'nalish tanlandi): main.js notices.start()
  // sources — foydalanuvchi qo'shgan guruhlar kuzatuvchisi: main.js sources.start()
  // directDone — yuk beruvchiga natija (main.js worker deps.onDirect)
  return { bot, init, publish, deliver, canReceive, directDone, members, commands, notices, sources };
}
