import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { createPublicApp, createRateLimiter } from "../src/public.js";
import { createSessions, signLoginWidget, signWebAppData, verifyLoginWidget, verifyWebAppData } from "../src/telegramAuth.js";

const BOT_TOKEN = "123456:TEST-token-faqat-testda";
const NOW = 1_800_000_000_000;
const nowS = Math.floor(NOW / 1000);
const USER = { id: 555, first_name: "Ali", last_name: "Valiyev", username: "ali_haydovchi" };

// --- Telegram imzosi ---
test("Mini App initData: to'g'ri imzo o'tadi, o'zgartirilgani va eskisi o'tmaydi", () => {
  const initData = signWebAppData({ auth_date: nowS - 60, query_id: "AAE", user: USER }, BOT_TOKEN);
  const ok = verifyWebAppData(initData, BOT_TOKEN, { now: NOW });
  assert.deepEqual(ok.user, { id: 555, name: "Ali Valiyev", username: "ali_haydovchi", photoUrl: null });

  // id'ni almashtirib ko'rish — imzo buziladi
  const forged = initData.replace(encodeURIComponent('"id":555'), encodeURIComponent('"id":777'));
  assert.notEqual(forged, initData);
  assert.match(verifyWebAppData(forged, BOT_TOKEN, { now: NOW }).error, /imzo/);
  // boshqa bot tokeni bilan imzolangan
  assert.match(verifyWebAppData(initData, "999:boshqa-bot", { now: NOW }).error, /imzo/);
  // 2 kunlik
  const old = signWebAppData({ auth_date: nowS - 2 * 86400, user: USER }, BOT_TOKEN);
  assert.match(verifyWebAppData(old, BOT_TOKEN, { now: NOW }).error, /muddati/);
  assert.match(verifyWebAppData("", BOT_TOKEN, { now: NOW }).error, /kelmadi/);
});

test("Mini App initData: signature maydoni bilan ham tekshiriladi", () => {
  const initData = signWebAppData({ auth_date: nowS, signature: "abc", user: USER }, BOT_TOKEN);
  assert.equal(verifyWebAppData(initData, BOT_TOKEN, { now: NOW }).user.id, 555);
});

test("sayt vidjeti: to'g'ri imzo o'tadi, o'zgartirilgani o'tmaydi", () => {
  const data = signLoginWidget({ id: 555, first_name: "Ali", username: "ali_haydovchi", auth_date: nowS }, BOT_TOKEN);
  assert.equal(verifyLoginWidget(data, BOT_TOKEN, { now: NOW }).user.id, 555);
  assert.match(verifyLoginWidget({ ...data, id: 777 }, BOT_TOKEN, { now: NOW }).error, /imzo/);
  assert.match(verifyLoginWidget({ ...data, hash: "00" }, BOT_TOKEN, { now: NOW }).error, /imzo/);
  // Bot API'dagi Mini App kaliti bilan imzolangan narsa vidjet sifatida o'tmasligi kerak (kalitlar har xil)
  const asWebApp = Object.fromEntries(new URLSearchParams(signWebAppData({ auth_date: nowS, id: 555 }, BOT_TOKEN)));
  assert.match(verifyLoginWidget(asWebApp, BOT_TOKEN, { now: NOW }).error, /imzo/);
});

test("sessiya tokeni: o'zimiz bergani o'tadi; buzilgani, boshqa kalitniki va muddati o'tgani o'tmaydi", () => {
  let time = NOW;
  const secret = randomBytes(32);
  const sessions = createSessions(secret, { now: () => time });
  const token = sessions.issue(555);
  assert.equal(sessions.verify(token), 555);
  const [body, signature] = token.split(".");
  const other = Buffer.from(JSON.stringify({ uid: 777, exp: nowS + 999 })).toString("base64url");
  assert.equal(sessions.verify(`${other}.${signature}`), null);
  assert.equal(sessions.verify(`${body}.${signature.slice(0, -2)}xx`), null);
  assert.equal(createSessions(randomBytes(32), { now: () => time }).verify(token), null);
  assert.equal(sessions.verify("nimadir"), null);
  assert.equal(sessions.verify(undefined), null);
  time += 31 * 86400 * 1000;
  assert.equal(sessions.verify(token), null);
});

