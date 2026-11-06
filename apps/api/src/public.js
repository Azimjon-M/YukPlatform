// Haydovchilar uchun ochiq server: web sayt va Telegram Mini App shu yerdan ochiladi va ma'lumot oladi.
// Boshqaruv markazidan (app.js) ALOHIDA: boshqa port (PUBLIC_PORT, standart 3001), faqat haydovchiga kerakli narsalar,
// har bir so'rov Telegram orqali kirgan haydovchi nomidan. Internetga tunnel orqali chiqariladi (README),
// boshqaruv markazi esa hech qachon chiqarilmaydi.
//
//   GET  /pub/config           bot username (saytdagi «Telegram bilan kirish» uchun), yo'nalish doirasi
//   POST /pub/auth             { initData } (Mini App) yoki { widget } (sayt) → { token, me }
//   GET  /pub/me               foydalanuvchi: ism, rol, obuna, admin, profil, faolmi
//   PUT  /pub/me/role          { role } — haydovchi | yuk_beruvchi (boshqa rolga o'tsa, eski sozlamalar o'chadi)
//   PUT  /pub/me/profile       { profile, role? } — sozlamalarni saqlash (bot ham shu qoidalar bilan tekshiradi)
//   PATCH /pub/me              { active } — pauza / davom
//   GET  /pub/loads            ?view=mine|all&from&to&hours&limit&offset — yuklar (haydovchiga), eng yangisi birinchi
//   GET  /pub/trucks           xuddi shunday — bo'sh mashinalar (yuk beruvchiga)
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { KIND_MATCHERS, KIND_ROLE, isAdmin, parseAdminIds, roleOf, routeInScope, sameArea, sanitizeProfileFor, validRole } from "@yuk/shared";
import { verifyLoginWidget, verifyWebAppData } from "./telegramAuth.js";

