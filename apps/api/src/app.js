// Boshqaruv markazi API'si (Express). Faqat shu kompyuterdan ochiladi (127.0.0.1).
// Ma'lumot @yuk/store dan (bot va collector bilan bitta baza), jarayonlar processes.js dan.
// Javoblarda kalit va tokenlar hech qachon bo'lmaydi — faqat "yozilganmi" (true/false).
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// "@guruh", "guruh", "t.me/guruh", "https://t.me/guruh/123" → "@guruh"; "-100123" → "-100123"; boshqasi → null
export function normalizeSourceName(input) {
  const raw = String(input ?? "").trim();
  if (/^-100\d{5,}$/.test(raw)) return raw;
  const link = raw.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me)\//i, "");
  if (/^(\+|joinchat\/)/i.test(link)) return null; // yopiq guruh taklif havolasi
  const username = link.replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username) ? `@${username}` : null;
}

// .env haqida faqat bor-yo'qligi; kanal va Mini App manzili maxfiy emas
export function configInfo(env) {
  return {
    botToken: Boolean(env.BOT_TOKEN),
    channel: env.CHANNEL_ID || null,
    miniappUrl: env.MINIAPP_URL || null,
    telegramApi: Boolean(env.TG_API_ID && env.TG_API_HASH),
    parser: {
      provider: env.PARSER_PROVIDER || "gemini",
      model: env.PARSER_MODEL || null,
      keys: { gemini: Boolean(env.GEMINI_API_KEY), claude: Boolean(env.ANTHROPIC_API_KEY) },
    },
  };
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const pick = (query, keys) => Object.fromEntries(keys.filter((k) => query[k] !== undefined && query[k] !== "").map((k) => [k, String(query[k])]));
const bool = (value, field) => {
  if (typeof value !== "boolean") throw httpError(400, `${field}: true yoki false bo'lishi kerak`);
  return value;
};

export function createApp({ store, processes, env = process.env, adminDist = null }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const api = express.Router();

  // Himoya: boshqa sayt brauzeringiz orqali localhost'ga so'rov yubora olmasin.
  // Host faqat localhost (DNS rebinding'ga qarshi); o'zgartiruvchi so'rovlarda maxsus sarlavha (CORS preflight'siz yuborib bo'lmaydi).
  api.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return next(httpError(403, "Boshqaruv markazi faqat shu kompyuterdan ochiladi"));
    if (req.method !== "GET" && req.get("x-yuk-admin") !== "1") return next(httpError(403, "So'rov boshqaruv markazidan kelmadi"));
    next();
  });

  api.get("/overview", (req, res) => {
    res.json({ metrics: store.metrics(), processes: processes.list(), config: configInfo(env) });
  });

  // --- Yuklar va navbat ---
  api.get("/loads", (req, res) => {
    res.json(store.listLoads(pick(req.query, ["from", "to", "truckClass", "bodyType", "q", "hours", "limit", "offset"])));
  });

  api.get("/posts", (req, res) => {
    res.json(store.listPosts(pick(req.query, ["status", "q", "limit", "offset"])));
  });

  api.post("/posts/retry-failed", (req, res) => res.json({ retried: store.retryFailed() }));
  api.post("/posts/:id/retry", (req, res) => res.json({ retried: store.retryFailed(Number(req.params.id)) }));

  // --- Haydovchilar ---
  api.get("/drivers", (req, res) => res.json({ items: store.listDrivers() }));

  api.patch("/drivers/:chatId", (req, res) => {
    const chatId = Number(req.params.chatId);
    const active = bool(req.body?.active, "active");
    const driver = store.getDriver(chatId);
    if (!driver) throw httpError(404, "Haydovchi topilmadi");
    if (active && !driver.profile) throw httpError(400, "Haydovchi hali ro'yxatdan o'tmagan");
    res.json(store.saveDriver(chatId, { active }));
  });

  // --- Manbalar (collector kuzatadigan guruhlar; o'zgarish keyingi aylanishda kuchga kiradi) ---
  api.get("/sources", (req, res) => {
    const stats = store.sourceStats();
    const empty = { posts: 0, duplicates: 0, loads: 0, lastPostAt: null };
    res.json({ items: store.listSources().map((s) => ({ ...s, stats: stats[s.name] ?? empty })) });
  });

  api.post("/sources", (req, res) => {
    const name = normalizeSourceName(req.body?.name);
    if (!name) throw httpError(400, "Guruh manzili tushunarsiz. Masalan: @guruh_nomi yoki https://t.me/guruh_nomi (yopiq guruh havolasi ishlamaydi)");
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null;
    const added = store.addSource(name, { note });
    res.status(added ? 201 : 200).json({ name, added });
  });

  api.patch("/sources/:name", (req, res) => {
    if (!store.setSourceEnabled(req.params.name, bool(req.body?.enabled, "enabled"))) throw httpError(404, "Manba topilmadi");
    res.json({ ok: true });
  });

  api.delete("/sources/:name", (req, res) => {
    if (!store.removeSource(req.params.name)) throw httpError(404, "Manba topilmadi");
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
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? `Server xatosi: ${error.message}` : error.message });
  });

  return app;
}
