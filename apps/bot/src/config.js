// .env dagi bot sozlamalari. Kalitlar ekranga chiqarilmaydi — faqat bor-yo'qligi va ko'rinishi tekshiriladi.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeScopeFrom } from "@yuk/shared";
import { readRequiredChats } from "./members.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Ixtiyoriy https manzil. Telegram Mini App faqat https bilan ochiladi.
function optionalUrl(env, name) {
  const value = env[name]?.trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} to'liq manzil bo'lishi kerak, masalan: https://yuk-ekspert.pages.dev`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} https:// bilan boshlanishi kerak (Telegram http manzilni ochmaydi).`);
  return url.toString();
}

export function readConfig(env = process.env) {
  const token = env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("BOT_TOKEN topilmadi. @BotFather → /newbot, keyin tokenni .env ga BOT_TOKEN=... deb yozing.");
  }
  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    throw new Error("BOT_TOKEN ko'rinishi noto'g'ri. U 123456789:ABC... ko'rinishida bo'ladi (bo'sh joy va qo'shtirnoqsiz).");
  }
  // Kanal: @Yuk_Ekspert yoki -100... raqami. Bo'lmasa, yuklar faqat haydovchilarga ketadi.
  const channel = env.CHANNEL_ID?.trim() || null;
  if (channel && !/^(@[A-Za-z]\w{3,}|-100\d+)$/.test(channel)) {
    throw new Error("CHANNEL_ID @kanal_nomi yoki -100... raqami bo'lishi kerak.");
  }
  // Adminlar (/holat buyrug'i uchun): Telegram id raqamlari, vergul bilan. O'z id'ingizni botga /id yozib bilasiz.
  const admins = (env.ADMIN_IDS ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);

  // Mini App (apps/web) joylangan manzil. Bo'lmasa, sozlamalar chatda savol-javob bilan bo'ladi.
  const miniappUrl = optionalUrl(env, "MINIAPP_URL");
  // "📱 Ilovalar" tugmasi: do'kon havolalari va Android o'rnatish fayli (yo'l YukPlatform papkasiga nisbatan)
  const androidUrl = optionalUrl(env, "ANDROID_URL");
  const iosUrl = optionalUrl(env, "IOS_URL");
  const apk = env.APK_FILE?.trim();
  if (apk && !/\.apk$/i.test(apk)) throw new Error("APK_FILE .apk fayl bo'lishi kerak, masalan: data/apk/yuk-ekspert.apk");
  const apkFile = apk ? path.resolve(ROOT, apk) : null;

  // Qaysi yo'nalishlar (@yuk/shared scope.js): qoshni (standart) | ichki | hammasi
  const routeScope = routeScopeFrom(env);

  const maxPostAgeMs = readMaxPostAge(env);

  // Yuklarni kanalga ham joylash. Standart — YO'Q (Azimjonning qarori, 2026-11-06): yuklar faqat haydovchilarga
  // shaxsiy xabarda boradi, kanal va guruh keyin boshqa maqsadda ishlatiladi. CHANNEL_ID baribir kerak:
  // bot o'z kanalining postlarini (va muhokama guruhidagi nusxalarini) yangi e'lon deb navbatga olmasin.
  const channelLoads = readFlag(env.CHANNEL_LOADS);

  // Yuklarni guruh bo'limlariga (Topics) mashina turi bo'yicha joylash (groupTopics.js; Azimjon, 2026-11-13).
  // GROUP_LOADS=@Yuk_Ekspert_chat yoki -100... Bo'sh — o'chiq
  const groupLoads = env.GROUP_LOADS?.trim() || null;
  if (groupLoads && !/^(@[A-Za-z]\w{3,}|-100\d+)$/.test(groupLoads)) {
    throw new Error("GROUP_LOADS @guruh_nomi yoki -100... raqami bo'lishi kerak.");
  }

  const ruleParser = ruleParserOn(env);

  // Aloqasiz e'lonlar (telefon ham, lichka ham yo'q) AI'ga ham, foydalanuvchilarga ham bormaydi (pipeline.js NO_CONTACT)
  const requireContact = requireContactOn(env);

  // Bot faqat shu kanal va guruh a'zolariga ishlaydi (members.js; Azimjon, 2026-11-09). Bo'sh — hammaga
  const requiredChats = readRequiredChats(env.REQUIRED_CHATS);

  return { token, channel, channelLoads, groupLoads, admins, miniappUrl, androidUrl, iosUrl, apkFile, routeScope, maxPostAgeMs, ruleParser, requireContact, requiredChats };
}

