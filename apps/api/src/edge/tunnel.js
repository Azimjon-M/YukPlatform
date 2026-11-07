// Tunnel: haydovchilar ilovasini internetga chiqaradi — routerda port ochish shart emas, dastur o'zi tashqariga ulanadi.
// Ikki xil (tanlov — .env dagi TUNNEL, standart auto: Tailscale tayyor bo'lsa — u, bo'lmasa — Cloudflare):
//   Tailscale Funnel — DOIMIY manzil: internet → https://<kompyuter>.<tarmoq>.ts.net → Tailscale → shu kompyuter → nginx (80).
//                      Bepul (shaxsiy, notijorat), Tailscale akkaunti kerak. Manzil o'zgarmaydi — chatdagi eski tugmalar ishlayveradi.
//   Cloudflare       — tekin «quick tunnel», akkauntsiz: internet → https://....trycloudflare.com → cloudflared → nginx (80).
//                      Manzil har ishga tushganda YANGI — chatdagi eski Mini App tugmalari 1033 beradi, toki bot yangi xabar yubormaguncha.
// Ikkalasida ham manzil bazaga yoziladi (@yuk/store tunnelUrl) va bot Mini App tugmasini shu manzil bilan beradi.
// Boshqaruv markazi buni bot va collector kabi yoqadi («Jarayonlar» → Tunnel), yoki qo'lda: npm run tunnel.
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { acquireRunLock, openStore, TUNNEL_URL_KEY } from "@yuk/store";
import { findCloudflared, findNginx, findTailscale, ports } from "./tools.js";
import { chooseTunnel, funnelLine, parseTunnelUrl, tailscaleStatus, tunnelLineKind } from "./tunnelLog.js";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// Qayerga ulanadi: .env dagi TUNNEL_TARGET, bo'lmasa nginx (o'rnatilgan bo'lsa), bo'lmasa to'g'ridan-to'g'ri haydovchilar serveri.
// Boshqaruv markazi (3000) HECH QACHON.
function target(env = process.env) {
  if (env.TUNNEL_TARGET?.trim()) return env.TUNNEL_TARGET.trim();
  return findNginx({ env }) ? `http://127.0.0.1:${ports(env).nginx}` : `http://127.0.0.1:${ports(env).public}`;
}

// Tailscale ulanganmi va manzili qanday. Kompyuter endi yoqilgan bo'lsa xizmat hali «Starting» bo'lishi mumkin — ~12 s kutamiz
async function tailscaleState(exe) {
  for (let attempt = 1; ; attempt++) {
    let status = { state: null, url: null };
    try {
      const { stdout } = await run(exe, ["status", "--json"], { timeout: 10_000, windowsHide: true, maxBuffer: 16 << 20 });
      status = tailscaleStatus(stdout);
    } catch (error) {
      if (error.stdout) status = tailscaleStatus(error.stdout); // kirilmagan bo'lsa ham JSON beradi, faqat kodi 1
    }
    const waiting = status.state === null || status.state === "Starting" || status.state === "NoState";
    if (!waiting || attempt >= 5) return status;
    await sleep(3000);
  }
}

// Funnel sozlamasini tozalash (shu kompyuterdagi tailscale serve/funnel — faqat shu loyihaniki).
// Oldingi ishga tushishdan (majburan o'chirilgan) qolgan bo'lsa, yangisi «band» demasin; to'xtaganda — internetdan yopiladi
const resetFunnel = (exe) => (exe ? run(exe, ["funnel", "reset"], { timeout: 10_000, windowsHide: true }).catch(() => {}) : Promise.resolve());

function launch(exe, args, onLine) {
  const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  createInterface({ input: child.stdout }).on("line", onLine);
  createInterface({ input: child.stderr }).on("line", onLine);
  return child;
}

