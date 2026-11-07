// Haydovchilar uchun ochiq server: web sayt va Telegram Mini App shu yerdan ochiladi va ma'lumot oladi.
// Boshqaruv markazidan (app.js) ALOHIDA: boshqa port (PUBLIC_PORT, standart 3001), faqat haydovchiga kerakli narsalar,
// har bir so'rov Telegram orqali kirgan haydovchi nomidan. Internetga tunnel orqali chiqariladi (README),
// boshqaruv markazi esa hech qachon chiqarilmaydi.
//
//   GET  /pub/config           bot username (saytdagi «Telegram bilan kirish» uchun), yo'nalish doirasi
//   POST /pub/auth             { initData } (Mini App) yoki { widget } (sayt) → { token, me }
//   GET  /pub/me               foydalanuvchi: ism, rol, obuna, admin, profil, faolmi, o'z raqami (ulashgan bo'lsa)
//   PUT  /pub/me/role          { role } — haydovchi | yuk_beruvchi (har rolning sozlamalari saqlanadi, qaytganda tiklanadi)
//   PUT  /pub/me/profile       { profile, role? } — sozlamalarni saqlash (bot ham shu qoidalar bilan tekshiradi)
//   PATCH /pub/me              { active } — pauza / davom
//   POST /pub/me/logout        hisobdan chiqish: rol va sozlamalar yashiriladi, bot yubormaydi (qayta kirsa — tiklanadi)
//   DELETE /pub/me             hisobni o'chirish (botdagi /ochirish → «Hammasini o'chirish» bilan bir xil)
//   GET  /pub/me/route         ?from&hours — haydovchining yo'nalish tanlovi: joylar va har biridagi mos yuklar soni
//                              (from yo'q — «Qayerdan?» qadami, bor — «Qayerga?», "*" = hamma joydan)
//   PUT  /pub/me/route         { from, to } — yo'nalishni saqlash ("*" = istalgan); botdagi «📋 Mos yuklar» bilan bir xil
//   GET  /pub/loads            ?view=mine|all&from&to&hours&limit&offset — yuklar (haydovchiga), eng yangisi birinchi
//   GET  /pub/trucks           xuddi shunday — bo'sh mashinalar (yuk beruvchiga)
//   --- faqat adminlar (Mini App'dagi «🛠 Boshqaruv»), boshqalarga 403 ---
//   GET  /pub/admin/overview   ko'rsatkichlar (navbat, yuklar, foydalanuvchilar) va AI ulanishlari holati
//   GET  /pub/admin/users      ?q&role — foydalanuvchilar ro'yxati
//   PATCH /pub/admin/users/:id { active?, role? } — yoqish / to'xtatish, rolni almashtirish
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { pacificDay } from "@yuk/parser";
import {
  KIND_MATCHERS,
  KIND_ROLE,
  applyRoute,
  isAdmin,
  parseAdminIds,
  roleOf,
  routeCounts,
  routeInScope,
  sameArea,
  sanitizeProfileFor,
  validRole,
  validRouteArea,
  withRoute,
} from "@yuk/shared";
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
  haydovchi: "Avval sozlamalarda transportingizni kiriting",
  yuk_beruvchi: "Avval sozlamalarda yo'nalishingizni kiriting",
};
const NEED_ROLE = "Avval kim ekaningizni tanlang: haydovchi yoki yuk beruvchi";

// Joy filtri: area — viloyat kodi (Toshkent shahri = viloyati) yoki davlat nomi
function atArea(load, side, area) {
  if (!area) return true;
  return sameArea(area, load[`${side}Region`]) || load[`${side}Country`] === area;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null);

// Web'dan hisobdan chiqilganda bot chatiga yoziladigan xabar (pastki menyu ham olib tashlanadi — eski tugmalar eskirdi)
export const SIGNED_OUT_TEXT =
  "🚪 Hisobdan chiqdingiz. Endi bot sizga yuk yubormaydi.\n" +
  "Qaytib kirish — /start: rolingizni tanlasangiz, sozlamalaringiz va yo'nalishingiz tiklanadi.";

