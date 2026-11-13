// Boshqaruv markaziga kirish: LOGIN + PAROL va sessiya cookie'si (Azimjon, 2026-11-11: «Web uchun Login saxifa
// qilsang!» va keyin «login saxifa faqat parol so'raydigan bo'libdi… username va parolli bo'lishligi kerak»).
//
// Nega kerak? Dashboard internetga chiqdi (nginx :80 + tunnel). Avval parol nginx'ning «auth_basic» oynasida edi —
// endi loyihaning o'z kirish sahifasi bor: brauzerga chiroyli forma chiqadi, parol bazada hisoblab saqlanadi,
// kirgandan keyin httpOnly cookie sessiya bo'ladi (nginx qatlamiga hech narsa bog'lanmaydi).
//
// Parol qayerda: settings.admin_pass_hash — scrypt (salt + 64 bayt), parolning o'zi hech qachon saqlanmaydi.
// Login qayerda: settings.admin_user. Qo'yilmagan bo'lsa — standapt «admin». .env dagi ADMIN_LOGIN birinchi marta
// qo'yiladi (panel orqali o'zgartirilgan loginni .env keyin bosib keta olmaydi — xuddi paroldagidek).
// Parolni birinchi marta qo'yish: sozlash sahifasidan yoki .env dagi ADMIN_PASS orqali. Qaysi usul qo'yganini
// settings.admin_pass_source yozib qo'yadi: «env» bo'lsa — .env o'zgarsa parol ham yangilanadi, «manual» bo'lsa —
// .env parolni bosib keta olmaydi (panel orqali qo'yilgan parol buzilmaydi).
//
// Sessiya tokeni: data/secret.key bilan imzolangan, ichida login va tugash vaqti bor. Server qayta yoqilsa ham
// parol so'ralmaydi (token imzosi hali ham to'g'ri), sessiya esa 12 soatda (yoki «Meni eslab qol» — 30 kun) o'zi
// tugaydi. Imzo kaliti web/Mini App tokenlaridan (sessions.js) alohida: bittasi ikkinchisini almashtira olmasin.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // «Meni eslab qol»siz: 12 soat
export const REMEMBER_TTL_MS = 30 * DAY_MS; // «Meni eslab qol»: 30 kun
export const COOKIE_NAME = "yuk_admin";
export const MIN_PASSWORD = 8;
export const DEFAULT_LOGIN = "admin";

// Xato parol urinishlari (har IP uchida): shundan ko'p bo'lsa — vaqtinchalik blok. Xotirada, server
// qayta yoqilsa tozalanadi (bu panel — bitta odam uchun, doimiy blok kerak emas).
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const httpError = (status, message) => Object.assign(new Error(message), { status });

// → "scrypt:<salt>|<hash>" (base64). Parol bazada faqat shu ko'rinishda — o'qib bo'lmaydi.
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("base64")}|${scryptSync(password, salt, 64).toString("base64")}`;
}

// Noma'lum format (eski yoki buzilgan qator) → false. Taqqoslash vaqti bir xil — tayming hujumi uchun.
export function verifyPassword(password, stored) {
  const raw = String(stored ?? "");
  if (!raw.startsWith("scrypt:")) return false;
  const [salt, hash, extra] = raw.slice("scrypt:".length).split("|");
  if (!salt || !hash || extra !== undefined) return false;
  try {
    const got = scryptSync(password, Buffer.from(salt, "base64"), 64);
    const want = Buffer.from(hash, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// Login (foydalanuvchi nomi) — maydonga kiritiladigan oddiy yozuv. Kichitiriladi (bir xil nom ikki xil yozilmasin),
// taqiqlangan belgilar olib tashlanadi. Uzunlik — 3..40 belgi.
export function normalizeLogin(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (text.length < 3) throw httpError(400, "Login kamida 3 belgi bo'lishi kerak");
  if (text.length > 40) throw httpError(400, "Login juda uzun (40 belgigacha)");
  if (!/^[a-z0-9_.@-]+$/.test(text)) throw httpError(400, "Login faqat harf, raqam, nuqta, tire va _ dan iborat bo'lsin");
  return text;
}

// Yangi parol talabi: uzunligi va ikki marta bir xil yozilganini tekshirish (forma xatolari — o'zbekcha)
export function checkNewPassword(password, repeat) {
  const value = typeof password === "string" ? password : "";
  if (value.length < MIN_PASSWORD) throw httpError(400, `Parol kamida ${MIN_PASSWORD} belgi bo'lishi kerak`);
  if (value.length > 200) throw httpError(400, "Parol juda uzun (200 belgigacha)");
  if (repeat !== undefined && repeat !== value) throw httpError(400, "Parol ikki marta bir xil yozilmadi");
  return value;
}