// AI'siz qoidaviy parser (pipeline.js ruleParse). Standart — YOQIQ (Azimjon, 2026-11-09: «Ha, ulab qo'y»);
// RULE_PARSER=0 (yoki yo'q / off / false) — hamma e'lon avvalgidek AI'ga
export function ruleParserOn(env = process.env) {
  return !/^(0|yo'q|yoq|no|false|off)$/i.test(env.RULE_PARSER?.trim() ?? "");
}

// Aloqasiz yuklarni to'xtatish. Standart — YOQIQ (Azimjon, 2026-11-10: «Aloqasiz yuklarni to'xtat»);
// REQUIRE_CONTACT=0 (yoki yo'q / off / false) — aloqasiz e'lonlar ham avvalgidek tahlil qilinib yuboriladi
export function requireContactOn(env = process.env) {
  return !/^(0|yo'q|yoq|no|false|off)$/i.test(env.REQUIRE_CONTACT?.trim() ?? "");
}

// Saralash algoritmi (AI / qoidalar → mashina va yo'nalish bo'yicha). Standart — O'CHIQ (Azimjon, 2026-11-19: «ushbu
// algoritmimizni hozir noaktiv qil. Bizga tezlik kerak sifat emas!»): hamma haydovchiga guruh e'loni asl matn bilan,
// filtrsiz, darhol (pipeline.js deps.sortingOff). FEED_SORTING=1 (ha / on / true) — avvalgi tartib qaytadi
// Guruh e'lonlarini AI tahlil qiladimi (2026-11-20, Azimjon: «AI bilan tahrirlamaymiz! O'zimiz yozgan algoritmimiz 96% to'g'ri
// ishlayotgan edi … AI faqat kerakli joylarimizda masalan Yuk beruvchi rolida yozsa … umumiy e'lonlarni qayta ishlash kerak
// emas»). Standart — YO'Q: guruh e'loni qoidaviy parser + fastLook bilan yopiladi; AI (Gemini) ovozli xabar va yuk beruvchi
// uchun bo'sh qoladi. .env GROUP_AI=1 — avvalgidek AI tahlil qiladi
export function groupAiOn(env = process.env) {
  return /^(1|ha|yes|true|on)$/i.test(env.GROUP_AI?.trim() ?? "");
}

export function sortingOffOn(env = process.env) {
  return !/^(1|ha|yes|true|on)$/i.test(env.FEED_SORTING?.trim() ?? "");
}

// "1", "ha", "true", "on" — yoqilgan; bo'sh va boshqa hamma narsa — o'chiq
export function readFlag(value) {
  return /^(1|ha|yes|true|on)$/i.test(value?.trim() ?? "");
}

// Joylanganiga necha soatdan oshgan e'lon AI'ga bormaydi va «Eskirgan» deb yopiladi.
// Bo'sh — 3 soat (Azimjonning qarori, 2026-11-06); 0 — cheklovsiz; 1.5 yoki 1,5 — bir yarim soat.
export const DEFAULT_MAX_POST_AGE_HOURS = 3;
function readMaxPostAge(env) {
  const raw = env.POST_MAX_AGE_HOURS?.trim();
  if (!raw) return DEFAULT_MAX_POST_AGE_HOURS * 3_600_000;
  const hours = Number(raw.replace(",", "."));
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("POST_MAX_AGE_HOURS soat bo'lishi kerak: masalan 3 yoki 1.5 (0 — cheklovsiz).");
  }
  return Math.round(hours * 3_600_000);
}
