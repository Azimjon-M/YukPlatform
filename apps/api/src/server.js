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
import { createParserPool, createVoiceTranscriber, envSeedEntries, parseByRules, resolveSettings } from "@yuk/parser";
import { devAutostart, isDevMode, routeScopeFrom } from "@yuk/shared";
import { APK_DIR, DEFAULT_DB_FILE, readRelease, createCallLinks, loadSecret, openStore } from "@yuk/store";
import { createApp, normalizeSourceName } from "./app.js";
import { createErrorLog } from "./errorLog.js";
import { createProcessManager } from "./processes.js";
import { createPublicApp } from "./public.js";
import { createAvatars } from "./avatars.js";
import { isAdmin, parseAdminIds } from "@yuk/shared";
import { chatParser } from "./loadChat.js";
import { createFeedList } from "./feedList.js";
import { FCM_KEY_FILE, createFcm, loadFcmKey } from "./fcm.js";
import { createPusher, createReleaseNotifier } from "./push.js";
import { createBotMessenger, createMemberCheck, readChats } from "./botMessage.js";
import { findCloudflared, findNginx, findTailscale } from "./edge/tools.js";
import { createSessions } from "./telegramAuth.js";
import { createTgLogin } from "./tgLogin.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = Number(process.env.API_PORT) || 3000;
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT) || 3001;
const HOST = "127.0.0.1"; // faqat shu kompyuter: internetdan va tarmoqdan ochilmaydi (tunnel ham shu yerga ulanadi)
const PUBLIC_LOCAL_URL = `http://localhost:${PUBLIC_PORT}`;

const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);

// AUTOSTART bo'sh yoki yozilmagan — hammasi (nginx va tunnel — kompyuterda o'rnatilgan bo'lsa); "none" — hech biri
const defaults = [findNginx() && "nginx", (findCloudflared() || findTailscale()) && "tunnel", "bot", "collector"].filter(Boolean).join(",");
const wanted = process.env.AUTOSTART?.trim() || defaults;
// Dasturlash rejimi (.env YUK_ENV=dev, @yuk/shared devMode.js): collector o'zi yoqilmaydi — server o'sha akkaunt bilan o'qiyapti
const autostart = process.argv.includes("--no-autostart") || wanted === "none" ? [] : devAutostart(wanted.split(/[,\s]+/).filter(Boolean));
if (isDevMode()) {
  log(`🧪 Dasturlash rejimi (YUK_ENV=${process.env.YUK_ENV.trim()}): baza ${path.relative(ROOT, DEFAULT_DB_FILE)}, prod bot bilan bot ishga tushmaydi, collector ${autostart.includes("collector") ? "alohida akkaunt bilan (DEV_COLLECTOR=1)" : "o'chiq"}`);
}

const store = openStore();