// Cookie sarlavhasini ajratib o'qish: Express'da cookie qo'shimchasi yo'q (bz bilan shug'ullanmaymiz),
// shuning uchun bitta qatorni o'zimiz tahlil qilamiz. Qiymatlarda «;» bo'lmaydi (base64url token).
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const [name, ...rest] = part.split("=");
    const value = rest.join("=");
    if (name && value) out[name.trim()] = decodeURIComponent(value.trim());
  }
  return out;
}

// req → token: «Authorization: Bearer …» (curl, test) yoki yuk_admin cookie'si (brauzer)
export function requestToken(req, cookieName = COOKIE_NAME) {
  const header = req.get("authorization") ?? "";
  if (/^Bearer\s+\S+$/i.test(header)) return header.slice(7).trim();
  return parseCookies(req.get("cookie"))[cookieName] ?? null;
}

// Man ko'rinadigan so'rovning kaliti (rate limit uchun); tunnel va nginx orqasida haqiqiy IP keladi
function clientKey(req) {
  const forwarded = String(req.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "?";
}

// store — @yuk/store (settings jadvali), secret — data/secret.key buffet (32 bayt).
// Berilmasa (test, eski qo'shimcha serverlar) — kirish o'chib qoladi: createApp o'z himoyasicha qoladi.
export function createAdminAuth({
  store,
  secret,
  env = process.env,
  now = Date.now,
  ttlMs = SESSION_TTL_MS,
  rememberMs = REMEMBER_TTL_MS,
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS,
}) {
  if (!secret) return { enabled: false };
  const key = hmac(secret, "yuk-admin-session-v1");

  const sign = (body) => b64url(hmac(key, body));
  // → token; ichida login («kim»), tugash vaqti (sekundlarda) va «eslab qolinganmi» belgisi
  const issue = (ttl, login) => {
    const body = b64url(JSON.stringify({ u: login, exp: Math.floor((now() + ttl) / 1000), r: ttl > ttlMs ? 1 : 0 }));
    return { token: `${body}.${sign(body)}`, expiresAt: now() + ttl };
  };

  const attempts = new Map(); // ip → { count, resetAt }
  function gate(ip) {
    const at = attempts.get(ip);
    if (!at || at.resetAt <= now()) return { blocked: false, retryAfterSec: 0 };
    if (at.count >= maxAttempts) return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((at.resetAt - now()) / 1000)) };
    return { blocked: false, retryAfterSec: 0 };
  }
  function badAttempt(ip) {
    const at = attempts.get(ip);
    if (!at || at.resetAt <= now()) attempts.set(ip, { count: 1, resetAt: now() + windowMs });
    else at.count += 1;
  }

  const stored = () => store.getSetting("admin_pass_hash");
  const source = () => store.getSetting("admin_pass_source") ?? null;
  // Login bazada qo'yilmagan bo'lsa — «admin» (eski o'rnatishlar ishlab tursin)
  const user = () => store.getSetting("admin_user") || DEFAULT_LOGIN;
  const userSource = () => store.getSetting("admin_user_source") ?? null;

  const api = {
    enabled: true,
    cookieName: COOKIE_NAME,

    // { configured, source } — sahifaga «parol qo'yilmagan» holatini ko'rsatish uchun.
    // Login bu javobda QASDAN yo'q: sahifani ochgan har qanday odam uni bilib qo'ymasligi kerak
    // (ikirchi qo'l — shu nom). Kirgandan keyin /api/session uni qaytaradi («login»).
    status() {
      // envLogin — faqat hisob HALI qo'yilmagan payt (birinchi ishga tushirish): sahifa maydoniga
      // .env'dagi ADMIN_LOGIN'ni oldindan qo'yish uchun. Hisob qo'yilgach login yana ko'rinmaydi.
      const seeded = store.getSetting("admin_user") || (typeof env.ADMIN_LOGIN === "string" ? env.ADMIN_LOGIN.trim() : "");
      return { configured: Boolean(stored()), source: source(), envLogin: stored() || !seeded ? null : seeded };
    },

    // Kirgan holatda ko'rsatiladigan hozirgi login
    currentLogin: () => user(),

    // .env dagi ADMIN_LOGIN: bazada login bo'lmasa — birinchi login shundan. Panel orqali o'zgartirilgan
    // login'ni («manual») .env keyin bosib keta olmaydi.
    syncLoginFromEnv() {
      const from = typeof env.ADMIN_LOGIN === "string" && env.ADMIN_LOGIN.trim() !== "" ? env.ADMIN_LOGIN.trim() : null;
      if (!from) return false;
      if (userSource() === "manual") return false;
      let value;
      try {
        value = normalizeLogin(from);
      } catch {
        return false; // .env'dagi login yaroqsiz — parolni buzmaymiz, o'z holida qoladi
      }
      if (value === user()) return false;
      store.setSetting("admin_user", value);
      store.setSetting("admin_user_source", "env");
      store.setSetting("admin_user_set_at", String(now()));
      return true;
    },

    // Login va parolni almashtirish (kirgan holatda, eski parol tasdiqlanadi). Login berilmasa — o'zgarmaydi.
    account({ login, oldPassword, password, repeat, ip = "?" } = {}) {
      const limit = gate(ip);
      if (limit.blocked) return { error: `Juda ko'p urinish. ${limit.retryAfterSec} soniyadan keyin qayta urinib ko'ring`, retryAfterSec: limit.retryAfterSec, status: 429 };
      if (!verifyPassword(String(oldPassword ?? ""), stored())) {
        badAttempt(ip);
        return { error: "Eski parol noto'g'ri", status: 401 };
      }
      let nextLogin = null;
      if (login !== undefined && login !== null && String(login).trim() !== "") {
        try {
          nextLogin = normalizeLogin(login);
        } catch (error) {
          return { error: error.message, status: 400 };
        }
      }
      let value = null;
      if (password !== undefined && password !== null && String(password) !== "") {
        try {
          value = checkNewPassword(password, repeat);
        } catch (error) {
          return { error: error.message, status: 400 };
        }
      }
      if (!nextLogin && !value) return { error: "Login yoki parol kiriting", status: 400 };
      if (nextLogin) {
        store.setSetting("admin_user", nextLogin);
        store.setSetting("admin_user_source", "manual");
        store.setSetting("admin_user_set_at", String(now()));
      }
      if (value) {
        store.setSetting("admin_pass_hash", hashPassword(value));
        store.setSetting("admin_pass_source", "manual");
        store.setSetting("admin_pass_set_at", String(now()));
      }
      attempts.delete(ip);
      return { ok: true, login: user() };
    },

    // .env dagi ADMIN_PASS: bazada hisob bo'lmasa — birinchi parol shundan; «env» hisobi bo'lsa — yangilanadi.
    // «manual» (paneldan qo'yilgan) parolni .env HECH QACHON bosib keta olmaydi.
    syncFromEnv() {
      api.syncLoginFromEnv();
      const from = typeof env.ADMIN_PASS === "string" && env.ADMIN_PASS.trim() !== "" ? env.ADMIN_PASS.trim() : null;
      if (!from) return { changed: false, configured: Boolean(stored()) };
      if (!stored()) {
        store.setSetting("admin_pass_hash", hashPassword(from));
        store.setSetting("admin_pass_source", "env");
        store.setSetting("admin_pass_set_at", String(now()));
        return { changed: true, configured: true };
      }
      if (source() === "env" && !verifyPassword(from, stored())) {
        store.setSetting("admin_pass_hash", hashPassword(from));
        store.setSetting("admin_pass_set_at", String(now()));
        return { changed: true, configured: true };
      }
      return { changed: false, configured: true };
    },

    // Token to'g'rimi (buzilmagan, shu serverning imzosi, muddati o'tmagan) → { user, expiresAt } yoki null.
    // Eski tokenlarda «u» yo'q — ular ham ishlayveradi (parol so'ralmasligi uchun), user: null qoladi.
    verify(token) {
      if (typeof token !== "string" || token.length > 512) return null;
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined) return null;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const { exp, u } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!Number.isSafeInteger(exp) || !(exp > now() / 1000)) return null;
        return { user: typeof u === "string" ? u : null, expiresAt: exp * 1000 };
      } catch {
        return null;
      }
    },

    // Login + parolni tekshirib, yangi sessiya tokenini beradi. Xato → { error } (401), urinishlar tugasa → { error } (429).
    // Login ham parol kabi «urinish» hisoblanadi — xato login ham blokka olib boradi.
    login({ username, login, password, remember = false, ip = "?" } = {}) {
      if (!stored()) throw httpError(503, "Parol hali qo'yilmagan — sahifani yangilang va birinchi parolni kiriting");
      const limit = gate(ip);
      if (limit.blocked) return { error: `Juda ko'p urinish — ${limit.retryAfterSec} soniyadan keyin qayta urinib ko'ring`, retryAfterSec: limit.retryAfterSec, status: 429 };
      const given = String(username ?? login ?? "").trim().toLowerCase();
      if (!given) return { error: "Loginni kiriting", status: 400 };
      if (typeof password !== "string" || password === "") return { error: "Parolni kiriting", status: 400 };
      // Ikkalasi bir tekshiruvdan o'tadi: xato login ham «login yoki parol noto'g'ri» deyiladi —
      // shunda kimdir «bu login bormi?»deb sinab ko'ra olmaydi
      if (given !== user() || !verifyPassword(password, stored())) {
        badAttempt(ip);
        const after = gate(ip);
        return after.blocked
          ? { error: `Login yoki parol noto'g'ri. Keyingi ${after.retryAfterSec} soniya ichida urinishlar to'xtadi`, retryAfterSec: after.retryAfterSec, status: 429 }
          : { error: "Login yoki parol noto'g'ri", status: 401 };
      }
      attempts.delete(ip);
      return { ...issue(remember ? rememberMs : ttlMs, given), remember: Boolean(remember) };
    },

    // Parol hali qo'yilmagan payt (birinchi ishga tushirish): birinchi login va parolini o'zi qo'yadi. So'ng bormaydi.
    setup({ username, login, password, repeat, ip = "?" } = {}) {
      if (stored()) throw httpError(409, "Parol allaqachon qo'yilgan — uni almashtirish uchun eski parolni kiriting");
      const value = checkNewPassword(password, repeat);
      let nextLogin = user();
      const givenName = String(username ?? login ?? "").trim();
      if (givenName !== "") {
        try {
          nextLogin = normalizeLogin(givenName);
        } catch (error) {
          return { error: error.message, status: 400 };
        }
      }
      store.setSetting("admin_user", nextLogin);
      store.setSetting("admin_user_source", "manual");
      store.setSetting("admin_user_set_at", String(now()));
      store.setSetting("admin_pass_hash", hashPassword(value));
      store.setSetting("admin_pass_source", "manual");
      store.setSetting("admin_pass_set_at", String(now()));
      return { ...issue(rememberMs, nextLogin), remember: true };
    },

    // Parolni almashtirish: eski parol tasdiqlanadi (sessiya bo'lmasa ham — bilgan odam almashtira oladi)
    change({ oldPassword, password, repeat, ip = "?" } = {}) {
      if (!stored()) throw httpError(503, "Parol hali qo'yilmagan");
      const limit = gate(ip);
      if (limit.blocked) return { error: `Juda ko'p urinish. ${limit.retryAfterSec} soniyadan keyin qayta urinib ko'ring`, retryAfterSec: limit.retryAfterSec, status: 429 };
      if (!verifyPassword(String(oldPassword ?? ""), stored())) {
        badAttempt(ip);
        return { error: "Eski parol noto'g'ri", status: 401 };
      }
      const value = checkNewPassword(password, repeat);
      store.setSetting("admin_pass_hash", hashPassword(value));
      store.setSetting("admin_pass_source", "manual");
      store.setSetting("admin_pass_set_at", String(now()));
      attempts.delete(ip);
      return { ok: true };
    },
  };
  return api;
}