async function main() {
  const to = target();
  if (new URL(to).port === String(ports().api)) fail(`TUNNEL_TARGET boshqaruv markazi porti (${ports().api}) — uni internetga chiqarib bo'lmaydi`);
  const mode = process.env.TUNNEL;
  const tailscale = findTailscale();
  const cloudflared = findCloudflared();
  const status = tailscale ? await tailscaleState(tailscale) : null;
  const choice = chooseTunnel({ mode, tailscale, cloudflared, status });
  if (!choice.use) fail(choice.error);
  // auto rejimda Funnel ishlamay qolsa (yoqilmagan, to'xtadi) — Cloudflare'ga o'tamiz; TUNNEL=tailscale bo'lsa — yo'q
  const canFallBack = choice.use === "tailscale" && Boolean(cloudflared) && String(mode ?? "").trim().toLowerCase() !== "tailscale";

  try {
    acquireRunLock("tunnel");
  } catch (error) {
    fail(error.message);
  }
  const store = openStore();
  const setUrl = (url) => store.setSetting(TUNNEL_URL_KEY, url);
  setUrl(null); // oldingi (eski) manzil ishlatilmasin

  let child = null;
  let current = null; // "tailscale" | "switching" (Cloudflare'ga o'tilyapti) | "cloudflare"
  let stopping = false;
  let cleanup = Promise.resolve();
  const finish = (code) => {
    setUrl(null);
    store.close();
    process.exit(code);
  };

  // Har bir dastur uchun: to'xtatganimizda — tinch chiqamiz, o'zi to'xtasa — xato (boshqaruv markazi 10 s dan keyin qayta yoqadi)
  const watch = (proc, name, onUnexpected) => {
    proc.on("error", (error) => {
      if (proc !== child) return;
      console.error(`${name} ishga tushmadi: ${error.message}`);
      finish(1);
    });
    proc.on("exit", (code) => {
      if (proc !== child) return; // almashtirilgan eski jarayon
      if (stopping) return void cleanup.finally(() => finish(0));
      if (onUnexpected?.(code)) return;
      console.error(`${name} kutilmaganda to'xtadi (kod ${code})`);
      finish(1);
    });
  };

  function startCloudflared() {
    current = "cloudflare";
    log(`Tunnel ochilyapti (Cloudflare, manzil har safar yangi): internet → ${to} ...`);
    let url = null;
    let ready = false;
    child = launch(cloudflared, ["tunnel", "--no-autoupdate", "--url", to], (line) => {
      const found = parseTunnelUrl(line);
      if (found && found !== url) {
        url = found;
        setUrl(url);
        log(`🌐 Manzil: ${url}`);
      }
      const kind = tunnelLineKind(line);
      if (kind === "ready" && !ready) {
        ready = true;
        log(`✅ Tunnel ulandi. Haydovchilar ilovasi internetda: ${url ?? "(manzil kutilmoqda)"} — bot Mini App tugmasini shu manzil bilan beradi`);
      } else if (kind === "problem") {
        console.error(line.trim());
      }
    });
    watch(child, "cloudflared");
  }

  // Funnel ishlamadi — Cloudflare'ga o'tamiz (faqat auto rejimda)
  function fallBack(reason) {
    if (stopping || current !== "tailscale" || !canFallBack) return false;
    log(`${reason} — Cloudflare tunneliga o'tamiz (manzil har ishga tushganda yangi bo'ladi)`);
    current = "switching"; // bir necha qator / exit kelsa ham bir marta almashadi
    const old = child;
    child = null;
    old?.kill();
    setUrl(null);
    resetFunnel(tailscale).then(() => !stopping && startCloudflared());
    return true;
  }

  async function startFunnel() {
    current = "tailscale";
    log(`Tunnel ochilyapti (Tailscale Funnel, doimiy manzil): internet → ${status.url} → ${to} ...`);
    await resetFunnel(tailscale);
    if (stopping) return;
    let ready = false;
    child = launch(tailscale, ["funnel", to], (line) => {
      const { kind, link } = funnelLine(line);
      if (kind === "ready" && !ready) {
        ready = true;
        setUrl(status.url);
        log(`🌐 Manzil (doimiy): ${status.url}`);
        log(`✅ Tunnel ulandi. Haydovchilar ilovasi internetda: ${status.url} — bot Mini App tugmasini shu manzil bilan beradi`);
      } else if (kind === "enable") {
        console.error(`Tailscale: Funnel (yoki HTTPS) tarmog'ingizda hali yoqilmagan. Bir marta yoqish uchun oching: ${link}`);
        fallBack("Funnel yoqilmagan");
      } else if (kind === "problem") {
        console.error(line.trim());
      }
    });
    watch(child, "tailscale funnel", (code) => fallBack(`tailscale funnel to'xtadi (kod ${code})`));
  }

  const stop = () => {
    if (stopping) return;
    stopping = true;
    log("Tunnel yopilyapti...");
    setUrl(null);
    child?.kill();
    if (current !== "cloudflare") cleanup = resetFunnel(tailscale); // Funnel internetdan yopilsin
    if (!child) cleanup.finally(() => finish(0));
    setTimeout(() => finish(0), 8000).unref();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && stop());

  if (choice.note) log(choice.note);
  if (choice.use === "tailscale") await startFunnel();
  else startCloudflared();
}

main().catch((error) => fail(`Tunnel ishga tushmadi: ${error.message}`));