// Hisob web'dan o'chirilganda bot chatiga yoziladigan xabar (pastki menyu ham olib tashlanadi)
export const DELETED_TEXT = "✅ Hisobingiz ilovadan o'chirildi: sozlamalar, yo'nalish va telefon raqamingiz. Endi sizga hech narsa yuborilmaydi.\nQaytadan boshlash — /start";

// scope — yo'nalish doirasi (.env dagi ROUTE_SCOPE): undan tashqaridagi eski yuklar ko'rsatilmaydi.
// notify(chatId, text, extra) — bot nomidan xabar (botMessage.js); null — yuborilmaydi (testlarda soxtasi beriladi)
export function createPublicApp({ store, env = process.env, sessions, scope, webDist = null, notify = null, now = () => Date.now() }) {
  const app = express();
  app.disable("x-powered-by");
  const botToken = env.BOT_TOKEN?.trim() || null;
  const limitAll = createRateLimiter({ limit: 240, now });
  const limitAuth = createRateLimiter({ limit: 20, now });
  const adminIds = parseAdminIds(env.ADMIN_IDS);

  // Web'ga ketadigan foydalanuvchi ma'lumoti. role — rollardan oldingi yozuvda ham (profil bor → haydovchi).
  // phone — o'zining raqami (Sozlamalarda «📱 Raqamingiz»). withPhone: false — admin boshqa odamni o'zgartirganda:
  // birovning raqami tunnel orqali chiqmaydi (raqamlar faqat boshqaruv markazida, localhost)
  const meOf = (driver, { withPhone = true } = {}) => ({
    chatId: driver.chatId,
    name: driver.name,
    username: driver.username,
    role: roleOf(driver),
    plan: driver.plan ?? "free",
    isAdmin: isAdmin(driver, adminIds),
    profile: driver.profile,
    active: driver.active,
    ...(withPhone ? { phone: driver.phone ?? null } : {}),
  });

  const pub = express.Router();
  pub.use((req, res, next) => {
    // CORS: kirish Bearer token bilan (cookie yo'q), shuning uchun boshqa saytdan so'rovga ruxsat berish xavfsiz —
    // tokenni bilmagan sayt hech narsa ololmaydi. Mini App Cloudflare Pages'da, API esa tunnelda bo'lishi mumkin.
    res.set({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, ngrok-skip-browser-warning",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

  // Rol: botdagi /rol bilan bir xil. Har rolning sozlamalari alohida saqlanadi (store.switchRole): bu rolda avval
  // to'ldirgan bo'lsa — tiklanadi (javobda profile bor), bo'lmasa profile = null (haydovchi profili yuk beruvchiga to'g'ri kelmaydi)
  pub.put("/me/role", (req, res) => {
    const role = validRole(req.body?.role);
    if (!role) throw httpError(400, "role: haydovchi yoki yuk_beruvchi bo'lishi kerak");
    if (roleOf(req.driver) === role) return res.json(meOf(req.driver));
    res.json(meOf(store.switchRole(req.driver.chatId, role)));
  });

  // Botdagi «Saqlash» bilan bir xil: profil rolga qarab tekshiriladi, saqlanadi va yuborish yoqiladi.
  // role kelmasa — bazadagi rol; boshqa rol kelsa — avval eski rolning sozlamalari saqlab qo'yiladi
  pub.put("/me/profile", (req, res) => {
    const role = validRole(req.body?.role) ?? roleOf(req.driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    const result = sanitizeProfileFor(role, req.body?.profile, { scope });
    if (result.error) throw httpError(400, result.error);
    if (roleOf(req.driver) !== role) store.switchRole(req.driver.chatId, role);
    // Haydovchi formasida yo'nalish yo'q (u botdagi «📋 Mos yuklar» da tanlanadi) — eskisi qoladi
    const before = store.getDriver(req.driver.chatId)?.profile;
    const profile = role === "haydovchi" ? withRoute(result.profile, before) : result.profile;
    res.json(meOf(store.saveDriver(req.driver.chatId, { role, profile, draft: null, active: true })));
  });

  pub.patch("/me", (req, res) => {
    const active = req.body?.active;
    if (typeof active !== "boolean") throw httpError(400, "active: true yoki false bo'lishi kerak");
    const role = roleOf(req.driver);
    if (active && !role) throw httpError(409, NEED_ROLE, "no_role");
    if (active && !req.driver.profile) throw httpError(409, NEED_PROFILE[role], "no_profile");
    res.json(meOf(store.saveDriver(req.driver.chatId, { active })));
  });

  // Hisobdan chiqish. Faqat tokenni o'chirish yetmaydi: Telegram'da bot odamni baribir taniydi va Mini App o'zi kiradi
  // (2026-11-07 da shunday bo'lgan — «chiqmadi»). Shuning uchun serverda: store.signOut — rol va sozlamalar yashiriladi,
  // yuborish to'xtaydi, bot uni yangi foydalanuvchidek ko'radi. Qayta kirib rolni tanlasa — sozlamalari tiklanadi.
  pub.post("/me/logout", (req, res) => {
    const { chatId } = req.driver;
    const user = store.signOut(chatId);
    void notify?.(chatId, SIGNED_OUT_TEXT, { reply_markup: { remove_keyboard: true } }); // xatoni o'zi yutadi
    res.json(meOf(user));
  });

  // Hisobni o'chirish: drivers jadvalidagi qator butunlay (rol, ikkala rolning sozlamalari, yo'nalish, telefon, admin belgisi).
  // Boshqa jadvallarda unga bog'liq narsa yo'q. Tokenlar o'z-o'zidan ishlamay qoladi (qator yo'q → 401).
  // Keyin botga kirsa yoki ilovaga qayta kirsa — yangi, bo'sh hisob ochiladi (rol tanlashdan boshlanadi).
  pub.delete("/me", (req, res) => {
    const { chatId } = req.driver;
    store.deleteDriver(chatId);
    // Javobni kutmaymiz: chatdagi pastki menyu eskirdi — bot nomidan «o'chirildi» deb yozib, menyuni olib tashlaymiz
    void notify?.(chatId, DELETED_TEXT, { reply_markup: { remove_keyboard: true } }); // xatoni o'zi yutadi
    res.json({ deleted: true });
  });

  // Yo'nalish — faqat sozlamalarini to'ldirgan haydovchiga (yuk beruvchining yo'nalishi sozlamalarida)
  const driverProfile = (driver) => {
    const role = roleOf(driver);
    if (!role) throw httpError(409, NEED_ROLE, "no_role");
    if (role !== "haydovchi") throw httpError(409, "Yo'nalish tanlash — haydovchilar uchun", "role");
    if (!driver.profile) throw httpError(409, NEED_PROFILE.haydovchi, "no_profile");
    return driver.profile;
  };

  // Tugmalardagi son — tanlangan muddatda (6/24/72 soat) mashinasiga sig'adigan yuklar, doiradan tashqaridagilarsiz
  pub.get("/me/route", (req, res) => {
    const profile = driverProfile(req.driver);
    const hours = clamp(Number(req.query.hours) || 24, 1, MAX_HOURS);
    const from = text(req.query.from);
    if (from && !validRouteArea(profile, scope, from)) throw httpError(400, "Bunday joy tanlab bo'lmaydi");
    const rows = store.recentLoads({ sinceMs: hours * HOUR, limit: 5000, kind: "yuk" }).filter(({ load }) => routeInScope(load, scope));
    res.json({ hours, from, ...routeCounts({ profile, scope, rows, from }) });
  });

  pub.put("/me/route", (req, res) => {
    const profile = driverProfile(req.driver);
    const { from, to } = req.body ?? {};
    if (!validRouteArea(profile, scope, from) || !validRouteArea(profile, scope, to)) throw httpError(400, "Bunday joy tanlab bo'lmaydi");
    res.json(meOf(store.saveDriver(req.driver.chatId, { profile: applyRoute(profile, from, to, now()) })));
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

  // --- Admin ---
  // Admin — .env dagi ADMIN_IDS yoki boshqaruv markazida (localhost) yoqilgan belgi. Bu server internetga chiqadi,
  // shuning uchun har bir so'rovda shu yerda tekshiriladi (web'dagi tugmani yashirish — himoya emas).
  // Bu yerdan boshqa odamni admin qilib ham, obunasini o'zgartirib ham BO'LMAYDI — faqat boshqaruv markazidan.
  const admin = express.Router();
  admin.use((req, res, next) => next(isAdmin(req.driver, adminIds) ? undefined : httpError(403, "Bu bo'lim faqat adminlar uchun", "forbidden")));

  admin.get("/overview", (req, res) => {
    const m = store.metrics();
    const today = pacificDay(now()); // Gemini kunlik limiti Tinch okeani vaqti bilan yangilanadi
    // AI ulanishlari: kalitning o'zi ham, "…a1B2" ko'rsatkichi ham yuborilmaydi
    const ai = store.listAiKeys().flatMap((key) =>
      key.models.map(({ model, state }) => {
        const fresh = state?.day === today;
        return {
          label: key.label ?? key.provider,
          model,
          enabled: key.enabled,
          requests: fresh ? state.requests : 0,
          posts: fresh ? state.posts : 0,
          errors: fresh ? state.errors : 0,
          restingUntil: state?.cooldownUntil > now() ? state.cooldownUntil : null,
          reason: state?.cooldownUntil > now() ? (state.reason ?? null) : null,
          problem: Boolean(state?.problem), // tez-tez xato beryapti — bot uni oxirgi navbatda ishlatadi
        };
      }),
    );
    res.json({
      now: m.now,
      queue: m.queue,
      lastHour: m.lastHour,
      loads: m.loads,
      trucks: m.trucks,
      drivers: m.drivers,
      shippers: m.shippers,
      hourly: m.hourly,
      ai,
    });
  });

  // Ro'yxatda telefon yo'q (foydalanuvchi ulashgan raqam faqat boshqaruv markazida): ism, username, rol, holat
  admin.get("/users", (req, res) => {
    const q = text(req.query.q)?.toLowerCase().replace(/^@/, "") ?? null;
    const role = req.query.role === "none" ? "none" : validRole(req.query.role);
    const items = store
      .listDrivers()
      .filter((u) => !role || (role === "none" ? !u.role : u.role === role))
      .filter((u) => !q || [u.name, u.username, String(u.chatId)].some((v) => v?.toLowerCase().includes(q)))
      .map((u) => ({
        chatId: u.chatId,
        name: u.name,
        username: u.username,
        role: u.role,
        plan: u.plan,
        isAdmin: isAdmin(u, adminIds),
        hasProfile: Boolean(u.profile),
        registering: u.registering,
        active: u.active,
        // Hisobdan chiqqan: role null (bot yubormaydi), lekin qaysi roldan chiqqani ko'rsatiladi
        signedOut: !u.role && u.signedOutAt != null,
        signedOutRole: u.role ? null : u.signedOutRole,
        updatedAt: u.updatedAt,
      }));
    res.json({ total: items.length, items: items.slice(0, 200) });
  });

  admin.patch("/users/:id", (req, res) => {
    const chatId = Number(req.params.id);
    const user = Number.isSafeInteger(chatId) ? store.getDriver(chatId) : null;
    if (!user) throw httpError(404, "Foydalanuvchi topilmadi");
    const body = req.body ?? {};
    // Avval hammasini tekshiramiz, keyin o'zgartiramiz (xato so'rov yarim-yorti saqlanib qolmasin)
    const role = "role" in body ? validRole(body.role) : null;
    if ("role" in body && !role) throw httpError(400, "role: haydovchi yoki yuk_beruvchi bo'lishi kerak");
    if ("active" in body && typeof body.active !== "boolean") throw httpError(400, "active: true yoki false bo'lishi kerak");
    // Bot va web'dagidek: har rolning sozlamalari saqlanadi, yangi rolda avval to'ldirgani bo'lsa — tiklanadi.
    // Rol almashsa, active e'tiborga olinmaydi (switchRole yoqib qo'yadi)
    if (role && role !== roleOf(user)) return res.json(meOf(store.switchRole(chatId, role), { withPhone: false }));
    if ("active" in body) {
      if (body.active && !user.profile) throw httpError(409, "Bu foydalanuvchi hali sozlamalarni to'ldirmagan");
      return res.json(meOf(store.saveDriver(chatId, { active: body.active }), { withPhone: false }));
    }
    res.json(meOf(user, { withPhone: false }));
  });

  pub.use("/admin", admin);

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
