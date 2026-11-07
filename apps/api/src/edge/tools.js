// Tashqi dasturlarni topish: nginx, cloudflared va tailscale (.exe). Ular npm paketi emas — kompyuterga alohida o'rnatiladi.
//   nginx       — YukPlatform/tools/nginx-<versiya>/nginx.exe (nginx.org dan, README), yoki .env dagi NGINX_EXE, yoki PATH
//   cloudflared — `winget install --id Cloudflare.cloudflared`, yoki .env dagi CLOUDFLARED_EXE, yoki PATH
//   tailscale   — tailscale.com/download (Windows ilovasi), yoki .env dagi TAILSCALE_EXE, yoki PATH
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const TOOLS_DIR = path.join(ROOT, "tools");

const WINDOWS = process.platform === "win32";
const exeName = (name) => (WINDOWS ? `${name}.exe` : name);

// "nginx-1.30.6" → [1, 30, 6] — eng yangi versiya birinchi tanlanadi
const version = (name) => (name.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? [0, 0, 0]).map(Number);
const newerFirst = (a, b) => {
  const [x, y] = [version(a), version(b)];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};

// PATH dagi papkalardan qidirish (Windows'da o'zgaruvchi nomi "Path" bo'lishi mumkin)
export function onPath(file, env = process.env) {
  const value = env.PATH ?? env.Path ?? "";
  for (const dir of value.split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, file))) return path.join(dir, file);
  }
  return null;
}

const fromEnv = (value) => {
  const file = value?.trim();
  return file ? (existsSync(file) ? file : null) : undefined;
};

export function findNginx({ env = process.env, toolsDir = TOOLS_DIR } = {}) {
  const explicit = fromEnv(env.NGINX_EXE);
  if (explicit !== undefined) return explicit;
  const dirs = existsSync(toolsDir) ? readdirSync(toolsDir).filter((name) => /^nginx-\d/.test(name)).sort(newerFirst) : [];
  for (const dir of dirs) {
    const file = path.join(toolsDir, dir, exeName("nginx"));
    if (existsSync(file)) return file;
  }
  return onPath(exeName("nginx"), env);
}

// winget cloudflared'ni "Program Files (x86)\cloudflared" ga qo'yadi, lekin PATH yangi oynalarda ko'rinadi
const CLOUDFLARED_PLACES = WINDOWS
  ? ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"]
  : ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"];

export function findCloudflared({ env = process.env, places = CLOUDFLARED_PLACES } = {}) {
  const explicit = fromEnv(env.CLOUDFLARED_EXE);
  if (explicit !== undefined) return explicit;
  return onPath(exeName("cloudflared"), env) ?? places.find((file) => existsSync(file)) ?? null;
}

// Tailscale Windows ilovasi CLI'ni "Program Files\Tailscale" ga qo'yadi (PATH ga ham qo'shadi, lekin yangi oynalarda)
const TAILSCALE_PLACES = WINDOWS
  ? ["C:\\Program Files\\Tailscale\\tailscale.exe", "C:\\Program Files (x86)\\Tailscale\\tailscale.exe"]
  : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

export function findTailscale({ env = process.env, places = TAILSCALE_PLACES } = {}) {
  const explicit = fromEnv(env.TAILSCALE_EXE);
  if (explicit !== undefined) return explicit;
  return onPath(exeName("tailscale"), env) ?? places.find((file) => existsSync(file)) ?? null;
}

// Portlar .env dan (server.js, nginx va tunnel bir xil o'qiydi)
export const ports = (env = process.env) => ({
  api: Number(env.API_PORT) || 3000,
  public: Number(env.PUBLIC_PORT) || 3001,
  nginx: Number(env.NGINX_PORT) || 80,
});
