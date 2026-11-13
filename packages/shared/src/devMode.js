// Lokal dasturlash rejimi (Azimjon, 2026-11-13: «hozir loyiha globalda, bizham run bersak kanflikt bo'lmaydimi?»).
//
// Loyiha endi serverda ishlaydi (https://yuk.gtpro.uz) — o'sha @Yuk_Ekspert_agent boti va o'sha Telegram akkaunti bilan.
// Kompyuterda ham shu bot ishga tushsa: ikkita getUpdates → Telegram «409 Conflict» bilan birini uzadi, ikkala
// boshqaruv markazi botni qayta-qayta yoqib, bir-birini to'xtataveradi (serverdagi bot ham ishlamay qoladi), lokal
// ishchi esa eski bazadagi haqiqiy haydovchilarga yuklarni ikkinchi marta yuboradi. Collector esa bitta akkaunt
// bilan guruhlarni ikki joydan o'qiydi (FLOOD / ban xavfi; bitta sessiya fayli ikki IP'dan — AUTH_KEY_DUPLICATED).
//
// Shuning uchun kompyuterdagi .env da YUK_ENV=dev bo'ladi (serverda bu qator YO'Q — u yerda hech narsa o'zgarmaydi):
//   • bot prod bot (PROD_BOTS, standart @Yuk_Ekspert_agent) tokeni bilan ishga tushmaydi — test bot kerak;
//   • collector Telegram sessiyasini ishlatmaydi (alohida akkaunt bilan kirib, DEV_COLLECTOR=1 qo'yilmaguncha);
//   • boshqaruv markazi AUTOSTART'da collector'ni o'zi yoqmaydi.

// «Sozlamani tuzating» chiqish kodi (sysexits EX_CONFIG). Boshqaruv markazi (apps/api processes.js) bunday
// to'xtagan jarayonni qayta yoqmaydi: .env tuzatilmaguncha qayta yoqish baribir yordam bermaydi.
export const EXIT_CONFIG = 78;

// Serverda ishlayotgan (haqiqiy foydalanuvchilar yozadigan) botlar. Boshqa bo'lsa — .env PROD_BOTS=@bot1,@bot2
export const PROD_BOTS_DEFAULT = ["Yuk_Ekspert_agent"];

const DEV_WORDS = /^(dev|development|local|lokal|sinov|test)$/i;
const YES = /^(1|ha|yes|true|on)$/i;

// .env YUK_ENV=dev (yoki development / local / lokal / sinov / test) — shu kompyuter dasturlash uchun
export function isDevMode(env = process.env) {
  return DEV_WORDS.test(env.YUK_ENV?.trim() ?? "");
}

// "@Bot1, bot2" → ["Bot1", "bot2"]; bo'sh bo'lsa — standart ro'yxat
export function prodBots(env = process.env) {
  const list = (env.PROD_BOTS ?? "")
    .split(/[,\s]+/)
    .map((name) => name.trim().replace(/^@/, ""))
    .filter(Boolean);
  return list.length ? list : PROD_BOTS_DEFAULT;
}

// Dasturlash rejimida bot shu token bilan ishga tushsa bo'ladimi? → null (bo'ladi) yoki tushuntirish matni.
// username — getMe javobidan (token egasi). Telegram'da bot nomi katta-kichik harfga qaramaydi.
export function devBotProblem(username, env = process.env) {
  if (!isDevMode(env)) return null;
  const name = String(username ?? "").replace(/^@/, "").toLowerCase();
  if (!prodBots(env).some((bot) => bot.toLowerCase() === name)) return null;
  return [
    `⛔ Dasturlash rejimi (.env: YUK_ENV=${env.YUK_ENV.trim()}): BOT_TOKEN — serverda ishlayotgan @${username} botining tokeni.`,
    "Kompyuterda ham shu bot ishga tushsa, Telegram ikkalasidan birini «409 Conflict» bilan uzadi — serverdagi bot ishlamay qoladi.",
    "Lokal sinov uchun alohida bot oching: @BotFather → /newbot, uning tokenini .env ga BOT_TOKEN=... deb yozing.",
    "(Bu kompyuter yana haqiqiy bot bo'lishi kerak bo'lsa — avval serverdagi botni to'xtating, keyin .env dan YUK_ENV ni olib tashlang.)",
  ].join("\n");
}

// Dasturlash rejimida collector Telegram sessiyasini ishlatsa bo'ladimi? → null yoki tushuntirish matni.
// Kirish (tg:login) mumkin — u yangi sessiya ochadi. Qolgan buyruqlar sessiyani ishlatadi: DEV_COLLECTOR=1 kerak.
export function devCollectorProblem(command, env = process.env) {
  if (!isDevMode(env) || command === "login" || YES.test(env.DEV_COLLECTOR?.trim() ?? "")) return null;
  return [
    `⛔ Dasturlash rejimi (.env: YUK_ENV=${env.YUK_ENV.trim()}): collector Telegram akkauntini ishlatmaydi.`,
    "Serverdagi collector shu akkaunt bilan guruhlarni o'qiyapti: ikki joydan o'qish FLOOD / ban xavfini oshiradi,",
    "bitta sessiya ikki IP'dan ishlatilsa — Telegram uni bekor qilishi mumkin (serverdagi collector ham to'xtaydi).",
    "Lokal sinov kerak bo'lsa: ALOHIDA raqamdagi akkaunt bilan npm run tg:login, keyin .env ga DEV_COLLECTOR=1",
    "(TG_SESSION qatori bo'lmasin — u telegram.session faylidan ustun turadi).",
  ].join("\n");
}

// Boshqaruv markazining AUTOSTART ro'yxati: dasturlash rejimida collector o'zi yoqilmaydi (DEV_COLLECTOR=1 bo'lsa — yoqiladi)
export function devAutostart(names, env = process.env) {
  if (!devCollectorProblem("live", env)) return names;
  return names.filter((name) => name !== "collector");
}
