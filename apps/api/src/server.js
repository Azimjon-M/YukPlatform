// Boshqaruv markazi: API + web + bot va collector'ni boshqarish. Ishga tushirish (YukPlatform papkasida):
//   npm start        — web'ni yig'adi, shu serverni ochadi, bot va collector'ni o'zi yoqadi → http://localhost:3000/admin
//   npm run api      — faqat API (bot va collector'ni yoqmaydi), web'dan yoqasiz; web dasturlash rejimida: `npm run admin`
// Sozlamalar (.env, ixtiyoriy): API_PORT=3000, AUTOSTART=bot,collector (none — hech birini yoqmaydi)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "@yuk/store";
import { createApp, normalizeSourceName } from "./app.js";
import { createProcessManager } from "./processes.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = Number(process.env.API_PORT) || 3000;
const HOST = "127.0.0.1"; // faqat shu kompyuter: internetdan va tarmoqdan ochilmaydi

const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);

// AUTOSTART bo'sh yoki yozilmagan — ikkalasi ham; "none" — hech biri
const wanted = process.env.AUTOSTART?.trim() || "bot,collector";
const autostart = process.argv.includes("--no-autostart") || wanted === "none" ? [] : wanted.split(/[,\s]+/).filter(Boolean);

const store = openStore();
// Manbalar jadvali bo'sh bo'lsa — .env dagi TG_SOURCES dan (collector ham shunday qiladi).
// Bu yerda ham, chunki web'dan birinchi guruh qo'shilsa, jadval bo'sh bo'lmay qoladi va TG_SOURCES unutiladi.
const seeded = store.seedSources((process.env.TG_SOURCES ?? "").split(/[,\s]+/).map(normalizeSourceName).filter(Boolean));
if (seeded) log(`Manbalar: .env dagi TG_SOURCES dan ${seeded} ta guruh olindi`);
// Bot va collector loglari shu oynada ham chiqadi: [bot] ..., [collector] ...
const processes = createProcessManager({
  onLine: (name, line) => (line.stream === "err" ? console.error : console.log)(`[${name}] ${line.text}`),
});
const app = createApp({ store, processes, adminDist: path.join(ROOT, "apps/admin/dist") });

const server = app.listen(PORT, HOST, () => {
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

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") log(`${PORT}-port band: boshqaruv markazi allaqachon ochiq emasmi? Boshqa port: .env ga API_PORT=3001`);
  else log(`Server xatosi: ${error.message}`);
  process.exit(1);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log("To'xtatilyapti: bot va collector yumshoq to'xtatiladi...");
  await processes.shutdown();
  server.close();
  store.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
