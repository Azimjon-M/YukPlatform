// Boshqaruv markazi API'si (Express). Faqat shu kompyuterdan ochiladi (127.0.0.1).
// Ma'lumot @yuk/store dan (bot va collector bilan bitta baza), jarayonlar processes.js dan.
// Javoblarda kalit va tokenlar hech qachon bo'lmaydi — faqat "yozilganmi" (true/false).
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { PLAN_IDS, isAdmin, parseAdminIds } from "@yuk/shared";
import { MAIN_TG_ACCOUNT, tunnelUrl } from "@yuk/store";
import { createAiTools } from "./ai.js";
import { createAvatars } from "./avatars.js";
import { COOKIE_NAME, createAdminAuth, requestToken } from "./adminAuth.js";
import { createErrorLog } from "./errorLog.js";
import { createLive, processMarks } from "./live.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SLOW_MS = 10_000; // API javobi bundan uzoq — «sekin» ogohlantirishi

// "@guruh", "guruh", "t.me/guruh", "https://t.me/guruh/123" → "@guruh"; "-100123…" (kanal / katta guruh) va
// "-123…" (kichik guruh) — collector akkauntlari a'zo bo'lgan guruhning raqami → o'zgarishsiz; boshqasi → null
export function normalizeSourceName(input) {
  const raw = String(input ?? "").trim();
  if (/^-\d{5,}$/.test(raw)) return raw;
  const link = raw.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me)\//i, "");
  if (/^(\+|joinchat\/)/i.test(link)) return null; // yopiq guruh taklif havolasi
  const username = link.replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username) ? `@${username}` : null;
}

// .env haqida faqat bor-yo'qligi; kanal, Mini App va haydovchilar web'i manzili maxfiy emas.
// tunnel — ishlab turgan tunnel bergan manzil (@yuk/store tunnelUrl): .env da MINIAPP_URL bo'lmasa, bot Mini App'ni shu bilan ochadi
export function configInfo(env, { publicUrl = null, tunnel = null } = {}) {
  return {
    botToken: Boolean(env.BOT_TOKEN),
    channel: env.CHANNEL_ID || null,
    // Bot yuklarni kanalga ham joylaydimi (apps/bot config.js: standart — yo'q)
    channelLoads: /^(1|ha|yes|true|on)$/i.test(env.CHANNEL_LOADS?.trim() ?? ""),
    miniappUrl: env.MINIAPP_URL || tunnel || null,
    miniappFromTunnel: !env.MINIAPP_URL && Boolean(tunnel),
    publicUrl,
    publicTunnel: tunnel || env.PUBLIC_URL || null,
    telegramApi: Boolean(env.TG_API_ID && env.TG_API_HASH),
    parser: {
      provider: env.PARSER_PROVIDER || "gemini",
      model: env.PARSER_MODEL || null,
      keys: {
        gemini: Boolean(env.GEMINI_API_KEY),
        onepro: Boolean(env.ONEPRO_API_KEY),
        groq: Boolean(env.GROQ_API_KEY),
        openrouter: Boolean(env.OPENROUTER_API_KEY),
        claude: Boolean(env.ANTHROPIC_API_KEY),
      },
    },
  };
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Tunnel / nginx orqali kelgan so'rovda haqiqiy manzil sarlavhada boladi (Cloudflare — cf-connecting-ip, nginx — x-forwarded-for).
// Login urinishlarini shu manzil bo'yicha sanaymiz.
const clientIp = (req) => req.get("cf-connecting-ip") || req.get("x-forwarded-for")?.split(",")[0].trim() || req.socket?.remoteAddress || "?";

// HTTPS orqali keldimi (nginx/tunnel sarlavhasi yoki shu serverning o'zi) — cookie'ga Secure shunday qo'shiladi
const isHttps = (req) => req.secure || (req.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
const pick = (query, keys) => Object.fromEntries(keys.filter((k) => query[k] !== undefined && query[k] !== "").map((k) => [k, String(query[k])]));
const bool = (value, field) => {
  if (typeof value !== "boolean") throw httpError(400, `${field}: true yoki false bo'lishi kerak`);
  return value;
};

// AI kaliti: bo'sh joysiz, 10–300 belgi (Gemini "AIza…" ~39, 1pro "sk-…" ~46, Anthropic "sk-ant-…" ~100)
function validKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 10 || key.length > 300 || /\s/.test(key)) throw httpError(400, "Kalit noto'g'ri ko'rinishda: uni to'liq nusxalab qo'ying");
  return key;
}

function validModels(value) {
  const ok = Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((m) => typeof m === "string" && /^[\w.\-/:]{2,80}$/.test(m));
  if (!ok) throw httpError(400, "Kamida bitta model tanlang");
  return [...new Set(value)];
}