// Qidiruv ustuni (posts.text_fold, kirill/lotin farqisiz) — eski e'lonlar fonda, eng yangisidan, soniyasiga 5 000 tadan
// to'ldiriladi (2026-11-16; har bo'lak ~0,1 s — server qotmaydi). Tugagach to'xtaydi
const foldTimer = setInterval(() => {
  try {
    if (store.backfillTextFold(5000) === 0) {
      clearInterval(foldTimer);
      log("Qidiruv ustuni tayyor: hamma e'lonlar kirill/lotin farqisiz qidiriladi");
    }
  } catch (error) {
    log(`Qidiruv ustunini to'ldirishda xato: ${error.message}`);
    clearInterval(foldTimer);
  }
}, 1000);
foldTimer.unref();
// Manbalar jadvali bo'sh bo'lsa — .env dagi TG_SOURCES dan (collector ham shunday qiladi).
// Bu yerda ham, chunki web'dan birinchi guruh qo'shilsa, jadval bo'sh bo'lmay qoladi va TG_SOURCES unutiladi.
const seeded = store.seedSources((process.env.TG_SOURCES ?? "").split(/[,\s]+/).map(normalizeSourceName).filter(Boolean));
if (seeded) log(`Manbalar: .env dagi TG_SOURCES dan ${seeded} ta guruh olindi`);
// AI kalitlari: .env dagi kalitlar (GEMINI_API_KEY, ONEPRO_API_KEY) «AI» bo'limiga bir marta o'zi qo'shiladi (bot ham shunday qiladi)
const seededAi = store.seedAiKeys(envSeedEntries(resolveSettings()), process.env);
if (seededAi) log(`AI: .env dagi ${seededAi} ta kalit ro'yxatga qo'shildi`);
// Xatolar jurnali — boshqaruv markazining «Xatolar» bo'limi (errorLog.js): jarayonlar loglaridan va ikkala serverdan.
// Jurnalning o'zi xotirada, «E'tiborsiz qoldirish» qoidalari esa bazada (settings.errors_ignored) — server qayta yoqilsa ham qoladi
const IGNORED_SETTING = "errors_ignored";
function readIgnored() {
  try {
    return JSON.parse(store.getSetting(IGNORED_SETTING) ?? "[]");
  } catch {
    return [];
  }
}
const errors = createErrorLog({
  ignored: readIgnored(),
  onIgnoredChange: (rules) => store.setSetting(IGNORED_SETTING, JSON.stringify(rules)),
});
// Bot va collector loglari shu oynada ham chiqadi: [bot] ..., [collector] ... Xato qatorlari jurnalga ham yoziladi
const processes = createProcessManager({
  onLine: (name, line) => {
    (line.stream === "err" ? console.error : console.log)(`[${name}] ${line.text}`);
    errors.fromProcessLine(name, line);
  },
});
const secret = loadSecret();
const sessions = createSessions(secret);
// Guruh/foydalanuvchi rasmlari — boshqaruv markazi (/api/avatar) va Mini App (/pub/avatar) uchun bitta (avatars.js)
const avatars = createAvatars({ token: process.env.BOT_TOKEN?.trim() });
const app = createApp({
  store,
  avatars,
  processes,
  adminDist: path.join(ROOT, "apps/admin/dist"),
  secret,
  sessions,
  publicUrl: PUBLIC_LOCAL_URL,
  errors,
});
// Collector uchun Telegram akkaunt qo'shish — Mini App «🛠 Boshqaruv» dan (raqam → kod → 2FA; alohida jarayonda)
const tgLogin = createTgLogin({ store, log });
// Ilovadagi «📝 E'lon berish» chati (loadChat.js): yuk beruvchi matnini tushunish — botdagi «📦 Yuk berish» bilan bir
// xil yo'l: avval qoidaviy parser (~2 ms), tushunmasa — bo'sh AI ulanishi (20 s gacha kutadi). AI ulanishlari ro'yxati
// boshqaruv markazidagi kalitlar; hovuz birinchi kerak bo'lganda yaratiladi (ilova chati kam ishlatiladi)
let chatPool = null;
// Qaysi tartibda — loadChat.js chatParser (algoritm → kerak bo'lsa AI → bo'lmasa algoritmning qisman natijasi)
async function aiParse(text) {
  // AI — faqat ishonchli provayderlar (OpenRouter/Groq bepul modellari tez-tez yo'qoladi, 2026-11-25 «model topilmadi»)
  chatPool ??= createParserPool({
    connections: () => store.aiConnections({ secret, env: process.env }).filter((c) => c.provider === "gemini" || c.provider === "onepro"),
    onState: () => {},
  });
  const until = Date.now() + 20_000;
  let lease = chatPool.acquire();
  while (!lease && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    lease = chatPool.acquire();
  }
  if (!lease) return null;
  try {
    return await lease.parser.parse(text);
  } catch (error) {
    lease.fail(error);
    log(`Ilova «E'lon berish»: AI xatosi — ${lease.describe(error)}`);
    return null;
  } finally {
    lease.release({ posts: 1 });
  }
}
const parseLoad = chatParser({ rules: parseByRules, ai: aiParse });

