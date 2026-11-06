// Boshqaruv markazi: API + web + bot va collector'ni boshqarish. Ishga tushirish (YukPlatform papkasida):
//   npm start        — web'larni yig'adi, serverlarni ochadi, bot va collector'ni o'zi yoqadi → http://localhost:3000/admin
//   npm run api      — faqat serverlar (bot va collector'ni yoqmaydi), web'dan yoqasiz; web dasturlash rejimida: `npm run admin`
// Sozlamalar (.env, ixtiyoriy): API_PORT=3000, PUBLIC_PORT=3001, NGINX_PORT=80,
//   AUTOSTART=nginx,tunnel,bot,collector (standart: o'rnatilganlari hammasi; none — hech birini yoqmaydi)
//
// Ikki server ochiladi, ikkalasi ham faqat shu kompyuterda (127.0.0.1):
//   3000 — boshqaruv markazi (siz uchun; internetga HECH QACHON chiqarilmaydi)
//   3001 — haydovchilar web'i va Mini App API'si (public.js)
// Old eshik: nginx (http://localhost, src/edge/nginx.js) ilova fayllarini beradi va /pub ni 3001 ga uzatadi;
// tunnel (src/edge/tunnel.js) nginx'ni internetga chiqaradi. Ikkalasi ham bot va collector kabi jarayon.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSettings } from "@yuk/parser";
import { routeScopeFrom } from "@yuk/shared";
import { loadSecret, openStore } from "@yuk/store";
import { createApp, normalizeSourceName } from "./app.js";
import { createProcessManager } from "./processes.js";
import { createPublicApp } from "./public.js";
import { findCloudflared, findNginx } from "./edge/tools.js";
import { createSessions } from "./telegramAuth.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = Number(process.env.API_PORT) || 3000;
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT) || 3001;
const HOST = "127.0.0.1"; // faqat shu kompyuter: internetdan va tarmoqdan ochilmaydi (tunnel ham shu yerga ulanadi)
const PUBLIC_LOCAL_URL = `http://localhost:${PUBLIC_PORT}`;

const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);

// AUTOSTART bo'sh yoki yozilmagan — hammasi (nginx va tunnel — kompyuterda o'rnatilgan bo'lsa); "none" — hech biri
const defaults = [findNginx() && "nginx", findCloudflared() && "tunnel", "bot", "collector"].filter(Boolean).join(",");
const wanted = process.env.AUTOSTART?.trim() || defaults;
const autostart = process.argv.includes("--no-autostart") || wanted === "none" ? [] : wanted.split(/[,\s]+/).filter(Boolean);

const store = openStore();
// Manbalar jadvali bo'sh bo'lsa — .env dagi TG_SOURCES dan (collector ham shunday qiladi).
// Bu yerda ham, chunki web'dan birinchi guruh qo'shilsa, jadval bo'sh bo'lmay qoladi va TG_SOURCES unutiladi.
const seeded = store.seedSources((process.env.TG_SOURCES ?? "").split(/[,\s]+/).map(normalizeSourceName).filter(Boolean));
if (seeded) log(`Manbalar: .env dagi TG_SOURCES dan ${seeded} ta guruh olindi`);
// AI kalitlari: .env dagi kalit «AI» bo'limiga bir marta o'zi qo'shiladi (bot ham shunday qiladi)
const { provider, model } = resolveSettings();
if (store.seedAiKeys([{ provider: provider.id, models: [model] }], process.env)) log(`AI: .env dagi kalit ro'yxatga qo'shildi (${model})`);
// Bot va collector loglari shu oynada ham chiqadi: [bot] ..., [collector] ...
const processes = createProcessManager({
  onLine: (name, line) => (line.stream === "err" ? console.error : console.log)(`[${name}] ${line.text}`),
});
const secret = loadSecret();
const sessions = createSessions(secret);
const app = createApp({
  store,
  processes,
  adminDist: path.join(ROOT, "apps/admin/dist"),
  secret,
  sessions,
  publicUrl: PUBLIC_LOCAL_URL,
});
const publicApp = createPublicApp({ store, sessions, scope: routeScopeFrom(), webDist: path.join(ROOT, "apps/web/dist") });

function failed(port, name) {
  return (error) => {
    if (error.code === "EADDRINUSE") log(`${port}-port band (${name}): allaqachon ochiq emasmi? Boshqa port: .env da API_PORT / PUBLIC_PORT`);
    else log(`Server xatosi (${name}): ${error.message}`);
    process.exit(1);
  };
}

// Express 5: app.listen callback'i port band bo'lganda HAM chaqiriladi (xato argument bo'lib keladi).
// Tekshirmasak, "ishga tushdi" deb yozib, keyin "port band" deb yiqiladi. Xatoning o'zini failed() yozadi.
const publicServer = publicApp.listen(PUBLIC_PORT, HOST, (error) => {
  if (error) return;
  const tunnel = process.env.PUBLIC_URL?.trim();
  const internet = tunnel
    ? `  (internetda: ${tunnel})`
    : autostart.includes("tunnel")
      ? "  (internet manzilini [tunnel] chiqaradi)"
      : "  (internetga chiqarish: apps/api/README.md → «Internetga chiqarish»)";
  log(`Haydovchilar web'i: ${PUBLIC_LOCAL_URL}${internet}`);
});
publicServer.on("error", failed(PUBLIC_PORT, "haydovchilar web'i"));

const server = app.listen(PORT, HOST, (error) => {
  // Port band bo'lsa bot va collector'ni yoqmaymiz: ular allaqachon ishlab turgan nusxaniki
  if (error) return;
  log(`Boshqaruv markazi: http://localhost:${PORT}/admin  (to'xtatish: Ctrl+C)`);
  for (const name of autostart) {
    try {
      processes.start(name);
      log(`${name}: ishga tushirildi`);
    } catch (error) {
      log(`${name}: ${error.message}`);
    }
  }
});
server.on("error", failed(PORT, "boshqaruv markazi"));

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log("To'xtatilyapti: bot, collector, nginx va tunnel yumshoq to'xtatiladi...");
  await processes.shutdown();
  server.close();
  publicServer.close();
  store.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
