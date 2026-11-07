// Web ilova (Mini App va sayt) uchun kirish tokeni — server (apps/api) ham, bot ham shu kod bilan ishlaydi.
//
//   "<base64url(JSON {uid, exp})>.<base64url(HMAC_SHA256(sessiya kaliti, birinchi qism))>"
//
// Kalit data/secret.key dan hosil qilinadi (loadSecret) — bot va server bir xil kalitni o'qiydi, shuning uchun bot
// yaratgan tokenni server taniydi. Kim ekanini faqat imzo tasdiqlaydi: tokenni bilmagan odam uid'ni o'zgartira olmaydi.
//
// Nega bot ham token yaratadi? Telegram pastki menyu (reply keyboard) tugmasidan ochilgan Mini App'ga foydalanuvchi
// ma'lumotini (initData) BERMAYDI — u bo'sh keladi (core.telegram.org/bots/webapps: "empty if the Mini App was launched
// from a keyboard button"). Bot esa chatda kim bilan gaplashayotganini biladi: tugma manziliga shu odamning tokenini
// (?t=) qo'shib qo'yadi va ilova uni o'qib, kiradi. Tugma faqat shu odamning shaxsiy chatida ko'rinadi.
import { createHmac, timingSafeEqual } from "node:crypto";

const DAY_S = 24 * 60 * 60;
export const SESSION_TTL_S = 30 * DAY_S;
// Menyu tugmasidagi token: bir hafta davomida BIR XIL (bot menyuni har xabarda qayta yubormasligi uchun),
// keyin yangisi. Amal qilish muddati 28–35 kun: hafta oxiri + 4 hafta.
export const LINK_PERIOD_S = 7 * DAY_S;
const LINK_PERIODS = 5;

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

// secret — data/secret.key (32 bayt). Undan alohida kalit hosil qilinadi: AI kalitlarini shifrlash kaliti bilan aralashmasin.
export function createSessions(secret, { now = () => Date.now(), ttlS = SESSION_TTL_S } = {}) {
  if (!secret) throw new Error("Sessiya uchun data/secret.key kerak");
  const key = hmac(secret, "yuk-web-session-v1");
  const sign = (body) => b64url(hmac(key, body));
  const make = (uid, exp) => {
    const body = b64url(JSON.stringify({ uid, exp }));
    return `${body}.${sign(body)}`;
  };
  return {
    // → token (matn); ttl — soniya. Har chaqirilganda boshqacha (muddati hozirdan hisoblanadi)
    issue(uid, { ttl = ttlS } = {}) {
      return make(uid, Math.floor(now() / 1000) + ttl);
    },
    // Bot menyusidagi Mini App tugmasi uchun: bir hafta ichida bir xil token (muddati hafta chegarasiga tekislangan)
    link(uid) {
      const week = Math.floor(now() / 1000 / LINK_PERIOD_S);
      return make(uid, (week + LINK_PERIODS) * LINK_PERIOD_S);
    },
    // → uid yoki null (buzilgan, boshqa kalit bilan imzolangan yoki muddati o'tgan)
    verify(token) {
      if (typeof token !== "string" || token.length > 512) return null;
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined) return null;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const { uid, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!Number.isSafeInteger(uid) || !(exp > now() / 1000)) return null;
        return uid;
      } catch {
        return null;
      }
    },
  };
}
