// Haydovchilar uchun ochiq server: web sayt va Telegram Mini App shu yerdan ochiladi va ma'lumot oladi.
// Boshqaruv markazidan (app.js) ALOHIDA: boshqa port (PUBLIC_PORT, standart 3001), faqat haydovchiga kerakli narsalar,
// har bir so'rov Telegram orqali kirgan haydovchi nomidan. Internetga tunnel orqali chiqariladi (README),
// boshqaruv markazi esa hech qachon chiqarilmaydi.
//
//   GET  /pub/config           bot username (saytdagi «Telegram bilan kirish» uchun), yo'nalish doirasi
//   POST /pub/auth             { initData } (Mini App) yoki { widget } (sayt) → { token, me }
//   GET  /pub/me               haydovchi: ism, profil, faolmi
//   PUT  /pub/me/profile       { profile } — sozlamalarni saqlash (bot ham shu qoidalar bilan tekshiradi)
//   PATCH /pub/me              { active } — pauza / davom
//   GET  /pub/loads            ?view=mine|all&from&to&hours&limit&offset — yuklar, eng yangisi birinchi
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { matchLoad, routeInScope, sameArea, sanitizeProfile } from "@yuk/shared";
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

const meOf = (driver) => ({
  chatId: driver.chatId,
  name: driver.name,
  username: driver.username,
  profile: driver.profile,
  active: driver.active,
});

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

  // Botdagi «Saqlash» bilan bir xil: profil tekshiriladi, saqlanadi va yuk yuborish yoqiladi
  pub.put("/me/profile", (req, res) => {
    const result = sanitizeProfile(req.body?.profile, { scope });
    if (result.error) throw httpError(400, result.error);
    res.json(meOf(store.saveDriver(req.driver.chatId, { profile: result.profile, draft: null, active: true })));
  });

  pub.patch("/me", (req, res) => {
    const active = req.body?.active;
    if (typeof active !== "boolean") throw httpError(400, "active: true yoki false bo'lishi kerak");
    if (active && !req.driver.profile) throw httpError(409, "Avval sozlamalarda mashina va yo'nalishni kiriting", "no_profile");
    res.json(meOf(store.saveDriver(req.driver.chatId, { active })));
  });

  // view=mine — haydovchining mashinasi va yo'nalishiga mos (bot yuboradiganlari), view=all — hammasi
  pub.get("/loads", (req, res) => {
    const view = req.query.view === "all" ? "all" : "mine";
    const hours = clamp(Number(req.query.hours) || 24, 1, MAX_HOURS);
    const limit = clamp(Number(req.query.limit) || 30, 1, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = text(req.query.from);
    const to = text(req.query.to);
    const { profile } = req.driver;
    if (view === "mine" && !profile) throw httpError(409, "Avval sozlamalarda mashina va yo'nalishni kiriting", "no_profile");

    const rows = store
      .recentLoads({ sinceMs: hours * HOUR, limit: 5000 })
      .filter(({ load }) => routeInScope(load, scope) && atArea(load, "from", from) && atArea(load, "to", to))
      .filter(({ load }) => view === "all" || matchLoad(load, profile).ok)
      // E'lon guruhda chiqqan vaqt bo'yicha: bot navbatdagi eng yangi e'lonni birinchi oladi,
      // shuning uchun bazadagi tartib (id) e'lon vaqti bilan har doim ham bir xil emas
      .sort((a, b) => b.post.postedAt - a.post.postedAt || b.id - a.id);
    res.json({
      view,
      hours,
      total: rows.length,
      items: rows.slice(offset, offset + limit).map(({ id, load, post, createdAt }) => ({ id, load, post, createdAt })),
    });
  });

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
    // code — web nima qilishini biladi: auth → qayta kirish, no_profile → sozlamalarga
    const code = ["auth", "no_profile"].includes(error.code) ? { code: error.code } : {};
    res.status(status).json({ error: status >= 500 ? "Server xatosi" : error.message, ...code });
  });

  return app;
}
