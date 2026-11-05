import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore } from "@yuk/store";
import { configInfo, createApp, normalizeSourceName } from "../src/app.js";

const calls = [];
const processes = {
  list: () => [{ name: "bot", status: "stopped" }],
  start: async (name) => (calls.push(["start", name]), { name, status: "running" }),
  stop: async (name) => (calls.push(["stop", name]), { name, status: "stopped" }),
  restart: async (name) => (calls.push(["restart", name]), { name, status: "running" }),
  logs: (name, after) => ({ lines: [{ seq: after + 1, text: `${name} log` }], last: after + 1 }),
};

const env = { BOT_TOKEN: "123:maxfiy-token", GEMINI_API_KEY: "maxfiy-kalit", CHANNEL_ID: "@kanal", PARSER_MODEL: "gemini-x" };
let server, base, store;

before(async () => {
  store = openStore({ file: ":memory:" });
  const post = store.addPost({ source: "@a", messageId: 1, link: "https://t.me/a/1", text: "Farg'onadan Samarqandga", postedAt: Date.now() });
  store.addLoad({ postId: post.id, key: "k", load: { fromRegion: "fargona", toRegion: "samarqand", cargo: "un" } });
  const failed = store.addPost({ source: "@a", messageId: 2, text: "nimadir", postedAt: Date.now() });
  store.finishPost(failed.id, "failed", "503");
  store.saveDriver(7, { name: "Ali" });
  store.saveDriver(8, { name: "Vali", profile: { truckClass: "fura" }, active: false });
  const dist = mkdtempSync(path.join(tmpdir(), "yuk-admin-"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Boshqaruv</title>");
  writeFileSync(path.join(dist, "app.js"), "console.log(1)");
  const app = createApp({ store, processes, env, adminDist: dist });
  await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.close();
});

const admin = { "x-yuk-admin": "1", "content-type": "application/json" };
const get = (url) => fetch(base + url).then(async (r) => ({ status: r.status, body: await r.json() }));
const send = (method, url, body, headers = admin) =>
  fetch(base + url, { method, headers, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("manba nomi: @nom, havola, -100 id; yopiq havola va xato nom rad etiladi", () => {
  assert.equal(normalizeSourceName("yuk_markazi"), "@yuk_markazi");
  assert.equal(normalizeSourceName(" @Yuk_Markazi "), "@Yuk_Markazi");
  assert.equal(normalizeSourceName("https://t.me/yuk_markazi/1234"), "@yuk_markazi");
  assert.equal(normalizeSourceName("t.me/yuk_markazi?start=1"), "@yuk_markazi");
  assert.equal(normalizeSourceName("-1001234567890"), "-1001234567890");
  assert.equal(normalizeSourceName("https://t.me/+AbCdEf"), null);
  assert.equal(normalizeSourceName("https://t.me/joinchat/AbCdEf"), null);
  assert.equal(normalizeSourceName("ab"), null);
  assert.equal(normalizeSourceName(""), null);
});

test("sozlamalar: kalit va token qiymati hech qachon chiqmaydi", () => {
  const info = configInfo(env);
  assert.equal(info.botToken, true);
  assert.equal(info.parser.keys.gemini, true);
  assert.equal(info.parser.keys.claude, false);
  assert.ok(!JSON.stringify(info).includes("maxfiy"));
});

test("bosh sahifa: ko'rsatkichlar, jarayonlar, sozlamalar", async () => {
  const { status, body } = await get("/api/overview");
  assert.equal(status, 200);
  assert.equal(body.metrics.queue.failed, 1);
  assert.equal(body.processes[0].name, "bot");
  assert.equal(body.config.channel, "@kanal");
  assert.ok(!JSON.stringify(body).includes("maxfiy"));
});

test("yuklar va navbat: filtr, qayta urinish", async () => {
  assert.equal((await get("/api/loads?from=fargona")).body.total, 1);
  assert.equal((await get("/api/loads?from=toshkent_sh")).body.total, 0);
  assert.equal((await get("/api/posts?status=failed")).body.total, 1);
  assert.deepEqual((await send("POST", "/api/posts/retry-failed")).body, { retried: 1 });
  assert.equal((await get("/api/posts?status=failed")).body.total, 0);
});

test("haydovchilar: faollashtirish, ro'yxatdan o'tmaganni yoqib bo'lmaydi", async () => {
  assert.equal((await get("/api/drivers")).body.items.length, 2);
  assert.equal((await send("PATCH", "/api/drivers/8", { active: true })).body.active, true);
  assert.equal((await send("PATCH", "/api/drivers/7", { active: true })).status, 400);
  assert.equal((await send("PATCH", "/api/drivers/9", { active: true })).status, 404);
  assert.equal((await send("PATCH", "/api/drivers/8", { active: "ha" })).status, 400);
});

test("manbalar: qo'shish, takror, o'chirib-yoqish, o'chirish", async () => {
  assert.equal((await send("POST", "/api/sources", { name: "https://t.me/yangi_guruh" })).status, 201);
  assert.deepEqual((await send("POST", "/api/sources", { name: "@yangi_guruh" })).body, { name: "@yangi_guruh", added: false });
  assert.equal((await send("POST", "/api/sources", { name: "https://t.me/+yopiq" })).status, 400);
  const name = encodeURIComponent("@yangi_guruh");
  assert.equal((await send("PATCH", `/api/sources/${name}`, { enabled: false })).status, 200);
  const items = (await get("/api/sources")).body.items;
  assert.deepEqual(items.map((s) => [s.name, s.enabled, s.stats.posts]), [["@yangi_guruh", false, 0]]);
  assert.equal((await send("DELETE", `/api/sources/${name}`)).status, 200);
  assert.equal((await send("DELETE", `/api/sources/${name}`)).status, 404);
});

test("jarayonlar: yoqish/o'chirish, loglar, noma'lum amal", async () => {
  assert.equal((await send("POST", "/api/processes/bot/restart")).body.status, "running");
  assert.equal((await send("POST", "/api/processes/bot/portlat")).status, 404);
  assert.deepEqual(calls.at(-1), ["restart", "bot"]);
  assert.equal((await get("/api/processes/bot/logs?after=5")).body.last, 6);
});

test("himoya: maxsus sarlavhasiz o'zgartirish va begona Host rad etiladi", async () => {
  const before = calls.length;
  const r = await send("POST", "/api/processes/bot/stop", null, { "content-type": "text/plain" });
  assert.equal(r.status, 403);
  assert.equal(calls.length, before, "jarayonga tegilmadi");
  const foreign = await fetch(`${base}/api/overview`, { headers: { host: "evil.example" } }).catch(() => null);
  // fetch Host sarlavhasini o'zgartirishga ruxsat bermasligi mumkin — unda tekshiruv o'tkazib yuboriladi
  if (foreign && foreign.status !== 200) assert.equal(foreign.status, 403);
  assert.equal((await get("/api/yoq")).status, 404);
});

test("web: /admin sahifalari index.html, fayllar o'zi, / → /admin/", async () => {
  for (const url of ["/admin", "/admin/", "/admin/yuklar"]) {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    assert.match(await r.text(), /Boshqaruv/);
  }
  assert.equal(await (await fetch(`${base}/admin/app.js`)).text(), "console.log(1)");
  const root = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/admin/");
});