const HOUR = 60 * 60 * 1000;
export const MAX_HOURS = 72;
const MAX_LIMIT = 500;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Oddiy cheklov: bitta manzildan oynada (standart 1 daqiqa) ko'pi bilan `limit` ta so'rov
export function createRateLimiter({ limit, windowMs = 60_000, now = () => Date.now() }) {
  const hits = new Map();
  return (key) => {
    const time = now();
    const entry = hits.get(key);
    if (!entry || time - entry.start >= windowMs) {
      if (hits.size > 10_000) for (const [k, e] of hits) if (time - e.start >= windowMs) hits.delete(k);
      hits.set(key, { start: time, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

// Tunnel orqali kelgan so'rovda haqiqiy manzil sarlavhada (Cloudflare — cf-connecting-ip, ngrok — x-forwarded-for).
// Server faqat 127.0.0.1 da tinglaydi, shuning uchun bu sarlavhalarni faqat tunnel qo'yadi.
const clientIp = (req) =>
  req.get("cf-connecting-ip") || req.get("x-forwarded-for")?.split(",")[0].trim() || req.socket.remoteAddress || "?";

// Sozlamalar to'ldirilmagan bo'lsa nima deymiz (rolga qarab)
const NEED_PROFILE = {
  haydovchi: "Avval sozlamalarda mashina va yo'nalishni kiriting",
  yuk_beruvchi: "Avval sozlamalarda yo'nalishingizni kiriting",
};
const NEED_ROLE = "Avval kim ekaningizni tanlang: haydovchi yoki yuk beruvchi";

// Joy filtri: area — viloyat kodi (Toshkent shahri = viloyati) yoki davlat nomi
function atArea(load, side, area) {
  if (!area) return true;
  return sameArea(area, load[`${side}Region`]) || load[`${side}Country`] === area;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null);

// scope — yo'nalish doirasi (.env dagi ROUTE_SCOPE): undan tashqaridagi eski yuklar ko'rsatilmaydi
export function createPublicApp({ store, env = process.env, sessions, scope, webDist = null, now = () => Date.now() }) {
  const app = express();
  app.disable("x-powered-by");
  const botToken = env.BOT_TOKEN?.trim() || null;
  const limitAll = createRateLimiter({ limit: 240, now });
  const limitAuth = createRateLimiter({ limit: 20, now });
  const adminIds = parseAdminIds(env.ADMIN_IDS);

  // Web'ga ketadigan foydalanuvchi ma'lumoti. role — rollardan oldingi yozuvda ham (profil bor → haydovchi)
  const meOf = (driver) => ({
    chatId: driver.chatId,
    name: driver.name,
    username: driver.username,
    role: roleOf(driver),
    plan: driver.plan ?? "free",
    isAdmin: isAdmin(driver, adminIds),
    profile: driver.profile,
    active: driver.active,
  });

  const pub = express.Router();
  pub.use((req, res, next) => {
    // CORS: kirish Bearer token bilan (cookie yo'q), shuning uchun boshqa saytdan so'rovga ruxsat berish xavfsiz —
    // tokenni bilmagan sayt hech narsa ololmaydi. Mini App Cloudflare Pages'da, API esa tunnelda bo'lishi mumkin.
    res.set({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, ngrok-skip-browser-warning",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
      "access-control-max-age": "600",
      "cache-control": "no-store",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    if (!limitAll(clientIp(req))) return next(httpError(429, "Juda ko'p so'rov — bir daqiqadan keyin qayta urinib ko'ring"));
    next();
  });
  pub.use(express.json({ limit: "20kb" }));

  pub.get("/health", (req, res) => res.json({ ok: true }));

  // Bot o'z username'ini bazaga yozadi (bot.js init) — sayt «Telegram bilan kirish» tugmasini shu bilan chizadi
  pub.get("/config", (req, res) => {
    res.json({ botUsername: store.getSetting("bot_username") ?? env.BOT_USERNAME ?? null, scope, login: Boolean(botToken) });
  });

  pub.post("/auth", (req, res) => {
    if (!limitAuth(clientIp(req))) throw httpError(429, "Juda ko'p urinish — bir daqiqadan keyin qayta urinib ko'ring");
    if (!botToken) throw httpError(503, "Server sozlanmagan: .env da BOT_TOKEN yo'q");
    const body = req.body ?? {};
    const options = { now: now() };
    const result = body.initData
      ? verifyWebAppData(body.initData, botToken, options)
      : body.widget
        ? verifyLoginWidget(body.widget, botToken, options)
        : { error: "Telegram ma'lumoti kelmadi" };
    if (result.error) throw httpError(401, result.error, "auth");
    const { id, name, username } = result.user;
    const driver = store.saveDriver(id, { name, username });
    res.json({ token: sessions.issue(id), me: meOf(driver) });
  });

  // Bundan keyingi hamma yo'l — faqat kirgan haydovchi uchun: "Authorization: Bearer <token>"
  pub.use((req, res, next) => {
    const uid = sessions.verify((req.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const driver = uid ? store.getDriver(uid) : null;
    if (!driver) return next(httpError(401, "Kirish kerak", "auth"));
    req.driver = driver;
    next();
  });

  pub.get("/me", (req, res) => res.json(meOf(req.driver)));

  // Rol: botdagi /rol bilan bir xil — boshqa rolga o'tsa, eski sozlamalar o'chadi (haydovchi profili yuk beruvchiga to'g'ri kelmaydi)
  pub.put("/me/role", (req, res) => {
    const role = validRole(req.body?.role);
    if (!role) throw httpError(400, "role: haydovchi yoki yuk_beruvchi bo'lishi kerak");
    if (roleOf(req.driver) === role) return res.json(meOf(req.driver));
    res.json(meOf(store.saveDriver(req.driver.chatId, { role, profile: null, draft: null, active: true })));
  });

  // Botdagi «Saqlash» bilan bir xil: profil rolga qarab tekshiriladi, saqlanadi va yuborish yoqiladi.
  // role kelmasa — bazadagi rol
  pub.put("/me/profile", (req, res) => {
    const role = validRole(req.body?.role) ?? roleOf(req.driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    const result = sanitizeProfileFor(role, req.body?.profile, { scope });
    if (result.error) throw httpError(400, result.error);
    res.json(meOf(store.saveDriver(req.driver.chatId, { role, profile: result.profile, draft: null, active: true })));
  });

  pub.patch("/me", (req, res) => {
    const active = req.body?.active;
    if (typeof active !== "boolean") throw httpError(400, "active: true yoki false bo'lishi kerak");
    const role = roleOf(req.driver);
    if (active && !role) throw httpError(409, NEED_ROLE, "no_role");
    if (active && !req.driver.profile) throw httpError(409, NEED_PROFILE[role], "no_profile");
    res.json(meOf(store.saveDriver(req.driver.chatId, { active })));
  });

  // kind "yuk" — yuklar (haydovchiga), "mashina" — bo'sh mashinalar (yuk beruvchiga).
  // view=mine — shu foydalanuvchiga mos (bot yuboradiganlari), view=all — hammasi
  const listing = (kind) => (req, res) => {
    const view = req.query.view === "all" ? "all" : "mine";
    const hours = clamp(Number(req.query.hours) || 24, 1, MAX_HOURS);
    const limit = clamp(Number(req.query.limit) || 30, 1, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = text(req.query.from);
    const to = text(req.query.to);
    const { profile } = req.driver;
    const role = roleOf(req.driver);
    if (view === "mine") {
      if (!role) throw httpError(409, NEED_ROLE, "no_role");
      if (role !== KIND_ROLE[kind]) {
        throw httpError(409, kind === "yuk" ? "«Menga mos» yuklar — haydovchilar uchun" : "«Menga mos» mashinalar — yuk beruvchilar uchun", "role");
      }
      if (!profile) throw httpError(409, NEED_PROFILE[role], "no_profile");
    }
    const matches = KIND_MATCHERS[kind];

    const rows = store
      .recentLoads({ sinceMs: hours * HOUR, limit: 5000, kind })
      .filter(({ load }) => routeInScope(load, scope) && atArea(load, "from", from) && atArea(load, "to", to))
      .filter(({ load }) => view === "all" || matches(load, profile).ok)
      // E'lon guruhda chiqqan vaqt bo'yicha: bot navbatdagi eng yangi e'lonni birinchi oladi,
      // shuning uchun bazadagi tartib (id) e'lon vaqti bilan har doim ham bir xil emas
      .sort((a, b) => b.post.postedAt - a.post.postedAt || b.id - a.id);
    res.json({
      view,
      hours,
      total: rows.length,
      items: rows.slice(offset, offset + limit).map(({ id, load, post, createdAt }) => ({ id, load, post, createdAt })),
    });
  };
  pub.get("/loads", listing("yuk"));
  pub.get("/trucks", listing("mashina"));

  pub.use((req, res, next) => next(httpError(404, "Topilmadi")));
  app.use("/pub", pub);

  // Web ilovaning o'zi (npm run web:build → apps/web/dist): shu server orqali http://localhost:3001
  const index = webDist ? path.join(webDist, "index.html") : null;
  if (index && existsSync(index)) {
    app.use(
      express.static(webDist, {
        index: false,
        // assets/ dagi fayl nomida xesh bor — uzoq saqlanadi; index.html har safar yangidan
        setHeaders: (res, file) => res.set("cache-control", file.endsWith(".html") ? "no-cache" : "public, max-age=604800, immutable"),
      }),
    );
    app.get(/^\/(?!pub(\/|$)).*/, (req, res) => res.set("cache-control", "no-cache").sendFile(index));
  } else {
    app.get("/", (req, res) => res.status(503).type("text").send("Web hali yig'ilmagan. YukPlatform papkasida: npm start (yoki npm run web:build)"));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    // express.json buzilgan JSON uchun 400 beradi; boshqa kutilmagan xato — 500
    const status = error.status ?? error.statusCode ?? 500;
    if (status >= 500) console.error(error);
    // code — web nima qilishini biladi: auth → qayta kirish, no_profile → sozlamalarga, no_role → rol tanlash
    const code = ["auth", "no_profile", "no_role", "role", "forbidden"].includes(error.code) ? { code: error.code } : {};
    res.status(status).json({ error: status >= 500 ? "Server xatosi" : error.message, ...code });
  });

  return app;
}
