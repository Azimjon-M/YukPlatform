// Loyihaning bitta qismini qayta ishga tushirish (2026-11-17, operator akkaunt orqali tasdiqlangan tuzatishlardan keyin).
//
//   node scripts/restart-part.mjs bot         — faqat bot (boshqaruv markazi API orqali, sayt uzilmaydi)
//   node scripts/restart-part.mjs collector   — faqat collector
//   node scripts/restart-part.mjs web         — Mini App/sayt qayta yig'iladi (nginx dist'ni o'zi beradi, restart kerak emas)
//   node scripts/restart-part.mjs admin       — boshqaruv markazi sahifasi qayta yig'iladi
//   node scripts/restart-part.mjs api         — HAMMASI (API + bot + collector + tunnel): sayt ~20 s uziladi
//
// API so'rovi uchun 2 daqiqalik admin token shu yerda yasaladi (data/secret.key bilan — adminAuth.js bilan bir xil imzo).
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecret } from "@yuk/store";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const part = process.argv[2];
const PROCESS_PARTS = ["bot", "collector", "tunnel", "nginx"];
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

function adminToken() {
  const secret = loadSecret(); // data/secret.key (base64 matn → 32 bayt)
  const key = createHmac("sha256", secret).update("yuk-admin-session-v1").digest();
  const body = Buffer.from(JSON.stringify({ u: "claude-ops", exp: Math.floor(Date.now() / 1000) + 120, r: 0 })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

if (PROCESS_PARTS.includes(part)) {
  const port = process.env.API_PORT || 3000;
  const res = await fetch(`http://127.0.0.1:${port}/api/processes/${part}/restart`, {
    method: "POST",
    headers: { "x-yuk-admin": "1", authorization: `Bearer ${adminToken()}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Xato ${res.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✅ ${part} qayta ishga tushirildi`);
} else if (part === "web") {
  run("npm", ["run", "web:build"]);
  console.log("✅ web qayta yig'ildi");
} else if (part === "admin") {
  run("npm", ["run", "admin:build"]);
  console.log("✅ admin qayta yig'ildi");
} else if (part === "api") {
  run("sudo", ["-n", "supervisorctl", "restart", "yuk"]);
  console.log("✅ butun tizim qayta ishga tushirildi");
} else {
  console.error("Qaysi qism? bot | collector | tunnel | nginx | web | admin | api");
  process.exit(1);
}
