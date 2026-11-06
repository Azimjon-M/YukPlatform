// nginx'ni ishga tushiradi va to'xtatadi. Boshqaruv markazi buni bot va collector kabi alohida jarayon qilib yoqadi
// («Jarayonlar» bo'limi: holati va loglari), yoki qo'lda: npm run nginx (YukPlatform papkasida).
//
// nginx o'z fayllarini data/nginx/ da saqlaydi: nginx.conf (har safar nginxConfig.js dan qayta yoziladi), logs/, temp/.
// Windows'da nginx'ni "nginx -s quit" bilan to'xtatish kerak: oddiy kill faqat bosh jarayonni o'ldiradi, ishchi qoladi va port band bo'lib qoladi.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireRunLock, isAlive } from "@yuk/store";
import { nginxConfig, nginxPath } from "./nginxConfig.js";
import { findNginx, ports, ROOT } from "./tools.js";

const PREFIX = path.join(ROOT, "data", "nginx");
const CONF = path.join(PREFIX, "nginx.conf");
const PID_FILE = path.join(PREFIX, "logs", "nginx.pid");
const ACCESS_LOG = path.join(PREFIX, "logs", "access.log");
const ERROR_LOG = path.join(PREFIX, "logs", "error.log");
const WEB_DIST = path.join(ROOT, "apps", "web", "dist");
const MAX_LOG_BYTES = 20 * 1024 * 1024;

const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const args = (...extra) => ["-p", `${nginxPath(PREFIX)}/`, "-c", nginxPath(CONF), ...extra];
const run = (exe, ...extra) => spawnSync(exe, args(...extra), { cwd: PREFIX, encoding: "utf8", windowsHide: true });

function prepare(exe, port) {
  for (const dir of ["logs", "temp"]) mkdirSync(path.join(PREFIX, dir), { recursive: true });
  // Loglar cheksiz o'smasin: 20 MB dan oshsa, eskisi *.old.log bo'lib qoladi
  for (const file of [ACCESS_LOG, ERROR_LOG]) {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file.slice(0, -4)}.old.log`);
  }
  if (!existsSync(path.join(WEB_DIST, "index.html"))) log("⚠️  apps/web/dist yo'q — avval: npm run web:build (npm start buni o'zi qiladi)");
  const mimeTypes = path.join(path.dirname(exe), "conf", "mime.types");
  writeFileSync(CONF, nginxConfig({ port, publicPort: ports().public, webDist: WEB_DIST, mimeTypes }));
}

// Oldingi safar majburan to'xtatilgan nginx qolgan bo'lsa (port band bo'ladi) — avval uni to'xtatamiz
async function stopLeftover(exe) {
  let pid = null;
  try {
    pid = Number(readFileSync(PID_FILE, "utf8").trim());
  } catch {
    return;
  }
  if (!pid || !isAlive(pid)) return;
  log(`Oldingi nginx (PID ${pid}) hali ishlayapti — to'xtatilyapti`);
  run(exe, "-s", "quit");
  for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100);
  if (isAlive(pid)) run(exe, "-s", "stop");
}

// error.log ga yangi yozilgan qatorlarni har soniyada o'qib, logga chiqaradi (boshqaruv markazi «Jarayonlar» → nginx)
function followErrors(onText) {
  let position = existsSync(ERROR_LOG) ? statSync(ERROR_LOG).size : 0;
  setInterval(() => {
    try {
      const size = statSync(ERROR_LOG).size;
      if (size < position) position = 0;
      if (size === position) return;
      const buffer = Buffer.alloc(size - position);
      const fd = openSync(ERROR_LOG, "r");
      readSync(fd, buffer, 0, buffer.length, position);
      closeSync(fd);
      position = size;
      onText(buffer.toString("utf8"));
    } catch {
      // fayl hali yo'q
    }
  }, 1000).unref();
}

async function main() {
  const exe = findNginx();
  if (!exe) {
    fail("nginx topilmadi. O'rnatish: nginx.org/en/download.html → Stable (Windows zip) → YukPlatform/tools/ ga oching (apps/api/README.md → nginx)");
  }
  try {
    acquireRunLock("nginx");
  } catch (error) {
    fail(error.message);
  }
  const port = ports().nginx;
  prepare(exe, port);
  await stopLeftover(exe);

  const test = run(exe, "-t");
  if (test.status !== 0) fail(`nginx sozlamasida xato:\n${`${test.stderr ?? ""}${test.stdout ?? ""}`.trim()}`);

  const child = spawn(exe, args(), { cwd: PREFIX, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const startedAt = Date.now();
  let errors = "";
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => {
    errors += chunk;
    process.stderr.write(chunk);
  });
  followErrors((text) => {
    errors += text;
    // [notice] — nginx o'z buyruqlari haqida ("signal process started"), foydasiz
    for (const line of text.split(/\r?\n/)) if (line.trim() && !line.includes("[notice]")) console.error(line);
  });

  let stopping = false;
  child.on("exit", (code) => {
    if (stopping) process.exit(0);
    // 10048 — port band, 10013 — Windows bu portga ruxsat bermadi
    if (Date.now() - startedAt < 5000 && /bind\(\)|10048|10013/.test(errors)) {
      fail(`${port}-port band — boshqa dastur ishlatyapti. .env ga boshqa port yozing, masalan: NGINX_PORT=8080`);
    }
    fail(`nginx kutilmaganda to'xtadi (kod ${code})`);
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    run(exe, "-s", "quit");
    // 5 s ichida tugamasa — tezkor to'xtatish
    setTimeout(() => run(exe, "-s", "stop"), 5000).unref();
    setTimeout(() => process.exit(0), 7000).unref();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && stop());

  const where = port === 80 ? "http://localhost" : `http://localhost:${port}`;
  log(`nginx ishga tushdi: ${where} → haydovchilar ilovasi (fayllar: apps/web/dist, /pub → ${ports().public}-port). Boshqaruv markazi bu yerdan ochilmaydi.`);
}

main();
