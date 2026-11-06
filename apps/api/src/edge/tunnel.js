// Tunnel: haydovchilar ilovasini internetga chiqaradi (Cloudflare'ning tekin «quick tunnel»i, akkaunt kerak emas).
// cloudflared shu kompyuterdan Cloudflare'ga o'zi ulanadi va https manzil oladi — routerda port ochish shart emas.
//   internet → https://....trycloudflare.com → Cloudflare → cloudflared → nginx (80) → ilova va /pub
// Boshqaruv markazi buni bot va collector kabi yoqadi («Jarayonlar» → Tunnel), yoki qo'lda: npm run tunnel.
//
// Manzil har ishga tushganda YANGI bo'ladi. Shuning uchun u bazaga yoziladi (@yuk/store tunnelUrl) va bot
// Mini App tugmasini o'sha manzil bilan beradi. Doimiy manzil uchun — o'z domeni (apps/api/README.md).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { acquireRunLock, openStore, TUNNEL_URL_KEY } from "@yuk/store";
import { findCloudflared, findNginx, ports } from "./tools.js";
import { parseTunnelUrl, tunnelLineKind } from "./tunnelLog.js";

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

function main() {
  const exe = findCloudflared();
  if (!exe) fail("cloudflared topilmadi. O'rnatish (bir marta): winget install --id Cloudflare.cloudflared");
  const to = target();
  if (new URL(to).port === String(ports().api)) fail(`TUNNEL_TARGET boshqaruv markazi porti (${ports().api}) — uni internetga chiqarib bo'lmaydi`);
  try {
    acquireRunLock("tunnel");
  } catch (error) {
    fail(error.message);
  }
  const store = openStore();
  const setUrl = (url) => store.setSetting(TUNNEL_URL_KEY, url);
  setUrl(null); // oldingi (eski) manzil ishlatilmasin

  log(`Tunnel ochilyapti: internet → ${to} ...`);
  const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", to], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let url = null;
  let ready = false;
  const onLine = (line) => {
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
  };
  createInterface({ input: child.stdout }).on("line", onLine);
  createInterface({ input: child.stderr }).on("line", onLine);

  let stopping = false;
  const finish = (code) => {
    setUrl(null);
    store.close();
    process.exit(code);
  };
  child.on("error", (error) => {
    console.error(`cloudflared ishga tushmadi: ${error.message}`);
    finish(1);
  });
  child.on("exit", (code) => {
    if (stopping) return finish(0);
    console.error(`cloudflared kutilmaganda to'xtadi (kod ${code})`);
    finish(1);
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    log("Tunnel yopilyapti...");
    setUrl(null);
    child.kill();
    setTimeout(() => finish(0), 5000).unref();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && stop());
}

main();
