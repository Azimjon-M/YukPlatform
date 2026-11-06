// nginx sozlamasi, dasturlarni topish, tunnel loglari va tunnel manzili — .exe ishga tushirilmaydi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, TUNNEL_URL_KEY, tunnelUrl } from "@yuk/store";
import { configInfo } from "../src/app.js";
import { nginxConfig, nginxPath } from "../src/edge/nginxConfig.js";
import { findCloudflared, findNginx, onPath, ports } from "../src/edge/tools.js";
import { parseTunnelUrl, tunnelLineKind } from "../src/edge/tunnelLog.js";

const conf = nginxConfig({ webDist: "D:\\Yuk\\apps\\web\\dist", mimeTypes: "D:\\Yuk\\tools\\nginx-1.30.6\\conf\\mime.types" });

test("nginx: faqat shu kompyuterda tinglaydi, ilova fayllari va /pub → 3001", () => {
  assert.match(conf, /listen 127\.0\.0\.1:80 default_server;/);
  assert.match(conf, /root "D:\/Yuk\/apps\/web\/dist";/, "Windows yo'li to'g'ri chiziq bilan");
  assert.match(conf, /include "D:\/Yuk\/tools\/nginx-1\.30\.6\/conf\/mime\.types";/);
  assert.match(conf, /server 127\.0\.0\.1:3001;/);
  assert.match(conf, /location \^~ \/pub\/ \{\s+proxy_pass http:\/\/yuk_public;/);
  assert.match(conf, /try_files \$uri \/index\.html =404;/, "ilova ichidagi yo'llar index.html ga tushadi, sikl bo'lmaydi");
  assert.match(conf, /gzip on;/);
});

test("nginx: boshqaruv markaziga yo'l yo'q, Telegram iframe'i to'silmaydi", () => {
  assert.match(conf, /location \^~ \/admin \{ return 404; \}/);
  assert.match(conf, /location \^~ \/api\/ \{ return 404; \}/);
  assert.ok(!conf.includes(":3000"), "3000-port nginx sozlamasida umuman yo'q");
  assert.ok(!/X-Frame-Options/i.test(conf), "Telegram Web Mini App'ni iframe'da ochadi");
  // add_header location ichida meros o'tmaydi — xavfsizlik sarlavhalari har bir statik location'da bor
  assert.equal(conf.match(/X-Content-Type-Options/g).length, 2);
});

test("nginx: port va manzil .env dan", () => {
  const custom = nginxConfig({ port: 8080, publicPort: 4001, webDist: "/srv/web", mimeTypes: "/etc/nginx/mime.types" });
  assert.match(custom, /listen 127\.0\.0\.1:8080 default_server;/);
  assert.match(custom, /server 127\.0\.0\.1:4001;/);
  assert.throws(() => nginxConfig({ webDist: "/srv/web" }), /mimeTypes/);
  assert.equal(nginxPath("C:\\a\\b"), "C:/a/b");
  assert.deepEqual(ports({ NGINX_PORT: "8080" }), { api: 3000, public: 3001, nginx: 8080 });
});

test("nginx.exe: tools/ dagi eng yangi versiya, .env dagi NGINX_EXE ustun", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-tools-"));
  const exe = process.platform === "win32" ? "nginx.exe" : "nginx";
  for (const version of ["nginx-1.28.3", "nginx-1.30.6", "nginx-1.9.9"]) {
    mkdirSync(path.join(dir, version));
    writeFileSync(path.join(dir, version, exe), "");
  }
  assert.equal(findNginx({ env: {}, toolsDir: dir }), path.join(dir, "nginx-1.30.6", exe));
  const own = path.join(dir, "nginx-1.9.9", exe);
  assert.equal(findNginx({ env: { NGINX_EXE: own }, toolsDir: dir }), own);
  assert.equal(findNginx({ env: { NGINX_EXE: path.join(dir, "yoq.exe") }, toolsDir: dir }), null, "noto'g'ri yo'l — topilmadi");
  assert.equal(findNginx({ env: { PATH: "" }, toolsDir: path.join(dir, "yoq") }), null);
});

test("cloudflared: PATH yoki odatiy o'rnatish joyi", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-cf-"));
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  writeFileSync(path.join(dir, exe), "");
  assert.equal(findCloudflared({ env: { PATH: dir }, places: [] }), path.join(dir, exe));
  assert.equal(findCloudflared({ env: { Path: dir }, places: [] }), path.join(dir, exe), "Windows'da o'zgaruvchi Path");
  assert.equal(findCloudflared({ env: { PATH: "" }, places: [path.join(dir, exe)] }), path.join(dir, exe));
  assert.equal(findCloudflared({ env: { PATH: "" }, places: [] }), null);
  assert.equal(onPath(exe, { PATH: `${path.join(dir, "yoq")}${path.delimiter}${dir}` }), path.join(dir, exe));
});

test("cloudflared loglari: manzil, ulanish, ogohlantirish", () => {
  const banner = "2026-11-05T12:00:01Z INF |  https://Moon-River-Blue-Lake.trycloudflare.com                    |";
  assert.equal(parseTunnelUrl(banner), "https://moon-river-blue-lake.trycloudflare.com");
  assert.equal(parseTunnelUrl("2026-11-05T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com..."), null);
  assert.equal(parseTunnelUrl("https://api.trycloudflare.com/tunnel"), null, "API manzili tunnel manzili emas");
  assert.equal(tunnelLineKind("2026-11-05T12:00:03Z INF Registered tunnel connection connIndex=0 location=fra08 protocol=quic"), "ready");
  assert.equal(tunnelLineKind("2026-11-05T12:00:02Z WRN failed to serve quic connection error=timeout"), "problem");
  assert.equal(tunnelLineKind("2026-11-05T12:00:02Z ERR Unable to reach the origin service"), "problem");
  assert.equal(tunnelLineKind("2026-11-05T12:00:00Z INF Starting metrics server on 127.0.0.1:20241/metrics"), null);
});

test("tunnel manzili: faqat tunnel tirik bo'lsa; boshqaruv markazi ko'rsatadi", () => {
  const store = openStore({ file: ":memory:" });
  store.setSetting(TUNNEL_URL_KEY, "https://moon-river.trycloudflare.com");
  assert.equal(tunnelUrl(store, { readLock: () => ({ pid: 1, alive: true }) }), "https://moon-river.trycloudflare.com");
  assert.equal(tunnelUrl(store, { readLock: () => ({ pid: 1, alive: false }) }), null, "majburan o'chgan tunneldan qolgan manzil");
  assert.equal(tunnelUrl(store, { readLock: () => null }), null);
  store.close();

  const info = configInfo({}, { publicUrl: "http://localhost:3001", tunnel: "https://moon-river.trycloudflare.com" });
  assert.equal(info.miniappUrl, "https://moon-river.trycloudflare.com");
  assert.equal(info.miniappFromTunnel, true);
  assert.equal(info.publicTunnel, "https://moon-river.trycloudflare.com");
  const fixed = configInfo({ MINIAPP_URL: "https://app.yukekspert.uz" }, { tunnel: "https://moon-river.trycloudflare.com" });
  assert.equal(fixed.miniappUrl, "https://app.yukekspert.uz", ".env dagi doimiy manzil ustun");
  assert.equal(fixed.miniappFromTunnel, false);
});