test("cheklov: oynada limitdan ortig'i rad etiladi, keyingi oynada yana ruxsat", () => {
  let time = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("b")], [true, true, false, true]);
  time = 1000;
  assert.equal(allow("a"), true);
});

// --- Server ---
let server, base, store, sessions, adminServer, adminBase;
const env = { BOT_TOKEN };
const HOUR = 3600 * 1000;

function addLoad(id, load, { hoursAgo = 1 } = {}) {
  const post = store.addPost({ source: "@yuk", messageId: id, link: `https://t.me/yuk/${id}`, text: `e'lon ${id}`, postedAt: NOW - hoursAgo * HOUR });
  return store.addLoad({ postId: post.id, key: `k${id}`, load });
}

before(async () => {
  let time = NOW - 2 * HOUR;
  store = openStore({ file: ":memory:", now: () => time });
  addLoad(1, { fromRegion: "fargona", fromCity: "Qo'qon", toRegion: "toshkent_sh", toCity: "Toshkent", truckClass: "fura", weightT: 22, phones: ["+998901112233"] });
  addLoad(2, { fromRegion: "andijon", toRegion: "samarqand", truckClass: "isuzu", weightT: 5 });
  // doiradan tashqarida (qoshni): Rossiya — ko'rsatilmaydi
  addLoad(3, { fromRegion: "toshkent_sh", toRegion: "xorij", toCountry: "Rossiya", toCity: "Moskva", truckClass: "fura" });
  addLoad(4, { fromRegion: "toshkent_sh", fromCity: "Toshkent", toRegion: "xorij", toCountry: "Qozog'iston", toCity: "Olmaota", truckClass: "fura", weightT: 20 });
  time = NOW;
  store.setSetting("bot_username", "Yuk_Ekspert_agent");
  sessions = createSessions(randomBytes(32), { now: () => NOW });

  const dist = mkdtempSync(path.join(tmpdir(), "yuk-web-"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Yuk Ekspert</title>");
  const app = createPublicApp({ store, env, sessions, scope: "qoshni", webDist: dist, now: () => NOW });
  await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;

  const processes = { list: () => [], logs: () => ({ lines: [], last: 0 }) };
  const admin = createApp({ store, processes, env, sessions, publicUrl: "http://localhost:3001" });
  await new Promise((resolve) => (adminServer = admin.listen(0, "127.0.0.1", resolve)));
  adminBase = `http://127.0.0.1:${adminServer.address().port}`;
});

after(() => {
  server.close();
  adminServer.close();
  store.close();
});

async function call(method, url, { token, body, headers = {} } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
}

async function login() {
  const initData = signWebAppData({ auth_date: nowS - 10, user: USER }, BOT_TOKEN);
  const { status, body } = await call("POST", "/pub/auth", { body: { initData } });
  assert.equal(status, 200);
  return body;
}

test("config: bot username va doira; CORS va OPTIONS", async () => {
  const { status, body, headers } = await call("GET", "/pub/config");
  assert.equal(status, 200);
  assert.deepEqual(body, { botUsername: "Yuk_Ekspert_agent", scope: "qoshni", login: true });
  assert.equal(headers.get("access-control-allow-origin"), "*");
  assert.equal((await call("OPTIONS", "/pub/loads")).status, 204);
});

test("kirish: Mini App initData → token; haydovchi bazaga yoziladi; xato imzo — 401", async () => {
  const { token, me } = await login();
  assert.ok(token);
  assert.deepEqual(me, { chatId: 555, name: "Ali Valiyev", username: "ali_haydovchi", profile: null, active: false });
  assert.equal(store.getDriver(555).name, "Ali Valiyev");

  const bad = await call("POST", "/pub/auth", { body: { initData: "user=%7B%22id%22%3A1%7D&auth_date=1&hash=00" } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "auth");
  assert.equal((await call("POST", "/pub/auth", { body: {} })).status, 401);

  const widget = signLoginWidget({ id: 556, first_name: "Vali", auth_date: nowS }, BOT_TOKEN);
  const viaSite = await call("POST", "/pub/auth", { body: { widget } });
  assert.equal(viaSite.status, 200);
  assert.equal(viaSite.body.me.chatId, 556);
});

test("tokensiz yoki buzilgan token bilan — 401", async () => {
  assert.equal((await call("GET", "/pub/me")).status, 401);
  assert.equal((await call("GET", "/pub/loads", { token: "x.y" })).status, 401);
  // haqiqiy imzo, lekin bazada yo'q haydovchi
  assert.equal((await call("GET", "/pub/me", { token: sessions.issue(999) })).status, 401);
});

test("yuklar: hammasi — faqat doiradagilar, eng yangisi birinchi, telefon bilan; joy filtri", async () => {
  const { token } = await login();
  const all = await call("GET", "/pub/loads?view=all", { token });
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3); // Rossiya yo'q
  assert.deepEqual(all.body.items.map((i) => i.load.toCity ?? i.load.toRegion), ["Olmaota", "samarqand", "Toshkent"]);
  assert.deepEqual(all.body.items.at(-1).load.phones, ["+998901112233"]);
  assert.equal(all.body.items.at(-1).post.link, "https://t.me/yuk/1");

  // Toshkent shahri = viloyati; davlat bo'yicha ham
  assert.equal((await call("GET", "/pub/loads?view=all&from=toshkent", { token })).body.total, 1);
  assert.equal((await call("GET", "/pub/loads?view=all&to=Qozog'iston", { token })).body.total, 1);
  assert.equal((await call("GET", "/pub/loads?view=all&limit=1&offset=1", { token })).body.items.length, 1);
  // 1 soatlik oynaga hech biri tushmaydi (yuklar 2 soat oldin yozilgan)
  assert.equal((await call("GET", "/pub/loads?view=all&hours=1", { token })).body.total, 0);
});

test("mos yuklar: profil bo'lmasa — 409 no_profile; saqlangach — faqat mosi", async () => {
  const { token } = await login();
  const none = await call("GET", "/pub/loads", { token });
  assert.equal(none.status, 409);
  assert.equal(none.body.code, "no_profile");

  const wrong = await call("PUT", "/pub/me/profile", { token, body: { profile: { vehicle: { truckClass: "kosmik" } } } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Mashina turini/);

  const profile = {
    vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, loadingSides: [] },
    fromAreas: ["fargona", "Rossiya"], // Rossiya doirada yo'q — tashlanadi
    toAreas: [],
    domestic: true,
    international: false,
    mode: "own",
  };
  const saved = await call("PUT", "/pub/me/profile", { token, body: { profile } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.active, true);
  assert.deepEqual(saved.body.profile.fromAreas, ["fargona"]);
  assert.deepEqual(store.getDriver(555).profile.fromAreas, ["fargona"]);

  const mine = await call("GET", "/pub/loads", { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.view, "mine");
  assert.deepEqual(mine.body.items.map((i) => i.load.fromCity), ["Qo'qon"]);
});

test("pauza / davom", async () => {
  const { token } = await login();
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: "ha" } })).status, 400);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: false } })).body.active, false);
  assert.equal(store.getDriver(555).active, false);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: true } })).body.active, true);
  // profili yo'q haydovchi yoqa olmaydi
  const fresh = sessions.issue(556);
  assert.equal((await call("PATCH", "/pub/me", { token: fresh, body: { active: true } })).status, 409);
});

test("web fayllari: / va boshqa sahifalar index.html; noma'lum /pub — JSON 404", async () => {
  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.body, /Yuk Ekspert/);
  assert.match((await call("GET", "/yuklar")).body, /Yuk Ekspert/);
  assert.equal((await call("GET", "/pub/yoq")).status, 401); // kirmagan odamga qaysi yo'l borligi ham aytilmaydi
  const missing = await call("GET", "/pub/yoq", { token: sessions.issue(555) });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "Topilmadi");
});

test("boshqaruv markazi: haydovchi nomidan web havolasi (token # ichida)", async () => {
  const response = await fetch(`${adminBase}/api/drivers/555/web-link`, { method: "POST", headers: { "x-yuk-admin": "1" } });
  const { url } = await response.json();
  assert.match(url, /^http:\/\/localhost:3001\/#token=/);
  assert.equal(sessions.verify(url.split("#token=")[1]), 555);
  const missing = await fetch(`${adminBase}/api/drivers/1/web-link`, { method: "POST", headers: { "x-yuk-admin": "1" } });
  assert.equal(missing.status, 404);
});
