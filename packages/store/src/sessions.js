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
  // sid — ilova qurilmasi uchun tasodifiy belgi: bir soniyada ikki qurilmaga berilgan token ham har xil bo'lsin
  const make = (uid, exp, sid) => {
    const body = b64url(JSON.stringify(sid ? { uid, exp, sid } : { uid, exp }));
    return `${body}.${sign(body)}`;
  };
  return {
    // → token (matn); ttl — soniya. Har chaqirilganda boshqacha (muddati hozirdan hisoblanadi)
    issue(uid, { ttl = ttlS, sid = null } = {}) {
      return make(uid, Math.floor(now() / 1000) + ttl, sid);
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

// «📞 Telefon qilish» tugmasi uchun havola (2026-11-09). Telegram tugmasiga tel: qo'yib bo'lmaydi (faqat http(s):// va
// tg://), shuning uchun tugma bizning sahifamizni ochadi (apps/api public.js: GET /pub/call?c=<token>), sahifa esa raqamni
// telefonning qo'ng'iroq oynasiga uzatadi. Raqamning o'zi manzilda YO'Q: token = «qaysi yuk, nechanchi raqam, kimga
// yuborilgan» + imzo. Imzosiz bo'lsa, birov yuk id'larini birma-bir terib, hamma raqamlarni yig'ib olardi.
//
//   "<yuk id>.<raqam tartibi>.<chat id>.<imzo>" — sonlar 36 lik sanoqda (qisqaroq), imzo 12 bayt (16 belgi)
//
// Muddati yo'q: haydovchi eski yukka ham bir necha kundan keyin qo'ng'iroq qilishi mumkin, raqam esa xabar matnida baribir bor.
export function createCallLinks(secret) {
  if (!secret) throw new Error("Qo'ng'iroq havolasi uchun data/secret.key kerak");
  const key = hmac(secret, "yuk-call-link-v1"); // sessiya kalitidan boshqa: bir tokenni ikkinchisi o'rnida ishlatib bo'lmaydi
  const sign = (body) => b64url(hmac(key, body).subarray(0, 12));
  const whole = (n) => Number.isSafeInteger(n) && n >= 0;
  return {
    // → token; loadId — loads jadvalidagi id, phone — load.phones dagi tartib raqami (0 dan), chatId — kimga
    make({ loadId, phone = 0, chatId }) {
      if (!whole(loadId) || !whole(phone) || !Number.isSafeInteger(chatId)) throw new Error("createCallLinks: noto'g'ri son");
      const body = [loadId, phone, chatId].map((n) => n.toString(36)).join(".");
      return `${body}.${sign(body)}`;
    },
    // Tezkor rejimdagi e'lon (2026-11-14): yuk hali yo'q, raqam e'lon matnidan olinadi. "p.<e'lon id>.<raqam>.<chat id>.<imzo>" —
    // imzo "p" bilan birga olinadi, shuning uchun yuk tokeni e'lon tokeni o'rnida (yoki aksincha) ishlamaydi
    makePost({ postId, phone = 0, chatId }) {
      if (!whole(postId) || !whole(phone) || !Number.isSafeInteger(chatId)) throw new Error("createCallLinks: noto'g'ri son");
      const body = ["p", ...[postId, phone, chatId].map((n) => n.toString(36))].join(".");
      return `${body}.${sign(body)}`;
    },
    // → { loadId, phone, chatId } | { postId, phone, chatId } yoki null (buzilgan yoki boshqa kalit bilan imzolangan)
    read(token) {
      if (typeof token !== "string" || token.length > 100) return null;
      const parts = token.split(".");
      if (parts.length === 5 && parts[0] === "p") {
        const body = parts.slice(0, 4).join(".");
        const expected = Buffer.from(sign(body));
        const given = Buffer.from(parts[4]);
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
        const [postId, phone, chatId] = parts.slice(1, 4).map((part) => (/^-?[0-9a-z]+$/.test(part) ? parseInt(part, 36) : NaN));
        if (!whole(postId) || !whole(phone) || !Number.isSafeInteger(chatId)) return null;
        return { postId, phone, chatId };
      }
      if (parts.length !== 4) return null;
      const body = parts.slice(0, 3).join(".");
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(parts[3]);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      const [loadId, phone, chatId] = parts.slice(0, 3).map((part) => (/^-?[0-9a-z]+$/.test(part) ? parseInt(part, 36) : NaN));
      if (!whole(loadId) || !whole(phone) || !Number.isSafeInteger(chatId)) return null;
      return { loadId, phone, chatId };
    },
  };
}