// Ilova «E'lon berish» ovozli xabari → matn (@yuk/parser createVoiceTranscriber — botdagi «📦 Yuk berish» bilan bir xil):
// avval faqat o'girish modellari, keyin boshqaruv markazidagi Gemini ulanishlari; xato bergani dam oladi. → matn | null
const transcribeVoice = createVoiceTranscriber({ connections: () => store.aiConnections({ secret, env: process.env }), log, label: "Ilova ovozli e'loni" });

const publicApp = createPublicApp({
  store,
  avatars,
  sessions,
  tgLogin,
  calls: createCallLinks(secret), // «📞 Telefon qilish» sahifasi (/pub/call) — bot bilan bir kalit
  scope: routeScopeFrom(),
  webDist: path.join(ROOT, "apps/web/dist"),
  apkDir: APK_DIR, // Android ilova (@yuk/store appRelease.js)
  parseLoad, // ilova «📝 E'lon berish» chati
  transcribeVoice, // … va uning ovozli xabari
  // Ilovaga kod yuborishdan oldin a'zolik — Telegram'dan hozir (bazadagi eskirgan bo'lishi mumkin)
  memberCheck: createMemberCheck(process.env.BOT_TOKEN?.trim(), () => store.requiredChatRefs(readChats(process.env.REQUIRED_CHATS))),
  notify: createBotMessenger(process.env.BOT_TOKEN?.trim()), // web'dan hisob o'chirilsa — chatdagi menyuni olib tashlash
  errors,
});

// Ilova bildirishnomalari (push.js): Firebase kaliti bo'lsa — har 5 soniyada yangi e'lonlar telefonlarga. Kalit fayli
// keyin qo'yilsa ham server qayta yoqilmasdan, bir daqiqa ichida o'zi ulanadi
let pusher = null;
let fcmNote = "";
function startPush() {
  try {
    const send = createFcm(loadFcmKey());
    if (!send) {
      if (!fcmNote) log(`Ilova bildirishnomalari: o'chiq — Firebase kaliti yo'q (${FCM_KEY_FILE}), har daqiqada tekshiriladi`);
      fcmNote = "missing";
      return;
    }
    // Majburiy a'zolik: kanal/guruhdan chiqqanga bildirishnoma ham yo'q (bazadagi holat — public.js membershipOf bilan bir xil)
    const pushAdmins = parseAdminIds(process.env.ADMIN_IDS);
    const memberOk = (driver) =>
      driver.subOk !== false || isAdmin(driver, pushAdmins) || !store.requiredChatRefs(readChats(process.env.REQUIRED_CHATS)).length;
    pusher = createPusher({ store, feedList: createFeedList({ store }), send, log, memberOk });
    pusher.start();
    createReleaseNotifier({ store, readRelease: () => readRelease(APK_DIR), send, log }).start(); // yangi APK → «yangilang»
    clearInterval(pushWatch);
    log("Ilova bildirishnomalari: yoqildi (FCM)");
  } catch (error) {
    if (fcmNote !== error.message) log(`Ilova bildirishnomalari: o'chiq — ${error.message}`);
    fcmNote = error.message;
  }
}
const pushWatch = setInterval(startPush, 60_000);
pushWatch.unref();
startPush();

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
      // ensure: terminalda ishlayotgan nusxa bo'lsa — kutadi va u yopilishi bilan o'zi yoqadi (processes.js watch)
      const state = processes.ensure(name);
      log(state.status === "external"
        ? `${name}: terminalda ishlayotgan nusxa bor (PID ${state.pid}) — u yopilsa, shu yerdan o'zi yoqiladi`
        : `${name}: ishga tushirildi`);
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
  tgLogin.close();
  clearInterval(pushWatch);
  pusher?.stop();
  app.locals.live.close();
  server.close();
  publicServer.close();
  store.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
