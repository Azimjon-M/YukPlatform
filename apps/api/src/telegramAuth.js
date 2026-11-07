// Haydovchi kimligini Telegram orqali tekshirish va sessiya tokeni.
//
// Ikki yo'l bor, ikkalasida ham Telegram ma'lumotni BOT TOKENI bilan imzolaydi (HMAC-SHA256).
// Token faqat bizda bor, shuning uchun imzo to'g'ri chiqsa — ma'lumotni haqiqatan Telegram bergan, foydalanuvchi
// o'zi id'sini o'zgartira olmaydi.
//   1) Mini App (Telegram ichida): telegram-web-app.js beradigan `initData` qatori.
//      Kalit = HMAC_SHA256(kalit: "WebAppData", matn: bot_token).
//   2) Sayt (oddiy brauzerda): «Telegram bilan kirish» vidjeti qaytargan maydonlar (id, first_name, ..., hash).
//      Kalit = SHA256(bot_token).
// Imzolanadigan matn: hash'dan boshqa hamma maydon, nomi bo'yicha tartiblangan, "kalit=qiymat", qatorlar "\n" bilan.
//
// Tekshirilgandan keyin o'zimizning sessiya tokenimizni beramiz (har so'rovda Telegram ma'lumotini qayta yubormaslik uchun):
//   "<base64url(JSON {uid, exp})>.<base64url(HMAC_SHA256(sessiya kaliti, birinchi qism))>"
// Sessiya kaliti data/secret.key dan hosil qilinadi — server qayta ishga tushsa ham tokenlar ishlayveradi.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DAY_S = 24 * 60 * 60;
export const AUTH_MAX_AGE_S = DAY_S; // Telegram ma'lumoti 24 soatdan eski bo'lsa — qayta kirish kerak

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();

// Ikki hex/bayt qatorni vaqt bo'yicha teng solishtirish (qaysi belgida farq qilganini vaqtdan bilib bo'lmasin)
function sameHex(expected, given) {
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/i.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given.toLowerCase(), "hex"));
}

const checkString = (entries) =>
  entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

function fresh(authDate, nowS, maxAgeS) {
  const t = Number(authDate);
  if (!Number.isFinite(t)) return false;
  return nowS - t <= maxAgeS && t - nowS <= 300; // 5 daqiqagacha soat farqiga ruxsat
}

function userFrom(raw) {
  const id = Number(raw?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const text = (value, max = 64) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const name = [text(raw.first_name), text(raw.last_name)].filter(Boolean).join(" ") || null;
  return { id, name, username: text(raw.username, 32), photoUrl: text(raw.photo_url, 300) };
}

// Mini App: initData qatori → { user } yoki { error }
export function verifyWebAppData(initData, botToken, { now = Date.now(), maxAgeS = AUTH_MAX_AGE_S } = {}) {
  if (typeof initData !== "string" || !initData || initData.length > 8192) return { error: "Telegram ma'lumoti kelmadi" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const entries = [...params.entries()].filter(([k]) => k !== "hash");
  const secret = hmac("WebAppData", botToken);
  // `signature` maydoni (Bot API 7.10+) HMAC tekshiruvida odatda qatnashadi; eski mijozlar uchun usiz ham sinab ko'ramiz
  const ok =
    sameHex(hmac(secret, checkString([...entries])).toString("hex"), hash) ||
    (params.has("signature") && sameHex(hmac(secret, checkString(entries.filter(([k]) => k !== "signature"))).toString("hex"), hash));
  if (!ok) return { error: "Telegram imzosi to'g'ri emas" };
  if (!fresh(params.get("auth_date"), Math.floor(now / 1000), maxAgeS)) return { error: "Kirish muddati o'tgan — ilovani qayta oching" };
  let raw = null;
  try {
    raw = JSON.parse(params.get("user") ?? "null");
  } catch {
    raw = null;
  }
  const user = userFrom(raw);
  return user ? { user } : { error: "Foydalanuvchi ma'lumoti yo'q" };
}

const WIDGET_FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"];

// Sayt: «Telegram bilan kirish» vidjeti maydonlari → { user } yoki { error }
export function verifyLoginWidget(data, botToken, { now = Date.now(), maxAgeS = AUTH_MAX_AGE_S } = {}) {
  if (!data || typeof data !== "object") return { error: "Telegram ma'lumoti kelmadi" };
  const entries = Object.entries(data).filter(([k, v]) => k !== "hash" && WIDGET_FIELDS.includes(k) && v != null && v !== "");
  const secret = createHash("sha256").update(botToken).digest();
  if (!sameHex(hmac(secret, checkString(entries.map(([k, v]) => [k, String(v)]))).toString("hex"), data.hash)) {
    return { error: "Telegram imzosi to'g'ri emas" };
  }
  if (!fresh(data.auth_date, Math.floor(now / 1000), maxAgeS)) return { error: "Kirish muddati o'tgan — qayta kiring" };
  const user = userFrom(data);
  return user ? { user } : { error: "Foydalanuvchi ma'lumoti yo'q" };
}

// Sessiya tokeni — @yuk/store sessions.js (bot ham pastki menyu tugmasi uchun shu bilan token yaratadi)
export { createSessions, SESSION_TTL_S } from "@yuk/store";

// Testlar uchun: Telegram qanday imzolasa, xuddi shunday imzolangan initData / vidjet ma'lumoti
export function signWebAppData(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
  const hash = hmac(hmac("WebAppData", botToken), checkString([...entries])).toString("hex");
  return new URLSearchParams([...entries, ["hash", hash]]).toString();
}

export function signLoginWidget(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [k, String(v)]);
  const hash = hmac(createHash("sha256").update(botToken).digest(), checkString([...entries])).toString("hex");
  return { ...fields, hash };
}