const validLabel = (value) => (value == null || String(value).trim() === "" ? null : String(value).trim().slice(0, 60));

// ai — @yuk/parser bilan ishlaydigan yordamchilar (ai.js); secret — kalitlarni shifrlash kaliti (data/secret.key)
// sessions — haydovchilar web'i tokenlari (telegramAuth.js), publicUrl — o'sha web manzili (server.js beradi)
// live — jonli yangilanish (live.js); berilmasa shu yerda yaratiladi (bazadan + jarayonlardan belgilar)
// errors — xatolar jurnali (errorLog.js): server.js jarayon loglarini ham shunga beradi
// slowMs — API javobi shundan uzoq cho'zilsa, «Xatolar» ga ogohlantirish yoziladi
export const METRICS_TTL_MS = 15_000;

export function createApp({
  store,
  processes,
  env = process.env,
  adminDist = null,
  ai = createAiTools(),
  secret = null,
  sessions = null,
  publicUrl = null,
  live = null,
  auth = null,
  errors = createErrorLog(),
  slowMs = SLOW_MS,
  avatars = createAvatars({ token: env.BOT_TOKEN?.trim() }),
}) {
  const app = express();
  // Kirish: secret (data/secret.key) bo'lsa — parol bilan himoyalangan (.env ADMIN_PASS yoki panel orqali qo'yiladi).
  // Sinov/serverda maxsus berilmasa shu yerda ochiladi; secret bo'lmasa (eski qo'shimcha serverlar) — parolsiz, eski holicha.
  const guard = auth ?? (auth === null && secret ? createAdminAuth({ store, secret, env }) : null);
  if (guard?.enabled) guard.syncFromEnv();
  // SSE kadr izohi (live.js): Cloudflare quick-tunnel kichik kadrlarni saqlab qoladi. .env ADMIN_SSE_PAD=0 — o'chirish.
  const changes =
    live ??
    createLive({
      marks: () => ({ ...store.changeMarks(), ...processMarks(processes), errors: String(errors.seq()) }),
      tunnelPadBytes: env.ADMIN_SSE_PAD === undefined || env.ADMIN_SSE_PAD === "" ? 70_000 : Number(env.ADMIN_SSE_PAD) || 0,
    });
  app.locals.live = changes; // server.js to'xtaganda ochiq ulanishlarni yopadi
  app.locals.errors = errors;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const api = express.Router();

  // Sekin javob va kutmay uzilgan so'rov — «Xatolar» bo'limiga (server «osilib» qolganini shundan bilamiz).
  // Brauzer GET so'rovni 20 s da tashlab ketadi (apps/admin api.js) — server tomonda u «kutmay uzildi» bo'lib ko'rinadi.
  // /live — doim ochiq turadigan ulanish, u hisoblanmaydi.
  api.use((req, res, next) => {
    if (req.path === "/live") return next();
    const started = Date.now();
    res.on("close", () => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const where = `${req.method} /api${req.path}`;
      if (!res.writableFinished) {
        errors.add({ source: "api", level: "warning", kind: "timeout", text: `${where}: brauzer javobni kutmay uzdi (${seconds} s)` });
      } else if (Date.now() - started > slowMs) {
        errors.add({ source: "api", level: "warning", kind: "slow", text: `${where}: javob ${seconds} s da berildi (sekin)` });
      }
    });
    next();
  });

  // Himoya: boshqa sayt brauzeringiz orqali localhost'ga so'rov yubora olmasin.
  // Host faqat localhost (DNS rebinding'ga qarshi); o'zgartiruvchi so'rovlarda maxsus sarlavha (CORS preflight'siz yuborib bo'lmaydi).
  api.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return next(httpError(403, "Boshqaruv markazi faqat shu kompyuterdan ochiladi"));
    if (req.method !== "GET" && req.get("x-yuk-admin") !== "1") return next(httpError(403, "So'rov boshqaruv markazidan kelmadi"));
    next();
  });

  // --- Kirish (login) — adminAuth.js. Panel internetga chiqqani uchun /api endi parolsiz ochilmaydi:
  // brauzerda httpOnly cookie (yuk_admin), curl/sinovda «Authorization: Bearer <token>».
  // LOCAL_HOSTS va x-yuk-admin tekshiruvlari SHU YO'RIQDA oldin turadi (login so'rovi ham ularni o'tadi).
  // Cookie — httpOnly (JS o'qib bo'lmaydi), SameSite=Lax (boshqa sayt yubora olmaydi), HTTPS'da Secure
  const adminCookie = (res, req, value, maxAgeSec) =>
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${value ?? ""}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`);
  // /api/login, /api/setup, /api/session — kirishgacha ham ishlaydi
  if (guard?.enabled) {
    api.post("/login", (req, res) => {
      const answer = guard.login({ username: req.body?.username ?? req.body?.login, password: req.body?.password, remember: Boolean(req.body?.remember), ip: clientIp(req) });
      if (answer.error) return res.status(answer.status).json({ error: answer.error });
      adminCookie(res, req, answer.token, Math.round((answer.expiresAt - Date.now()) / 1000));
      res.json({ ok: true, login: guard.currentLogin(), expiresAt: answer.expiresAt, remember: answer.remember });
    });

    // Parol hali qo'yilmagan birinchi ishga tushirishda: sahifa birinchi parolni o'zi qo'yadi (shundan keyin yopiladi)
    api.post("/setup", (req, res) => {
      const answer = guard.setup({ username: req.body?.username ?? req.body?.login, password: req.body?.password, repeat: req.body?.repeat, ip: clientIp(req) });
      if (answer.error) return res.status(answer.status).json({ error: answer.error });
      adminCookie(res, req, answer.token, Math.round((answer.expiresAt - Date.now()) / 1000));
      res.json({ ok: true, login: guard.currentLogin(), expiresAt: answer.expiresAt, remember: true });
    });

    // Kirgan holat: parol qo'yilganmi, sessiya qachongacha, parolni almashtirish mumkinmi
    api.get("/session", (req, res) => {
      const token = requestToken(req, guard.cookieName);
      const active = token ? guard.verify(token) : null;
      // login — faqat kirgan holatda (tashqaridagi odam uni bilib qo'ymasligi uchun)
      res.json({ signedIn: Boolean(active), user: active?.user ?? null, login: active ? guard.currentLogin() : null, ...guard.status(), expiresAt: active?.expiresAt ?? null });
    });

    // «Chiqish» — cookie o'chiriladi (token bekor qilinmaydi, 12 soatda o'zi tugaydi; parol almashtirilsa ham eski token ishlayveradi)
    api.post("/logout", (req, res) => {
      adminCookie(res, req, "", 0);
      res.json({ ok: true });
    });

    // Parolni almashtirish — faqat kirgan odam (eski parolni bilgan holda)
    api.post("/password", (req, res) => {
      const answer = guard.change({ oldPassword: req.body?.oldPassword, password: req.body?.password, repeat: req.body?.repeat, ip: clientIp(req) });
      if (answer.error) return res.status(answer.status).json({ error: answer.error });
      res.json({ ok: true });
    });

    // Login va/yoki parolni almashtirish (Azimjon: «username va parolli bo'lishligi kerak»).
    // Eski parol tasdiqlanadi — sessiya bo'lsa ham shart: eshik oldida ketma-ket o'tirgan odam parolni
    // o'zgartirib yubormasin. Sessiyani uzmaymiz (kirgan holat saqlanadi).
    api.post("/account", (req, res) => {
      const answer = guard.account({
        login: req.body?.username ?? req.body?.login,
        oldPassword: req.body?.oldPassword,
        password: req.body?.password,
        repeat: req.body?.repeat,
        ip: clientIp(req),
      });
      if (answer.error) return res.status(answer.status).json({ error: answer.error });
      res.json({ ok: true, login: answer.login });
    });

    // Qolgan barcha /api so'rovi — sessiya bilan. /live (SSE) ham: EventSource cookie yuboradi, sarlavha qo'sha olmaydi.
    // Parol HALI qo'yilmagan bo'lsa (yangi o'rnatish, sinov) — eshik ochiq qoladi: birinchi parolni qo'yish
    // uchun sahifa ochilishi kerak. Parol qo'yilishi bilan hamma so'rov sessiyaga bog'lanadi.
    api.use((req, res, next) => {
      if (!guard.status().configured) return next();
      const token = requestToken(req, guard.cookieName);
      if (token && guard.verify(token)) return next();
      return next(httpError(401, "Kirish muddati tugagan — qaytadan kiring"));
    });
  }

  // Jonli yangilanish: ochiq sahifaga «drivers o'zgardi» kabi xabarlar (SSE, live.js). Ma'lumotning o'zi — oddiy GET'larda
  api.get("/live", (req, res) => changes.handler(req, res));

  // Ko'rsatkichlar og'ir (store.metrics, ~0,5–1,5 s) — METRICS_TTL_MS ichida qayta ishlatiladi (store admin.js)
  api.get("/overview", (req, res) => {
    res.json({
      metrics: store.metrics({ maxAgeMs: METRICS_TTL_MS }),
      processes: processes.list(),
      config: configInfo(env, { publicUrl, tunnel: tunnelUrl(store) }),
      errors: errors.summary(), // yon paneldagi «Xatolar» soni uchun
    });
  });

  // --- Xatolar jurnali (errorLog.js): jarayonlar loglaridagi va API'ning o'z xatolari ---
  // ignored — «E'tiborsiz qoldirilganlar» (endi ko'rsatilmaydi, faqat sanaladi; «Qaytarish» bilan qaytadi)
  api.get("/errors", (req, res) => res.json({ items: errors.list(), ignored: errors.ignoredList() }));
  api.delete("/errors", (req, res) => {
    errors.clear();
    res.json({ ok: true });
  });
  // Bitta xato: «O'chirish» (yana chiqsa — qaytadi). Allaqachon yo'q bo'lsa ham ok (sahifa baribir yangilanadi)
  api.delete("/errors/:id", (req, res) => {
    res.json({ ok: true, removed: errors.remove(req.params.id) });
  });
  // «E'tiborsiz qoldirish»: shu xato endi ko'rsatilmaydi (yana chiqsa ham)
  api.post("/errors/:id/ignore", (req, res) => {
    const rule = errors.ignore(req.params.id);
    if (!rule) return res.status(404).json({ error: "Bu xato jurnalda yo'q — sahifani yangilang" });
    res.json({ ok: true, rule });
  });
  // «Qaytarish»: { key } — e'tiborsiz qoldirilgan xato yana ko'rsatiladi
  api.post("/errors/unignore", (req, res) => {
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    if (!errors.unignore(key)) return res.status(404).json({ error: "Bunday e'tiborsiz xato yo'q — sahifani yangilang" });
    res.json({ ok: true });
  });

  // --- Yuklar va navbat ---
  api.get("/loads", (req, res) => {
    res.json(store.listLoads(pick(req.query, ["from", "to", "truckClass", "bodyType", "q", "hours", "limit", "offset"])));
  });

  api.get("/posts", (req, res) => {
    res.json(store.listPosts(pick(req.query, ["status", "q", "limit", "offset"])));
  });

  // Xato bilan tugagan hamma e'lonlarni o'chirish (qayta navbatga qo'yish yo'q — vaqti o'tgan e'lon kerak emas)
  api.delete("/posts/failed", (req, res) => res.json(store.clearFailed()));

  // --- Haydovchilar ---
  // idleSince — avtomatik pauza soati qachondan (bot idle.js birinchi tekshiruvi): sahifa «qachon pauza bo'ladi» ni
  // @yuk/shared idleState bilan hisoblaydi
  // Ro'yxatlardagi kichik rasmlar (avatars.js): yo'q bo'lsa 404 — ilova bosh harflarni ko'rsatadi
  api.get("/avatar/:kind/:key", async (req, res) => {
    const { kind, key } = req.params;
    const data = kind === "user" ? await avatars.user(key) : kind === "source" ? await avatars.source(key) : null;
    if (!data) return res.status(404).set("cache-control", "private, max-age=3600").end();
    res.set({ "content-type": "image/jpeg", "cache-control": "private, max-age=86400" }).send(data);
  });

  api.get("/drivers", (req, res) => res.json({ items: store.listDrivers(), idleSince: Number(store.getSetting("idle_since")) || null }));

  // «Batafsil» (akkordeon): saqlangan sozlamalar (ikkala rol), tarix, oxirgi yuborilgan yuklar
  api.get("/drivers/:chatId", (req, res) => {
    const details = store.driverDetails(Number(req.params.chatId));
    if (!details) throw httpError(404, "Haydovchi topilmadi");
    // Mini App'dan ulagan Telegram akkauntlari — «🔎 Auto scan» shu yerdan ham (2026-11-13)
    const tgAccounts = (store.listTgAccounts?.() ?? [])
      .filter((a) => a.addedBy === Number(req.params.chatId))
      .map((a) => ({ ...a, scan: store.dialogScanSummary(a.name) }));
    res.json({ ...details, tgAccounts });
  });

  // Butunlay o'chirish — odam shaxsiy ma'lumotini o'chirishni talab qilsa (o'zi botda o'chirsa ham ma'lumot qoladi):
  // foydalanuvchi, unga yuborilganlar ro'yxati va tarixi. Qaytarib bo'lmaydi
  api.delete("/drivers/:chatId", (req, res) => {
    if (!store.purgeDriver(Number(req.params.chatId))) throw httpError(404, "Haydovchi topilmadi");
    res.json({ ok: true });
  });

  // { blocked } — bloklash / blokdan chiqarish (Azimjon, 2026-11-09). Blok shu odamning Telegram id, username va raqamiga
  // qo'yiladi (store.banDriver): boshqa akkaunt o'sha username yoki raqam bilan kelsa ham bloklangan. Bot va web unga
  // «Uzr, sizga xizmat ko'rsata olmaymiz!» deydi, yuk yuborilmaydi. Adminni bloklab bo'lmaydi (avval admin huquqini olish).
  // { isAdmin } — Mini App'dagi «🛠 Boshqaruv» huquqi. Admin belgisi FAQAT shu yerdan (localhost) qo'yiladi —
  // internetdagi ilova serveri buni qila olmaydi. Faol / pauza — bu yerdan emas (Azimjon, 2026-11-09: «buni faqat
  // foydalanuvchi hal qiladi»): o'zi botda ⏸ / ▶️, yoki 48 soat kirmasa bot o'zi pauza qiladi (apps/bot idle.js).
  api.patch("/drivers/:chatId", (req, res) => {
    const chatId = Number(req.params.chatId);
    const body = req.body ?? {};
    const driver = store.getDriver(chatId);
    if (!driver) throw httpError(404, "Haydovchi topilmadi");
    if ("active" in body) throw httpError(400, "Faol / pauzani faqat foydalanuvchining o'zi o'zgartiradi (botda ⏸ Pauza / ▶️ Davom ettirish)");
    if ("blocked" in body) {
      const blocked = bool(body.blocked, "blocked");
      if (blocked && isAdmin(driver, parseAdminIds(env.ADMIN_IDS))) throw httpError(409, "Adminni bloklab bo'lmaydi — avval admin huquqini oling");
      if (blocked) store.banDriver(chatId);
      else store.unbanDriver(chatId);
      res.json({ ...store.getDriver(chatId), banned: store.banOf(store.getDriver(chatId)) });
      return;
    }
    if ("plan" in body) {
      // Obuna: «pro» — yopiq guruhlar e'lonlari ham keladi (roles.js planAllows). Faqat boshqaruv markazidan
      if (!PLAN_IDS.includes(body.plan)) throw httpError(400, `plan: ${PLAN_IDS.join(" | ")}`);
      res.json(store.saveDriver(chatId, { plan: body.plan, why: "admin" }));
      return;
    }
    if (!("isAdmin" in body)) throw httpError(400, "isAdmin, plan yoki blocked kerak");
    if (body.isAdmin === true && store.banOf(driver)) throw httpError(409, "Bloklangan foydalanuvchini admin qilib bo'lmaydi — avval blokdan chiqaring");
    res.json(store.saveDriver(chatId, { isAdmin: bool(body.isAdmin, "isAdmin"), why: "admin" })); // tarixda: «boshqaruv markazidan»
  });

  // Haydovchilar web'ini shu haydovchi nomidan ochish (sinash uchun, Telegram'ga kirmasdan).
  // Token manzilning ?t= qismida (avval #token= edi): nginx «bo'shqina» kelsa /admin'ga yo'naltiradi,
  // manzilda biror parametr bo'lsa — yo'naltirmaydi (# qismi nginx'ga ko'rinmaydi). 12 soat amal qiladi.
  api.post("/drivers/:chatId/web-link", (req, res) => {
    if (!sessions || !publicUrl) throw httpError(503, "Haydovchilar web'i ishga tushmagan");
    const chatId = Number(req.params.chatId);
    if (!store.getDriver(chatId)) throw httpError(404, "Haydovchi topilmadi");
    res.json({ url: `${publicUrl}/?t=${sessions.issue(chatId, { ttl: 12 * 60 * 60 })}` });
  });

  // --- Manbalar (collector kuzatadigan guruhlar; o'zgarish keyingi aylanishda kuchga kiradi) ---
  // Foydalanuvchi qo'shgan manbada (bot «➕ Guruh qo'shish», 2026-11-10): addedByUser — kim (ism, username), trial —
  // sinov boshlanganidan beri nechta yuk e'loni (store.trialStats; faqat sinovdagilarda)
  api.get("/sources", (req, res) => {
    const stats = store.sourceStats({ maxAgeMs: METRICS_TTL_MS }); // og'ir (posts 24 soat) — 15 s kesh
    const empty = { posts: 0, duplicates: 0, loads: 0, lastPostAt: null, live: 0, delaySec: null };
    const userOf = (chatId) => {
      if (chatId == null) return null;
      const user = store.getDriver(chatId);
      return { chatId, name: user?.name ?? null, username: user?.username ?? null };
    };
    res.json({
      items: store.listSources().map((s) => ({
        ...s,
        stats: stats[s.name] ?? empty,
        addedByUser: userOf(s.addedBy),
        trial: s.checkState === "trial" && store.trialStats ? store.trialStats(s.name, s.checkAt) : null,
      })),
    });
  });

  // Raqamli id (yopiq guruh) — collector yozgan akkauntlar guruhlari ro'yxatidan (tg_dialogs): qaysi akkaunt o'qiydi
  // va guruh nomi. account berilsa — o'sha akkaunt a'zo bo'lishi shart; berilmasa — asosiy, u a'zo bo'lmasa — a'zo bo'lgani.
  // Ro'yxat hali umuman yo'q bo'lsa (yangi collector ishlamagan) — avvalgidek asosiy akkauntga
  api.post("/sources", (req, res) => {
    const name = normalizeSourceName(req.body?.name);
    if (!name) throw httpError(400, "Guruh manzili tushunarsiz. Masalan: @guruh_nomi yoki https://t.me/guruh_nomi (yopiq guruh havolasi ishlamaydi)");
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null;
    const options = { note };
    if (name.startsWith("-")) {
      const wanted = typeof req.body?.account === "string" && req.body.account ? req.body.account : null;
      const dialogs = store.findTgDialog?.(name) ?? [];
      const dialog = wanted ? dialogs.find((d) => d.account === wanted) : dialogs[0];
      if (wanted && !dialog) throw httpError(400, `«${wanted}» akkaunti bu guruhga a'zo emas (yoki ro'yxati eskirgan — «Ro'yxatni yangilash» ni bosing)`);
      const known = (store.listTgAccounts?.() ?? []).some((a) => a.dialogsAt != null);
      if (!dialog && known) {
        throw httpError(400, "Bu id hech bir akkauntning guruhlari ro'yxatida yo'q: avval akkauntni guruhga qo'shing, keyin «Ro'yxatni yangilash» ni bosing");
      }
      if (dialog) {
        Object.assign(options, {
          account: dialog.account === MAIN_TG_ACCOUNT ? null : dialog.account,
          title: dialog.title || null,
          chatType: dialog.type === "kanal" ? "channel" : "group",
          members: dialog.members,
        });
      }
    }
    const added = store.addSource(name, options);
    res.status(added ? 201 : 200).json({ name, added, account: options.account ?? null });
  });

  // --- Collector'ning Telegram akkauntlari (tgAccounts.js, 2026-11-13) ---
  // Kirish (kod, 2FA) — faqat egasi o'zi: Mini App (public.js /pub/admin/tg-accounts/login) yoki serverda terminalda;
  // bu yerda faqat holat va a'zo bo'lgan guruhlar ro'yxati.
  // dialogs[].added — shu guruh allaqachon manba bo'lsa, uning nomi (id yoki @username bo'yicha)
  api.get("/tg-accounts", (req, res) => {
    const sources = store.listSources();
    const byName = new Map(sources.map((s) => [s.name.toLowerCase(), s.name]));
    const perAccount = {};
    for (const s of sources) perAccount[s.account ?? MAIN_TG_ACCOUNT] = (perAccount[s.account ?? MAIN_TG_ACCOUNT] ?? 0) + 1;
    const collector = processes.list().find((p) => p.name === "collector") ?? null;
    res.json({
      accounts: (store.listTgAccounts?.() ?? []).map((a) => ({ ...a, sources: perAccount[a.name] ?? 0, scan: store.dialogScanSummary?.(a.name) ?? null })),
      dialogs: (store.tgDialogs?.() ?? []).map((d) => ({
        ...d,
        added: byName.get(d.peerId) ?? (d.username ? (byName.get(`@${d.username.toLowerCase()}`) ?? null) : null),
      })),
      // Manbaga biriktirilgan, lekin bazada yo'q akkaunt (sessiyasi o'chirilgan) — sahifa ogohlantiradi
      orphans: Object.keys(perAccount).filter((name) => name !== MAIN_TG_ACCOUNT && !(store.listTgAccounts?.() ?? []).some((a) => a.name === name)),
      refreshRequestedAt: store.dialogsRefreshRequest?.() ?? null,
      collector: collector ? { status: collector.status } : null,
    });
  });

  // «🔎 Auto scan» (2026-11-13): shu akkauntning hali manba bo'lmagan guruh/kanallari «➕ Guruh qo'shish» tekshiruvidan
  // o'tadi (collector live.js scanNext, 30 soniyada bittadan, shu akkaunt bilan); o'tgani — 24 soatlik sinovga.
  // Akkaunt egasiga xabar yuborilmaydi. Navbat tugaguncha qayta bosish — shunchaki davom etadi
  api.post("/tg-accounts/:name/scan", (req, res) => {
    const account = (store.listTgAccounts?.() ?? []).find((a) => a.name === req.params.name);
    if (!account) throw httpError(404, "Bunday akkaunt yo'q");
    if (account.status !== "ok") throw httpError(409, "Akkaunt hozir ishlamayapti — u ulangach tekshiriladi");
    if (!account.scanRequestedAt) store.requestAccountScan(account.name);
    res.json({ scan: store.dialogScanSummary(account.name) });
  });

  // «Ro'yxatni yangilash»: ishlab turgan collector har akkaunt guruhlarini 1 daqiqa ichida qayta oladi
  api.post("/tg-accounts/refresh", (req, res) => {
    res.json({ requestedAt: store.requestDialogsRefresh() });
  });

  // A'zo bo'lish navbati: collector 5 daqiqada bittadan, kuniga ko'pi bilan 15 ta qo'shiladi (apps/collector live.js)
  // join-all — kuzatilayotgan, akkaunt a'zo bo'lmagan va hali navbatda / so'rovda bo'lmagan hamma guruh
  // Sinovdagi foydalanuvchi manbasi kirmaydi: kuniga 15 talik a'zolik limiti sinovdan o'tmagan guruhga ketmasin.
  // Qo'shimcha akkaunt o'qiydigan yopiq guruh ham kirmaydi (unga akkauntni odam qo'shadi)
  api.post("/sources/join-all", (req, res) => {
    const names = store
      .listSources()
      .filter((s) => s.enabled && !s.account && s.joined !== true && !["wanted", "requested", "joined"].includes(s.joinState) && !["probe", "trial"].includes(s.checkState))
      .map((s) => s.name);
    for (const name of names) store.requestJoin(name);
    res.json({ queued: names.length });
  });

  api.post("/sources/:name/join", (req, res) => {
    const state = store.requestJoin(req.params.name);
    if (!state) throw httpError(404, "Manba topilmadi");
    if (state === "account") throw httpError(409, "Bu yopiq guruhni qo'shimcha akkaunt o'qiydi (u guruhga a'zo) — asosiy akkaunt a'zo bo'lmaydi");
    res.json({ state });
  });

  api.delete("/sources/:name/join", (req, res) => {
    if (!store.cancelJoin(req.params.name)) throw httpError(409, "Bu guruh navbatda emas (collector allaqachon urinib bo'lgan bo'lishi mumkin)");
    res.json({ ok: true });
  });

  // { enabled } — kuzatish; { voice } — ochiq guruhning ovozli xabarlari matnga o'giriladimi (yopiq guruhga 409: u doim tekshiriladi)
  api.patch("/sources/:name", (req, res) => {
    const body = req.body ?? {};
    if (!("enabled" in body) && !("voice" in body)) throw httpError(400, "enabled yoki voice kerak");
    if ("voice" in body) {
      if (!String(req.params.name).startsWith("@")) throw httpError(409, "Yopiq guruhning ovozli xabarlari doim tekshiriladi");
      if (!store.setSourceVoice(req.params.name, bool(body.voice, "voice"))) throw httpError(404, "Manba topilmadi");
    }
    if ("enabled" in body && !store.setSourceEnabled(req.params.name, bool(body.enabled, "enabled"))) throw httpError(404, "Manba topilmadi");
    res.json({ ok: true });
  });

  api.delete("/sources/:name", (req, res) => {
    if (!store.removeSource(req.params.name)) throw httpError(404, "Manba topilmadi");
    res.json({ ok: true });
  });

  // --- AI kalitlari (bot har 15 s da qayta o'qiydi — qayta ishga tushirish shart emas) ---
  // Kalitning o'zi hech qachon javobga qo'shilmaydi: faqat "…a1B2"
  const access = () => ({ secret, env });
  const validProvider = (id) => {
    if (!ai.has(id)) throw httpError(400, "Noma'lum AI provayderi");
    return id;
  };
  async function modelsOr400(provider, key) {
    try {
      return await ai.listModels(provider, key);
    } catch (error) {
      throw httpError(400, ai.describe(provider, error));
    }
  }
  function storedKey(id) {
    const key = store.getAiKey(Number(id), access());
    if (!key) throw httpError(404, "Kalit topilmadi");
    if (!key.apiKey) throw httpError(400, key.problem);
    return key;
  }

  api.get("/ai", (req, res) => {
    res.json({ keys: store.listAiKeys(access()), providers: ai.providers, parallel: Number(env.PARSER_PARALLEL) || 8 });
  });

  // Kalitni tekshirish va modellar ro'yxati (bepul limitdan so'rov sarflamaydi)
  api.post("/ai/models", async (req, res) => {
    res.json({ models: await modelsOr400(validProvider(req.body?.provider), validKey(req.body?.key)) });
  });

  api.post("/ai/keys", async (req, res) => {
    const provider = validProvider(req.body?.provider);
    const key = validKey(req.body?.key);
    const models = validModels(req.body?.models);
    if (store.findAiKey(provider, key, access())) throw httpError(409, "Bu kalit allaqachon qo'shilgan — yangi modelni o'sha kalitning o'ziga qo'shing");
    await modelsOr400(provider, key); // kalit haqiqatan ishlayaptimi
    const id = store.addAiKey({ provider, label: validLabel(req.body?.label), apiKey: key, models }, secret);
    res.status(201).json({ id });
  });

  api.patch("/ai/keys/:id", (req, res) => {
    const body = req.body ?? {};
    const fields = {};
    if ("label" in body) fields.label = validLabel(body.label);
    if ("enabled" in body) fields.enabled = bool(body.enabled, "enabled");
    if ("models" in body) fields.models = validModels(body.models);
    if (!store.updateAiKey(Number(req.params.id), fields)) throw httpError(404, "Kalit topilmadi");
    res.json({ ok: true });
  });

  api.delete("/ai/keys/:id", (req, res) => {
    if (!store.removeAiKey(Number(req.params.id))) throw httpError(404, "Kalit topilmadi");
    res.json({ ok: true });
  });

  // Saqlangan kalit bilan modellar ro'yxati — yana model qo'shish uchun
  api.get("/ai/keys/:id/models", async (req, res) => {
    const key = storedKey(req.params.id);
    res.json({ models: await modelsOr400(key.provider, key.apiKey) });
  });

  function keyModel(req) {
    const key = storedKey(req.params.id);
    const model = String(req.body?.model ?? "");
    if (!key.models.some((m) => m.model === model)) throw httpError(400, "Bu model shu kalitga qo'shilmagan");
    return { key, model };
  }

  // Bitta haqiqiy so'rov bilan sinov (bepul limitdan 1 ta so'rov sarflanadi).
  // Muvaffaqiyatli bo'lsa — model ishlayapti: «dam olyapti» bekor qilinadi, bot uni darhol qayta ishlatadi
  api.post("/ai/keys/:id/test", async (req, res) => {
    const { key, model } = keyModel(req);
    let result;
    try {
      result = await ai.test(key.provider, model, key.apiKey);
    } catch (error) {
      result = { ok: false, model, error: ai.describe(key.provider, error), loads: [] };
    }
    if (result.ok) store.wakeAiSlot(`${key.id}:${model}`);
    res.json({ ...result, woke: Boolean(result.ok) });
  });

  // «Muammoli» belgisini qo'lda olib tashlash (xatolar hisobi noldan boshlanadi)
  api.post("/ai/keys/:id/reset", (req, res) => {
    const { key, model } = keyModel(req);
    store.resetAiSlotHealth(`${key.id}:${model}`);
    res.json({ ok: true });
  });

  // --- Jarayonlar: bot va collector ---
  api.get("/processes", (req, res) => res.json({ items: processes.list() }));

  api.post("/processes/:name/:action", async (req, res) => {
    const { name, action } = req.params;
    if (!["start", "stop", "restart"].includes(action)) throw httpError(404, "Noma'lum amal");
    res.json(await processes[action](name));
  });

  api.get("/processes/:name/logs", (req, res) => res.json(processes.logs(req.params.name, Number(req.query.after) || 0)));

  api.use((req, res, next) => next(httpError(404, "Topilmadi")));
  app.use("/api", api);

  // Tayyor boshqaruv markazi (npm run admin:build) — shu server orqali: http://localhost:3000/admin
  if (adminDist && existsSync(path.join(adminDist, "index.html"))) {
    const page = path.join(adminDist, "index.html");
    app.get("/", (req, res) => res.redirect("/admin/"));
    app.use("/admin", express.static(adminDist, { index: false }));
    // /admin/yuklar kabi sahifalar — bitta index.html, sahifani React o'zi tanlaydi
    app.get(/^\/admin(\/.*)?$/, (req, res) => res.sendFile(page));
  } else {
    app.get(/^\/(admin(\/.*)?)?$/, (req, res) =>
      res.status(503).type("text").send("Boshqaruv markazi hali yig'ilmagan. YukPlatform papkasida: npm start (yoki npm run admin:build)"),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    // express.json buzilgan JSON uchun 400 beradi (error.status) — bu brauzer xatosi, server emas
    const status = error.status ?? error.statusCode ?? 500;
    if (status >= 500) {
      console.error(error);
      errors.add({ source: "api", level: "error", kind: "server", text: `${req.method} ${req.originalUrl.split("?")[0]}: ${error.message}`, details: error.stack });
    }
    res.status(status).json({ error: status >= 500 ? `Server xatosi: ${error.message}` : error.message });
  });

  return app;
}
