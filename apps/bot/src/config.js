// .env dagi bot sozlamalari. Kalitlar ekranga chiqarilmaydi — faqat bor-yo'qligi va ko'rinishi tekshiriladi.
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  return { token, channel, admins, miniappUrl, androidUrl, iosUrl, apkFile };
}
