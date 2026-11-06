// Boshqaruv markazi API'si (Express). Faqat shu kompyuterdan ochiladi (127.0.0.1).
// Ma'lumot @yuk/store dan (bot va collector bilan bitta baza), jarayonlar processes.js dan.
// Javoblarda kalit va tokenlar hech qachon bo'lmaydi — faqat "yozilganmi" (true/false).
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { tunnelUrl } from "@yuk/store";
import { createAiTools } from "./ai.js";

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

// AI kaliti: bo'sh joysiz, 10–300 belgi (Gemini "AIza…" ~39, Anthropic "sk-ant-…" ~100)
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
export function createApp({ store, processes, env = process.env, adminDist = null, ai = createAiTools(), secret = null, sessions = null, publicUrl = null }) {
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
    res.json({ metrics: store.metrics(), processes: processes.list(), config: configInfo(env, { publicUrl, tunnel: tunnelUrl(store) }) });
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

  // Haydovchilar web'ini shu haydovchi nomidan ochish (sinash uchun, Telegram'ga kirmasdan).
  // Token manzilning # qismida — serverga va boshqa saytlarga bormaydi; 12 soat amal qiladi.
  api.post("/drivers/:chatId/web-link", (req, res) => {
    if (!sessions || !publicUrl) throw httpError(503, "Haydovchilar web'i ishga tushmagan");
    const chatId = Number(req.params.chatId);
    if (!store.getDriver(chatId)) throw httpError(404, "Haydovchi topilmadi");
    res.json({ url: `${publicUrl}/#token=${sessions.issue(chatId, { ttl: 12 * 60 * 60 })}` });
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

  // Bitta haqiqiy so'rov bilan sinov (bepul limitdan 1 ta so'rov sarflanadi)
  api.post("/ai/keys/:id/test", async (req, res) => {
    const key = storedKey(req.params.id);
    const model = String(req.body?.model ?? "");
    if (!key.models.some((m) => m.model === model)) throw httpError(400, "Bu model shu kalitga qo'shilmagan");
    try {
      res.json(await ai.test(key.provider, model, key.apiKey));
    } catch (error) {
      res.json({ ok: false, model, error: ai.describe(key.provider, error), loads: [] });
    }
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
