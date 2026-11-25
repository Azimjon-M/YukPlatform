import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCallLinks, openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { createBotMessenger } from "../src/botMessage.js";
import { DELETED_TEXT, SIGNED_OUT_TEXT, createPublicApp, createRateLimiter } from "../src/public.js";
import { createSessions, signLoginWidget, signWebAppData, verifyLoginWidget, verifyWebAppData } from "../src/telegramAuth.js";

const BOT_TOKEN = "123456:TEST-token-faqat-testda";
const NOW = 1_800_000_000_000;
const nowS = Math.floor(NOW / 1000);
const USER = { id: 555, first_name: "Ali", last_name: "Valiyev", username: "ali_haydovchi" };
const notified = []; // bot nomidan yuborilgan xabarlar (haqiqiy Telegram'ga emas)

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
let server, base, store, sessions, calls, adminServer, adminBase, apkDir;
const loadIds = {}; // e'lon raqami → bazadagi yuk id
const env = { BOT_TOKEN, ADMIN_IDS: "558" };
const HOUR = 3600 * 1000;

function addLoad(id, load, { hoursAgo = 1, kind = "yuk" } = {}) {
  const post = store.addPost({ source: "@yuk", messageId: id, link: `https://t.me/yuk/${id}`, text: `e'lon ${id}`, postedAt: NOW - hoursAgo * HOUR });
  return (loadIds[id] = store.addLoad({ postId: post.id, key: `k${id}`, load, kind }));
}

before(async () => {
  let time = NOW - 2 * HOUR;
  store = openStore({ file: ":memory:", now: () => time });
  addLoad(1, { fromRegion: "fargona", fromCity: "Qo'qon", toRegion: "toshkent_sh", toCity: "Toshkent", truckClass: "fura", weightT: 22, phones: ["+998901112233"] });
  addLoad(2, { fromRegion: "andijon", toRegion: "samarqand", truckClass: "isuzu", weightT: 5 });
  // doiradan tashqarida (qoshni): Rossiya — ko'rsatilmaydi
  addLoad(3, { fromRegion: "toshkent_sh", toRegion: "xorij", toCountry: "Rossiya", toCity: "Moskva", truckClass: "fura" });
  addLoad(4, { fromRegion: "toshkent_sh", fromCity: "Toshkent", toRegion: "xorij", toCountry: "Qozog'iston", toCity: "Olmaota", truckClass: "fura", weightT: 20 });
  // bo'sh mashinalar (yuk beruvchilarga)
  addLoad(5, { fromRegion: "samarqand", fromCity: "Samarqand", truckClass: "fura", bodyType: "tent", weightT: 22, phones: ["+998905556677"] }, { kind: "mashina" });
  addLoad(6, { fromRegion: "andijon", fromCity: "Andijon", toRegion: "toshkent_sh", truckClass: "isuzu" }, { kind: "mashina" });
  time = NOW;
  store.setSetting("bot_username", "Yuk_Ekspert_agent");
  sessions = createSessions(randomBytes(32), { now: () => NOW });
  calls = createCallLinks(randomBytes(32));

  const dist = mkdtempSync(path.join(tmpdir(), "yuk-web-"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Yuk Ekspert</title>");
  const notify = async (chatId, text, extra) => notified.push({ chatId, text, extra });
  apkDir = mkdtempSync(path.join(tmpdir(), "yuk-apk-"));
  const app = createPublicApp({ store, env, sessions, calls, scope: "qoshni", webDist: dist, apkDir, notify, now: () => NOW });
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

test("Android ilova: fayl yo'q — null/404; latest.json bor — versiya va yuklab olish (kirishsiz)", async () => {
  let res = await call("GET", "/pub/app");
  assert.deepEqual(res.body, { android: null });
  assert.equal((await call("GET", "/pub/app/android")).status, 404);
  writeFileSync(path.join(apkDir, "yuk-ekspert-1.2.3.apk"), "APK");
  writeFileSync(path.join(apkDir, "latest.json"), JSON.stringify({ version: "1.2.3", versionCode: 7, file: "../../yuk-ekspert-1.2.3.apk", size: 3 }));
  res = await call("GET", "/pub/app");
  assert.equal(res.body.android.version, "1.2.3");
  assert.equal(res.body.android.url, "/pub/app/android");
  res = await call("GET", "/pub/app/android");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.match(res.headers.get("content-disposition"), /yuk-ekspert-1\.2\.3\.apk/);
  assert.equal(res.body, "APK");
});

test("majburiy yangilash: X-App-Version eski — 426 update; yangi yoki sarlavhasiz — odatdagidek; /pub/app ochiq", async () => {
  // oldingi test latest.json ni versionCode 7 bilan qo'ydi
  let res = await call("GET", "/pub/me", { headers: { "x-app-version": "6" } });
  assert.equal(res.status, 426);
  assert.equal(res.body.code, "update");
  assert.equal((await call("GET", "/pub/app", { headers: { "x-app-version": "6" } })).status, 200);
  assert.equal((await call("GET", "/pub/me", { headers: { "x-app-version": "7" } })).status, 401); // tekshiruvdan o'tdi
  assert.equal((await call("GET", "/pub/me")).status, 401);
});

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
  assert.deepEqual(me, { chatId: 555, name: "Ali Valiyev", username: "ali_haydovchi", role: null, plan: "free", isAdmin: false, profile: null, active: false, phone: null, phoneAt: null, loadPhones: [] });
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

test("web'dagi har so'rov — oxirgi faollik «web» (boshqaruv markazi uchun)", async () => {
  const { token, me } = await login();
  assert.equal((await call("GET", "/pub/me", { token })).status, 200);
  const user = store.getDriver(me.chatId);
  assert.equal(user.seenVia, "web");
  assert.ok(Date.now() - user.seenAt < 5000);
});

test("yuklar: hammasi — faqat doiradagilar, eng yangisi birinchi, telefon bilan; joy filtri", async () => {
  const { token } = await login();
  const all = await call("GET", "/pub/loads?view=all", { token });
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3); // Rossiya yo'q, bo'sh mashinalar ham yo'q
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

test("yopiq guruh e'loni: bepulga ko'rinmaydi («Hammasi» da ham), Pro'ga — ko'rinadi", async () => {
  const { token } = await login();
  const post = store.addPost({ source: "-1009876543", messageId: 99, text: "yopiq e'lon", postedAt: NOW - HOUR });
  store.addLoad({ postId: post.id, key: "k99", load: { fromRegion: "buxoro", toRegion: "navoiy", truckClass: "fura" }, kind: "yuk" });
  const total = async () => (await call("GET", "/pub/loads?view=all", { token })).body.total;
  assert.equal(await total(), 3, "bepul — yopiq guruh yuki yo'q");
  const pro = await fetch(`${adminBase}/api/drivers/${USER.id}`, { method: "PATCH", headers: { "x-yuk-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ plan: "pro" }) });
  assert.equal(pro.status, 200);
  assert.equal(await total(), 4, "Pro — ko'rinadi");
  store.saveDriver(USER.id, { plan: "free" });
  assert.equal(await total(), 3);
});

test("mos yuklar: rol yoki profil bo'lmasa — 409; saqlangach — faqat mosi", async () => {
  const { token } = await login();
  const noRole = await call("GET", "/pub/loads", { token });
  assert.equal(noRole.status, 409);
  assert.equal(noRole.body.code, "no_role");
  assert.equal((await call("PUT", "/pub/me/profile", { token, body: { profile: {} } })).body.code, "no_role");

  assert.equal((await call("PUT", "/pub/me/role", { token, body: { role: "kosmonavt" } })).status, 400);
  const chosen = await call("PUT", "/pub/me/role", { token, body: { role: "haydovchi" } });
  assert.equal(chosen.body.role, "haydovchi");
  const none = await call("GET", "/pub/loads", { token });
  assert.equal(none.status, 409);
  assert.equal(none.body.code, "no_profile");

  const wrong = await call("PUT", "/pub/me/profile", { token, body: { profile: { vehicle: { truckClass: "kosmik" } } } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Transport turini/);

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
  // Haydovchining yo'nalishi formadan emas — botdagi «📋 Mos yuklar» dan (forma yuborgani tashlanadi)
  assert.deepEqual(saved.body.profile.fromAreas, []);
  assert.equal(saved.body.profile.routeAt, null);

  // Botda «Farg'ona → istalgan joy» tanladi; formani yana saqlasa ham yo'nalish qoladi
  store.saveDriver(555, { profile: { ...store.getDriver(555).profile, fromAreas: ["fargona"], routeAt: Date.now() } });
  const again = await call("PUT", "/pub/me/profile", { token, body: { profile: { ...profile, fromAreas: [] } } });
  assert.deepEqual(again.body.profile.fromAreas, ["fargona"]);
  assert.ok(again.body.profile.routeAt > 0);

  const mine = await call("GET", "/pub/loads", { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.view, "mine");
  assert.deepEqual(mine.body.items.map((i) => i.load.fromCity), ["Qo'qon"]);
});

test("yo'nalish (web «Yuklar»): tugmalardagi sonlar, saqlash; noma'lum joy — 400; rol/profil bo'lmasa — 409", async () => {
  const { token } = await login(); // 555 — oldingi testda fura haydovchisi bo'ldi (Farg'ona → istalgan joy)
  const count = (body, id) => body.areas.find((a) => a.id === id).count;

  const fromStep = await call("GET", "/pub/me/route", { token });
  assert.equal(fromStep.status, 200);
  assert.equal(fromStep.body.from, null, "«Qayerdan?» qadami");
  assert.equal(fromStep.body.areas.length, 14, "xalqaro tanlanmagan — faqat viloyatlar");
  assert.equal(count(fromStep.body, "fargona"), 1);
  assert.equal(count(fromStep.body, "andijon"), 0, "Isuzu yuki fura haydovchisiga sanalmaydi");
  assert.equal(fromStep.body.any, 1, "Qozog'iston yuki — xalqaro tanlanmagan, Rossiya — doiradan tashqari");

  const toStep = await call("GET", "/pub/me/route?from=fargona", { token });
  assert.equal(toStep.body.from, "fargona", "«Qayerga?» qadami");
  assert.equal(count(toStep.body, "toshkent_sh"), 1);
  assert.equal(count(toStep.body, "samarqand"), 0);
  assert.equal(toStep.body.any, 1);
  assert.equal((await call("GET", "/pub/me/route?from=*", { token })).body.any, 1, "hamma joydan");
  assert.equal((await call("GET", "/pub/me/route?from=fargona&hours=1", { token })).body.any, 0, "1 soatda yuk yo'q");
  assert.equal((await call("GET", "/pub/me/route?from=Rossiya", { token })).status, 400);

  assert.equal((await call("PUT", "/pub/me/route", { token, body: { from: "Qozog'iston", to: "*" } })).status, 400, "xalqaro tanlanmagan");
  assert.equal((await call("PUT", "/pub/me/route", { token, body: { from: "andijon" } })).status, 400);
  const saved = await call("PUT", "/pub/me/route", { token, body: { from: "andijon", to: "*" } });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.profile.fromAreas, saved.body.profile.toAreas, saved.body.profile.routeAt], [["andijon"], [], NOW]);
  assert.equal(store.getDriver(555).profile.vehicle.truckClass, "fura", "mashina o'zgarmaydi");
  assert.deepEqual(store.takeBotNotices(), [], "oddiy saqlash — botga topshiriq yo'q");
  // Botdagi «🗺 Xaritadan tanlash» dan: bot chatda javob bersin — topshiriq bazaga
  await call("PUT", "/pub/me/route", { token, body: { from: "andijon", to: "*", notify: true } });
  assert.deepEqual(store.takeBotNotices().map((n) => [n.chatId, n.kind]), [[555, "route"]]);
  assert.equal((await call("GET", "/pub/loads", { token })).body.total, 0, "Andijondan fura yuki yo'q — bot ham shunday yuboradi");
  await call("PUT", "/pub/me/route", { token, body: { from: "*", to: "toshkent_sh" } });
  assert.deepEqual((await call("GET", "/pub/loads", { token })).body.items.map((i) => i.load.fromCity), ["Qo'qon"]);
  await call("PUT", "/pub/me/route", { token, body: { from: "fargona", to: "*" } });

  store.saveDriver(558, { name: "Yangi" });
  const fresh = sessions.issue(558);
  assert.equal((await call("GET", "/pub/me/route", { token: fresh })).body.code, "no_role");
  await call("PUT", "/pub/me/role", { token: fresh, body: { role: "haydovchi" } });
  assert.equal((await call("PUT", "/pub/me/route", { token: fresh, body: { from: "*", to: "*" } })).body.code, "no_profile");
  await call("PUT", "/pub/me/role", { token: fresh, body: { role: "yuk_beruvchi" } });
  assert.equal((await call("GET", "/pub/me/route", { token: fresh })).body.code, "role", "yuk beruvchining yo'nalishi sozlamalarida");
});

test("ilova yuk chati: rolsiz — haydovchi ham yoza oladi; matn tushunilmasa oddiy javob; ovoz o'girgichsiz — 503", async () => {
  const { token } = await login(); // 555 — haydovchi
  assert.equal((await call("GET", "/pub/me/load-chat", { token })).status, 200);
  const voice = await fetch(`${base}/pub/me/load-chat/voice`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "audio/aac" }, body: Buffer.from("abc") });
  assert.equal(voice.status, 503);
  const shipper = sessions.issue(558);
  store.saveDriver(558, { name: "Vali", role: "yuk_beruvchi", active: true });
  const open = await call("GET", "/pub/me/load-chat", { token: shipper });
  assert.equal(open.status, 200);
  assert.equal(open.body.view, null);
  assert.match(open.body.intro, /Masalan/);
  const said = await call("POST", "/pub/me/load-chat", { token: shipper, body: { text: "salom qalaysiz" } });
  assert.equal(said.status, 200);
  assert.equal(said.body.stage, null);
  assert.equal((await call("POST", "/pub/me/load-chat/send", { token: shipper })).body.code, "stale");
});

test("pauza / davom", async () => {
  const { token } = await login();
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: "ha" } })).status, 400);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: false } })).body.active, false);
  assert.equal(store.getDriver(555).active, false);
  // Pauzada filtr/sozlamani saqlash pauzani bekor qilmaydi (Azimjon, 2026-11-25: «Bot Pauzadaham ishlayabdi»)
  const profile = store.getDriver(555).profile;
  const kept = await call("PUT", "/pub/me/profile", { token, body: { profile: { ...profile, feed: { mode: "tezkor" } } } });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.active, false);
  assert.equal(store.getDriver(555).active, false);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: true } })).body.active, true);
  // profili yo'q haydovchi yoqa olmaydi
  const fresh = sessions.issue(556);
  assert.equal((await call("PATCH", "/pub/me", { token: fresh, body: { active: true } })).status, 409);
});

test("yuk beruvchi: rol almashsa sozlamalar saqlanib, qaytganda tiklanadi; bo'sh mashinalar — mosi va hammasi", async () => {
  const token = sessions.issue(557);
  store.saveDriver(557, { name: "Karim", profile: { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] }, active: true }); // eski haydovchi
  assert.equal((await call("GET", "/pub/me", { token })).body.role, "haydovchi");
  // haydovchiga «mos mashinalar» yo'q
  assert.equal((await call("GET", "/pub/trucks", { token })).body.code, "role");

  const switched = await call("PUT", "/pub/me/role", { token, body: { role: "yuk_beruvchi" } });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.role, "yuk_beruvchi");
  assert.equal(switched.body.profile, null);
  // Profil (ro'yxatdan o'tish) shart emas (Azimjon, 2026-11-12) — bo'sh profil bilan ham mos mashinalar keladi
  const profileless = await call("GET", "/pub/trucks", { token });
  assert.equal(profileless.status, 200, "profilisiz yuk beruvchiga ham mashinalar");
  assert.deepEqual(profileless.body.items.map((i) => i.load.fromCity).sort(), ["Andijon", "Samarqand"]);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: false } })).body.active, false);
  assert.equal((await call("PATCH", "/pub/me", { token, body: { active: true } })).body.active, true, "profilisiz ham yoqiladi");
  assert.equal((await call("GET", "/pub/loads", { token })).body.code, "role");
  assert.equal((await call("GET", "/pub/loads?view=all", { token })).status, 200, "yuklarni ko'rish mumkin");

  const shipper = { fromAreas: ["samarqand", "Rossiya"], toAreas: [], domestic: true, international: false, truckClasses: ["fura"], bodyTypes: ["tent", "boshqa"] };
  const saved = await call("PUT", "/pub/me/profile", { token, body: { profile: shipper } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.profile, { fromAreas: ["samarqand"], toAreas: [], domestic: true, international: false, truckClasses: ["fura"], bodyTypes: ["tent"] });
  assert.equal(saved.body.active, true);

  const mine = await call("GET", "/pub/trucks", { token });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.items.map((i) => i.load.fromCity), ["Samarqand"]);
  assert.deepEqual(mine.body.items[0].load.phones, ["+998905556677"]);
  const all = await call("GET", "/pub/trucks?view=all", { token });
  assert.deepEqual(all.body.items.map((i) => i.load.fromCity).sort(), ["Andijon", "Samarqand"]);

  // Haydovchi profili yuk beruvchiga to'g'ri kelmaydi — rol forma bilan birga kelsa, rol ham almashadi
  const back = await call("PUT", "/pub/me/profile", {
    token,
    body: { role: "haydovchi", profile: { vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, loadingSides: [] }, fromAreas: [], toAreas: [], mode: "own" } },
  });
  assert.equal(back.status, 200);
  assert.equal(back.body.role, "haydovchi");
  assert.equal(back.body.profile.vehicle.truckClass, "isuzu");
  assert.equal(store.getDriver(557).role, "haydovchi");

  // Yuk beruvchiga qaytsa — o'sha sozlamalari tiklanadi, qaytadan to'ldirmaydi; keyin haydovchiga — isuzu
  const restored = await call("PUT", "/pub/me/role", { token, body: { role: "yuk_beruvchi" } });
  assert.deepEqual(restored.body.profile, saved.body.profile);
  assert.equal(restored.body.active, true);
  assert.equal((await call("GET", "/pub/trucks", { token })).status, 200, "darhol mos mashinalar");
  const driverAgain = await call("PUT", "/pub/me/role", { token, body: { role: "haydovchi" } });
  assert.equal(driverAgain.body.profile.vehicle.truckClass, "isuzu");
  assert.equal(driverAgain.body.profiles, undefined, "yashirilgan sozlamalar javobda yo'q");
});

test("«Mashinalar» xaritadan tanlangan nuqtaga yaqin masofa bo'yicha (near=lat,lng)", async () => {
  // Yuk beruvchi profilisiz: Samarqand shimolidagi nuqta tanlandi
  store.saveDriver(561, { name: "Yaqindan izlovchi" });
  const token = sessions.issue(561);
  assert.equal((await call("PUT", "/pub/me/role", { token, body: { role: "yuk_beruvchi" } })).status, 200);

  const near = await call("GET", "/pub/trucks?near=39.65,66.96&r=50", { token });
  assert.equal(near.status, 200);
  assert.deepEqual(near.body.near, { lat: 39.65, lon: 66.96 });
  assert.equal(near.body.r, 50);
  // Faqat Samarqand (≈2 km) — Andijon (≈475 km) Radiusdan tashqarida
  assert.deepEqual(near.body.items.map((i) => i.load.fromCity), ["Samarqand"]);
  assert.equal(near.body.items[0].distanceKm, 2, "kartochka uchun masofa km da");
  assert.equal(near.body.total, 1);

  // Radius katta bo'lsa — ikkalasi, eng yaqini tepada
  const wide = await call("GET", "/pub/trucks?near=39.65,66.96&r=1000", { token });
  assert.deepEqual(wide.body.items.map((i) => [i.load.fromCity, i.distanceKm]), [["Samarqand", 2], ["Andijon", 475]]);

  // near — view=all da ham ishlaydi va «Qayerda» filtri bilan birga
  const filtered = await call("GET", "/pub/trucks?view=all&near=40.7,71.6&r=100", { token });
  assert.deepEqual(filtered.body.items.map((i) => [i.load.fromCity, i.distanceKm]), [["Andijon", 64]]);

  // noto'g'ri near — filtr yo'q, oddiy ro'yxat (eski server bilan ham buzilmasin)
  const bad = await call("GET", "/pub/trucks?near=bo'lib+qoldi", { token });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.near, undefined);
  assert.equal(bad.body.items[0].distanceKm, undefined, "near bo'lmasa masofa yo'q");
});

test("hisobdan chiqish: rol va sozlamalar yashiriladi, mos yuklar yo'q, botga xabar; rolni tanlasa — tiklanadi", async () => {
  const profile = { vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, loadingSides: [] }, fromAreas: ["fargona"], toAreas: [], domestic: true, international: false, routeAt: 1 };
  store.saveDriver(560, { name: "Chiquvchi", role: "haydovchi", profile, active: true, phone: "+998907654321" });
  const token = sessions.issue(560);
  assert.equal((await call("POST", "/pub/me/logout")).status, 401, "tokensiz — yo'q");

  const before = notified.length;
  const out = await call("POST", "/pub/me/logout", { token });
  assert.equal(out.status, 200);
  assert.deepEqual([out.body.role, out.body.profile, out.body.active], [null, null, false]);
  assert.equal(out.body.profiles, undefined, "yashirilgan sozlamalar javobda yo'q");
  assert.deepEqual(notified.slice(before), [{ chatId: 560, text: SIGNED_OUT_TEXT, extra: { reply_markup: { remove_keyboard: true } } }]);
  assert.equal(store.activeUsers("haydovchi").some((u) => u.chatId === 560), false, "bot yubormaydi");
  assert.equal((await call("GET", "/pub/loads", { token })).body.code, "no_role", "«Menga mos» — avval ro'yxatdan o'tish");
  assert.equal((await call("GET", "/pub/me/route", { token })).body.code, "no_role");
  assert.equal(store.getDriver(560).phone, "+998907654321", "raqam qoladi");

  const back = await call("PUT", "/pub/me/role", { token, body: { role: "haydovchi" } });
  assert.deepEqual([back.body.role, back.body.active], ["haydovchi", true]);
  assert.deepEqual(back.body.profile.fromAreas, ["fargona"], "sozlamalar va yo'nalish tiklandi");
});

test("sozlamalardagi «Raqamni o'chirish»: faqat raqam o'chadi, so'ralgan vaqti qoladi; bot chatdagi menyuni yangilaydi", async () => {
  store.takeBotNotices();
  store.saveDriver(592, { name: "Raqamli", role: "haydovchi", phone: "+998901112233", phoneAskedAt: 5, active: true, profile: { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] } });
  const token = sessions.issue(592);
  assert.equal((await call("DELETE", "/pub/me/phone")).status, 401, "tokensiz o'chirib bo'lmaydi");
  const done = await call("DELETE", "/pub/me/phone", { token });
  assert.equal(done.status, 200);
  assert.equal(done.body.phone, null);
  assert.equal(done.body.role, "haydovchi", "hisob joyida");
  const row = store.getDriver(592);
  assert.deepEqual([row.phone, row.phoneAskedAt, row.active, row.profile != null], [null, 5, true, true]);
  assert.equal(store.driverDetails(592).events[0].type, "phone_removed");
  assert.deepEqual(store.takeBotNotices().map((n) => [n.chatId, n.kind]), [[592, "phone_deleted"]]);

  // Raqami yo'q — o'zgarishsiz, topshiriq ham yo'q
  assert.equal((await call("DELETE", "/pub/me/phone", { token })).body.phone, null);
  assert.deepEqual(store.takeBotNotices(), []);
});

test("hisobni o'chirish: qator qoladi («o'chirgan» belgisi bilan), token ishlamaydi, botga xabar; qayta kirsa — boshidan", async () => {
  store.saveDriver(590, { name: "O'chiriladigan", role: "haydovchi", phone: "+998901234567", active: true, profile: { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] } });
  const token = sessions.issue(590);
  assert.equal((await call("OPTIONS", "/pub/me")).headers.get("access-control-allow-methods").includes("DELETE"), true);
  assert.equal((await call("DELETE", "/pub/me")).status, 401, "tokensiz o'chirib bo'lmaydi");

  const before = notified.length;
  const deleted = await call("DELETE", "/pub/me", { token });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true });
  const row = store.getDriver(590);
  assert.deepEqual([row.name, row.role, row.profile, row.phone, row.active, row.deletedVia, row.deletedCount], ["O'chiriladigan", null, null, null, false, "web", 1]);
  assert.equal(store.listDrivers().find((d) => d.chatId === 590).deletedSnapshot.phone, "+998901234567", "boshqaruv markazida qoladi");
  assert.equal(store.getDriver(555)?.chatId, 555, "boshqalar joyida");
  assert.equal((await call("GET", "/pub/me", { token })).status, 401, "eski token endi ishlamaydi");
  assert.deepEqual(notified.slice(before), [{ chatId: 590, text: DELETED_TEXT, extra: { reply_markup: { remove_keyboard: true } } }]);
  assert.doesNotMatch(DELETED_TEXT, /ma'lumot.*o'chirildi/, "ma'lumot o'chdi deb aytmaymiz — u saqlanadi");

  // Qayta kirdi (Mini App): «o'chirgan» belgisi olinadi, boshidan boshlaydi (rol yo'q), «1 marta o'chirgan» qoladi
  const initData = signWebAppData({ auth_date: nowS - 10, user: { id: 590, first_name: "Qaytgan" } }, BOT_TOKEN);
  const again = await call("POST", "/pub/auth", { body: { initData } });
  assert.equal(again.status, 200);
  assert.equal(again.body.me.role, null);
  const back = store.getDriver(590);
  assert.deepEqual([back.deletedAt, back.deletedCount, back.returnedAt != null], [null, 1, true]);
  assert.deepEqual(store.driverDetails(590).events.slice(0, 2).map((e) => [e.type, e.detail?.via]), [["returned", "web"], ["deleted", "web"]]);

  // Mini App admin ro'yxati: o'chirgan / qaytgan belgisi
  store.saveDriver(558, { name: "Bosh admin" }); // .env ADMIN_IDS=558
  const users = (await call("GET", "/pub/admin/users?q=590", { token: sessions.issue(558) })).body.items;
  assert.deepEqual([users[0].deleted, users[0].deletedCount], [false, 1]);
});

test("boshqaruv markazi: «Batafsil» (GET /api/drivers/:id) va butunlay o'chirish (DELETE)", async () => {
  store.saveDriver(591, { name: "Batafsil", role: "haydovchi", profile: { vehicle: { truckClass: "isuzu" }, fromAreas: [], toAreas: [] }, active: true });
  store.switchRole(591, "yuk_beruvchi");
  const admin = (method, url) => fetch(`${adminBase}${url}`, { method, headers: { "x-yuk-admin": "1" } });
  const details = await (await admin("GET", "/api/drivers/591")).json();
  assert.deepEqual(Object.keys(details.profiles), ["haydovchi"]);
  assert.deepEqual(details.events.map((e) => e.type).reverse(), ["joined", "role", "registered", "role"]);
  assert.deepEqual(details.deliveries, []);
  assert.equal((await admin("GET", "/api/drivers/1")).status, 404);
  // PATCH (boshqaruv markazidan admin qilish) — tarixda; pauza esa bu yerdan mumkin emas
  const patchAdmin = (body) =>
    fetch(`${adminBase}/api/drivers/591`, { method: "PATCH", headers: { "x-yuk-admin": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await patchAdmin({ active: false })).status, 400);
  assert.equal(store.getDriver(591).active, true);
  await patchAdmin({ isAdmin: true });
  assert.deepEqual(store.driverDetails(591).events[0], { type: "admin", detail: { on: true }, at: NOW });

  assert.equal((await fetch(`${adminBase}/api/drivers/591`, { method: "DELETE" })).status, 403, "x-yuk-admin sarlavhasiz — yo'q");
  assert.equal((await admin("DELETE", "/api/drivers/591")).status, 200);
  assert.equal(store.getDriver(591), null);
  assert.equal((await admin("DELETE", "/api/drivers/591")).status, 404);
});

test("bot xabari: sendMessage so'rovi; xato yoki ok:false — jim false; tokensiz — null", async () => {
  assert.equal(createBotMessenger(""), null);
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { json: async () => ({ ok: true }) };
  };
  const send = createBotMessenger("123:abc", { fetchImpl: fake });
  assert.equal(await send(42, "salom", { reply_markup: { remove_keyboard: true } }), true);
  assert.deepEqual(calls, [{ url: "https://api.telegram.org/bot123:abc/sendMessage", body: { chat_id: 42, text: "salom", reply_markup: { remove_keyboard: true } } }]);
  const blocked = createBotMessenger("123:abc", { fetchImpl: async () => ({ json: async () => ({ ok: false, error_code: 403 }) }) });
  assert.equal(await blocked(42, "x"), false, "foydalanuvchi botni bloklagan");
  const offline = createBotMessenger("123:abc", {
    fetchImpl: async () => {
      throw new Error("internet yo'q");
    },
  });
  assert.equal(await offline(42, "x"), false);
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

test("boshqaruv markazi: haydovchi nomidan web havolasi (token ?t= da — nginx /admin Redirect'iga tushmasin)", async () => {
  const response = await fetch(`${adminBase}/api/drivers/555/web-link`, { method: "POST", headers: { "x-yuk-admin": "1" } });
  const { url } = await response.json();
  assert.match(url, /^http:\/\/localhost:3001\/\?t=/);
  assert.equal(sessions.verify(url.split("?t=")[1]), 555);
  const missing = await fetch(`${adminBase}/api/drivers/1/web-link`, { method: "POST", headers: { "x-yuk-admin": "1" } });
  assert.equal(missing.status, 404);
});

test("admin: oddiy foydalanuvchiga 403; ADMIN_IDS va boshqaruv markazidagi belgi admin qiladi", async () => {
  store.saveDriver(558, { name: "Bosh admin" }); // .env ADMIN_IDS=558
  store.saveDriver(559, { name: "Yordamchi" });
  store.saveDriver(560, { name: "Olim", username: "olim_yuk", role: "haydovchi", profile: { vehicle: { truckClass: "isuzu" }, fromAreas: [], toAreas: [] }, active: true });
  const plain = sessions.issue(560);
  for (const url of ["/pub/admin/overview", "/pub/admin/users"]) {
    const denied = await call("GET", url, { token: plain });
    assert.equal(denied.status, 403, url);
    assert.equal(denied.body.code, "forbidden");
  }
  assert.equal((await call("PATCH", "/pub/admin/users/560", { token: plain, body: { active: false } })).status, 403);
  assert.equal((await call("GET", "/pub/admin/overview")).status, 401, "tokensiz — 401");

  const boss = sessions.issue(558);
  assert.equal((await call("GET", "/pub/me", { token: boss })).body.isAdmin, true);
  const overview = await call("GET", "/pub/admin/overview", { token: boss });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.trucks.total, 2);
  assert.ok(overview.body.queue && overview.body.drivers && Array.isArray(overview.body.ai));

  // Boshqaruv markazidan (localhost) admin qilish — keyin u ham kira oladi
  const helper = sessions.issue(559);
  assert.equal((await call("GET", "/pub/admin/users", { token: helper })).status, 403);
  const made = await fetch(`${adminBase}/api/drivers/559`, {
    method: "PATCH",
    headers: { "x-yuk-admin": "1", "content-type": "application/json" },
    body: JSON.stringify({ isAdmin: true }),
  });
  assert.equal(made.status, 200);
  assert.equal(store.getDriver(559).isAdmin, true);

  const found = await call("GET", "/pub/admin/users?q=@olim&role=haydovchi", { token: helper });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.items.map((u) => u.chatId), [560]);
  assert.equal(found.body.items[0].hasProfile, true);
  assert.equal(found.body.items[0].phone, undefined);
  assert.ok((await call("GET", "/pub/admin/users?role=none", { token: helper })).body.items.every((u) => u.role === null));
  // Hisobdan chiqqan: rol bo'sh, lekin qaysi roldan chiqqani ko'rinadi
  store.saveDriver(561, { name: "Chiqqan", role: "haydovchi", profile: { vehicle: { truckClass: "fura" } }, active: true });
  store.signOut(561);
  const gone = (await call("GET", "/pub/admin/users?q=561", { token: helper })).body.items[0];
  assert.deepEqual([gone.role, gone.signedOut, gone.signedOutRole, gone.hasProfile], [null, true, "haydovchi", false]);
  assert.equal(found.body.items[0].signedOut, false);

  // Raqam: o'zi /pub/me da ko'radi; admin boshqa odamni o'zgartirganda javobda raqam yo'q
  store.saveDriver(560, { phone: "+998905550000" });
  assert.equal((await call("GET", "/pub/me", { token: sessions.issue(560) })).body.phone, "+998905550000");
  assert.equal((await call("GET", "/pub/me", { token: helper })).body.phone, null);
  // Faol / pauza — faqat foydalanuvchining o'zi: admin ham o'zgartira olmaydi (Azimjon, 2026-11-09)
  assert.equal((await call("PATCH", "/pub/admin/users/560", { token: helper, body: { active: false } })).status, 400);
  assert.equal(store.getDriver(560).active, true);
  const same = await call("PATCH", "/pub/admin/users/560", { token: helper, body: {} });
  assert.equal(same.body.phone, undefined);
  assert.ok(!JSON.stringify(same.body).includes("5550000"));
  // Ro'yxatda kim pauza qilgani: 48 soat kirmagani uchun avtomatik
  store.saveDriver(560, { active: false, why: "idle" });
  const listed = (await call("GET", "/pub/admin/users?q=560", { token: helper })).body.items[0];
  assert.deepEqual([listed.active, listed.pausedBy], [false, "idle"]);

  // Rolni almashtirish (sozlamalari saqlanadi, yangi rolda yo'q); admin qilish bu yerdan bo'lmaydi
  const switched = await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "yuk_beruvchi", isAdmin: true, plan: "pro" } });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.role, "yuk_beruvchi");
  assert.equal(switched.body.profile, null);
  const after = store.getDriver(560);
  assert.equal(after.isAdmin, false, "Mini App'dan admin qilib bo'lmaydi");
  assert.equal(after.plan, "free", "Mini App'dan obunani o'zgartirib bo'lmaydi");
  const back = await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "haydovchi" } });
  assert.equal(back.body.role, "haydovchi");
  assert.ok(back.body.profile, "haydovchi sozlamalari tiklandi");
  assert.equal(back.body.phone, undefined);
  assert.equal((await call("PATCH", "/pub/admin/users/999999", { token: helper, body: { active: false } })).status, 404);
  assert.equal((await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "kosmonavt" } })).status, 400);
});

// Telegram tugmasi tel: ni ocholmaydi — bot «📞 Telefon qilish» tugmasiga shu sahifani qo'yadi (bot.js loadButtons)
test("«📞 Telefon qilish»: imzolangan havola → tel: sahifasi, bosilgani yoziladi; yaroqsizi — 404, raqamsiz", async () => {
  const loadId = loadIds[1];
  store.saveDriver(570, { name: "Qo'ng'iroqchi", role: "haydovchi", profile: { vehicle: {} }, active: true });
  store.addDelivery({ loadId, chatId: 570, ok: true });
  const token = calls.make({ loadId, phone: 0, chatId: 570 });
  const page = await call("GET", `/pub/call?c=${token}`); // kirish (Bearer) kerak emas
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(page.body, /<a class="call" id="call" href="tel:\+998901112233">/);
  assert.match(page.body, /var tel = "tel:\+998901112233";[\s\S]*location\.href = tel;/, "darhol qo'ng'iroq oynasiga");
  assert.match(page.body, /post\("web_app_close"\)/, "Mini App'da — qo'ng'iroq oynasi ochilgach o'zi yopiladi");
  assert.match(page.body, /platform === "ios"[\s\S]*post\("web_app_open_link", \{ url: tel \}\)/, "iPhone: yashil tugma Telegram orqali ochadi");
  assert.match(page.body, /<p class="tip" id="ios" hidden>[^<]*<b>iPhone'da tezroq:<\/b>[^<]*ko'k raqamni bosing/, "iPhone maslahati (skript ochadi)");
  assert.match(page.body, /\+998 90 111 22 33/);
  assert.match(page.body, /🚛 Farg&#39;ona, Qo&#39;qon → Toshkent/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  // Bosilgani: deliveries.called_at (boshqaruv markazi) va oxirgi faollik (48 soatlik avto-pauza uchun)
  assert.equal(store.driverDetails(570).deliveries[0].calledAt, NOW);
  assert.equal(store.getDriver(570).seenAt, NOW);
  assert.equal(store.getDriver(570).seenVia, "call");

  // Bo'sh mashina e'loni ham (yuk beruvchiga)
  const truck = await call("GET", `/pub/call?c=${calls.make({ loadId: loadIds[5], phone: 0, chatId: 570 })}`);
  assert.match(truck.body, /🚚 Samarqand → istalgan joyga[\s\S]*tel:\+998905556677/);

  const invalid = [
    "",
    "nimadir",
    `${token.slice(0, -2)}xx`, // imzo buzilgan
    calls.make({ loadId, phone: 3, chatId: 570 }), // bunday raqam yo'q
    calls.make({ loadId: loadIds[2], phone: 0, chatId: 570 }), // e'londa raqam yo'q
    calls.make({ loadId: 99_999, phone: 0, chatId: 570 }), // yuk yo'q
    createCallLinks(randomBytes(32)).make({ loadId, phone: 0, chatId: 570 }), // boshqa kalit
  ];
  for (const bad of invalid) {
    const r = await call("GET", `/pub/call?c=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, bad);
    assert.match(r.body, /Havola yaroqsiz/);
    assert.ok(!r.body.includes("tel:") && !r.body.includes("<script"), "raqam ham, skript ham yo'q");
  }
});

test("blok: boshqaruv markazidan bloklangan — /pub/auth va eski token 403 «Uzr...»; adminni bloklab bo'lmaydi; blokdan chiqarsa — yana kiradi", async () => {
  const patchDriver = (chatId, body) =>
    fetch(`${adminBase}/api/drivers/${chatId}`, { method: "PATCH", headers: { "x-yuk-admin": "1", "content-type": "application/json" }, body: JSON.stringify(body) }).then(
      async (r) => ({ status: r.status, body: await r.json() }),
    );
  const { token, me } = await login();
  store.saveDriver(me.chatId, { phone: "+998901112233" });

  const blocked = await patchDriver(me.chatId, { blocked: true });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.banned.kind, "id");
  const old = await call("GET", "/pub/me", { token });
  assert.deepEqual([old.status, old.body.code, old.body.error], [403, "blocked", "Uzr, sizga xizmat ko'rsata olmaymiz!"]);
  const initData = signWebAppData({ auth_date: nowS - 10, user: USER }, BOT_TOKEN);
  assert.equal((await call("POST", "/pub/auth", { body: { initData } })).status, 403);
  // Boshqa akkaunt, o'sha username bilan — u ham bloklangan
  const twin = signWebAppData({ auth_date: nowS - 10, user: { ...USER, id: 777 } }, BOT_TOKEN);
  assert.equal((await call("POST", "/pub/auth", { body: { initData: twin } })).body.code, "blocked");
  assert.equal((await patchDriver(me.chatId, { isAdmin: true })).status, 409, "bloklanganni admin qilib bo'lmaydi");

  assert.equal((await patchDriver(me.chatId, { blocked: false })).status, 200);
  assert.equal((await call("GET", "/pub/me", { token })).status, 200);
  assert.equal((await call("POST", "/pub/auth", { body: { initData: twin } })).status, 200);

  store.saveDriver(778, { name: "Admin", isAdmin: true });
  const refused = await patchDriver(778, { blocked: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Adminni bloklab bo'lmaydi/);
  assert.equal((await patchDriver(778, { blocked: "ha" })).status, 400);
});

// --- «📦 Yuk berish» formasi (yuk beruvchi). Raqamlar soxta ---
test("yuk berish: faqat yuk beruvchi; forma tekshiriladi; navbatga tushadi; raqamlar eslab qolinadi; 24 soatda 20 ta", async () => {
  const shipper = { id: 600, first_name: "Yukchi", username: "yukchi_ali" };
  const initData = signWebAppData({ auth_date: nowS - 10, user: shipper }, BOT_TOKEN);
  const { token } = (await call("POST", "/pub/auth", { body: { initData } })).body;
  const FORM = { from: "andijon", fromCity: "Asaka", to: "toshkent_sh", cargo: "un", weight: "20", weightUnit: "tonna", phones: ["90 000 00 01"] };

  // Rol yo'q / haydovchi — 409
  assert.equal((await call("POST", "/pub/loads", { token, body: { load: FORM } })).body.code, "no_role");
  store.saveDriver(600, { role: "haydovchi" });
  const asDriver = await call("POST", "/pub/loads", { token, body: { load: FORM } });
  assert.deepEqual([asDriver.status, asDriver.body.code], [409, "role"]);
  assert.equal((await call("GET", "/pub/me/load-form", { token })).status, 409);

  // Yuk beruvchi — sozlamalarsiz ham (profil shart emas); o'zi ulashgan raqam formada tayyor turadi
  store.saveDriver(600, { role: "yuk_beruvchi", profile: null, phone: "+998900000009" });
  let form = await call("GET", "/pub/me/load-form", { token });
  assert.equal(form.status, 200);
  assert.deepEqual(form.body, { draft: null, phones: ["+998900000009"], used: 0, limit: 20 });

  // Xato maydon — 400 va qaysi maydon
  const bad = await call("POST", "/pub/loads", { token, body: { load: { ...FORM, phones: ["12 345"] } } });
  assert.deepEqual([bad.status, bad.body.field], [400, "phones"]);
  assert.match(bad.body.error, /noto'g'ri/);
  const far = await call("POST", "/pub/loads", { token, body: { load: { ...FORM, to: "Rossiya" } } });
  assert.deepEqual([far.status, far.body.field], [400, "to"]);

  // To'g'ri — navbatga (guruh e'loni kabi), bot yuboradi
  const sent = await call("POST", "/pub/loads", { token, body: { load: { ...FORM, phones: ["90 000 00 01", "+998 90 000 00 02"] } } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.load.fromCity, "Asaka");
  const [post] = store.shipperPosts(600);
  assert.equal(post.id, sent.body.id);
  assert.equal(post.via, "web");
  assert.equal(post.status, "new");
  assert.match(post.text, /^Andijon, Asaka → Toshkent shahri · un · 20 tonna/);
  assert.deepEqual(post.direct[0].phones, ["+998900000001", "+998900000002"]);
  form = await call("GET", "/pub/me/load-form", { token });
  assert.deepEqual(form.body.phones, ["+998900000001", "+998900000002"], "keyingi yukda oxirgi raqamlar");
  assert.equal(form.body.used, 1);
  assert.deepEqual((await call("GET", "/pub/me", { token })).body.loadPhones, ["+998900000001", "+998900000002"]);

  // Botdagi qoralama («✏️ Formada tuzatish») — formaga to'ldirilib keladi; yuborilsa (fromDraft) — o'chiriladi
  store.setLoadDraft(600, { text: "...", loads: [{ ...sent.body.load, weightT: 0.5 }], at: NOW - 60_000, stage: "confirm" });
  form = await call("GET", "/pub/me/load-form", { token });
  assert.equal(form.body.draft.from, "andijon");
  assert.deepEqual([form.body.draft.weight, form.body.draft.weightUnit], ["500", "kg"]);
  await call("POST", "/pub/loads", { token, body: { load: FORM, fromDraft: true } });
  assert.equal(store.loadDraft(600), null);
  // Eskirgan qoralama (1 soatdan oshgan) — berilmaydi
  store.setLoadDraft(600, { text: "...", loads: [sent.body.load], at: NOW - 2 * HOUR, stage: "confirm" });
  assert.equal((await call("GET", "/pub/me/load-form", { token })).body.draft, null);

  // Chegara: 24 soatda 20 ta
  for (let i = 0; i < 18; i++) store.addDirectPost({ chatId: 600, text: `yuk ${i}`, loads: [sent.body.load] });
  const limit = await call("POST", "/pub/loads", { token, body: { load: FORM } });
  assert.deepEqual([limit.status, limit.body.code], [429, "limit"]);
  assert.match(limit.body.error, /24 soatda 20 ta yuk/);
});

test("yuk beruvchining yuki haydovchilar ro'yxatida: «yuk egasidan» belgisi bor, uning chat id'si yo'q", async () => {
  const post = store.addDirectPost({ chatId: 601, text: "Andijon → Toshkent", loads: [], via: "web" });
  store.addLoad({ postId: post.id, key: "direct-601", load: { fromRegion: "andijon", fromCity: "Andijon", toRegion: "toshkent_sh", weightT: 20, phones: ["+998900000011"] } });
  const { token } = await login();
  const { body } = await call("GET", "/pub/loads?view=all", { token });
  const item = body.items.find((i) => i.load.phones?.[0] === "+998900000011");
  assert.equal(item.post.fromShipper, true);
  assert.equal(item.post.source, null);
  assert.equal(item.post.link, null);
  assert.doesNotMatch(JSON.stringify(body), /601/);
});

// --- Yetkazish rejimi (2026-11-14): «⚡ Tezkor» / «📌 Mening guruhlarim» ---
test("rejim: guruhlar ro'yxati; profilda rejim saqlanadi, begona guruh tushadi; saralanmaydigan rejimda «Menga mos» va yo'nalish — 409", async () => {
  store.addSource("@TutGruz");
  store.addSource("@Yuk_markazi");
  store.addSource("@Ochiq_emas", { enabled: false });
  store.saveDriver(590, { name: "Tezkor", role: "haydovchi", active: true });
  const token = sessions.issue(590);
  const list = await call("GET", "/pub/me/feed-sources", { token });
  assert.equal(list.status, 200);
  const names = list.body.sources.map((s) => s.name);
  assert.ok(names.includes("@TutGruz") && names.includes("@Yuk_markazi"));
  assert.ok(!names.includes("@Ochiq_emas"), "o'chirilgan guruh ro'yxatda yo'q");
  assert.deepEqual(list.body.chosen, []);
  assert.equal(list.body.max, 500);

  // Tezkor — mashinasiz saqlanadi, yuborish yoqiladi
  const fast = await call("PUT", "/pub/me/profile", { token, body: { profile: { domestic: true, international: false, feed: { mode: "tezkor" } } } });
  assert.equal(fast.status, 200, JSON.stringify(fast.body));
  assert.equal(fast.body.profile.vehicle, null);
  assert.deepEqual(fast.body.profile.feed, { mode: "tezkor", sources: [] });
  assert.equal(fast.body.active, true);
  // Saralanmaydi: «Menga mos» — bot yuboradiganlari (guruh + filtrlar), yo'nalish — 409 feed; «Hammasi» ishlaydi
  const mine = await call("GET", "/pub/loads", { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.view, "mine");
  assert.equal((await call("GET", "/pub/loads?view=all", { token })).status, 200);
  assert.equal((await call("GET", "/pub/me/route", { token })).body.code, "feed");
  assert.equal((await call("PUT", "/pub/me/route", { token, body: { from: "*", to: "*" } })).body.code, "feed");

  // Guruhlarim: o'chirilgan / bazada yo'q guruh tushadi, yozilishi — ro'yxatdagidek
  const groups = await call("PUT", "/pub/me/profile", {
    token,
    body: { profile: { domestic: true, feed: { mode: "guruhlarim", sources: ["@tutgruz", "@Ochiq_emas", "@Begona_guruh"] } } },
  });
  assert.equal(groups.status, 200, JSON.stringify(groups.body));
  assert.deepEqual(groups.body.profile.feed, { mode: "guruhlarim", sources: ["@TutGruz"] });
  const none = await call("PUT", "/pub/me/profile", { token, body: { profile: { domestic: true, feed: { mode: "guruhlarim", sources: ["@Begona_guruh"] } } } });
  assert.equal(none.status, 400);
  assert.equal(none.body.field, "groups");
  const empty = await call("PUT", "/pub/me/profile", { token, body: { profile: { domestic: true, feed: { mode: "guruhlarim", sources: [] } } } });
  assert.equal(empty.body.field, "groups");
  assert.deepEqual(store.getDriver(590).profile.feed, { mode: "guruhlarim", sources: ["@TutGruz"] }, "xato — hech narsa o'zgarmadi");

  // Rejimni yubormagan (eski) forma — rejim qoladi, mashina qo'shiladi
  const vehicleForm = { vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, loadingSides: [] }, domestic: true, international: false };
  const old = await call("PUT", "/pub/me/profile", { token, body: { profile: vehicleForm } });
  assert.deepEqual(old.body.profile.feed, { mode: "guruhlarim", sources: ["@TutGruz"] });
  assert.equal(old.body.profile.vehicle.truckClass, "fura");
  assert.equal((await call("GET", "/pub/me/route", { token })).body.code, "feed", "faqat guruhlarim — mashina bo'lsa ham saralanmaydi");

  // «Guruhlarim + saralangan» va mashina bor — «Menga mos» ishlaydi
  const plus = await call("PUT", "/pub/me/profile", { token, body: { profile: { ...vehicleForm, feed: { mode: "guruhlarim_plus", sources: ["@TutGruz"] } } } });
  assert.equal(plus.status, 200);
  assert.equal((await call("GET", "/pub/loads", { token })).status, 200);
  assert.equal((await call("GET", "/pub/me/route", { token })).status, 200);
  assert.deepEqual((await call("GET", "/pub/me/feed-sources", { token })).body.chosen, ["@TutGruz"]);
});

test("tezkor e'londagi «📞 Telefon qilish»: e'lon tokeni → raqam e'lon matnidan, bosilgani yoziladi; yaroqsizi — 404", async () => {
  const post = store.addPost({ source: "@yuk", messageId: 900, link: "https://t.me/yuk/900", text: "Toshkentdan Samarqandga 20 t un bor 90 111 22 44", postedAt: NOW });
  store.saveDriver(591, { name: "Tez", role: "haydovchi", profile: { vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  store.addPostDelivery({ postId: post.id, chatId: 591, ok: true });
  const token = calls.makePost({ postId: post.id, phone: 0, chatId: 591 });
  const page = await call("GET", `/pub/call?c=${token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /href="tel:\+998901112244"/);
  assert.doesNotMatch(page.body, /class="route"/, "yo'nalish yozilmaydi — AI hali aytmagan");
  assert.equal(store.driverDetails(591).rawDeliveries[0].calledAt, NOW);
  assert.equal(store.getDriver(591).seenVia, "call");

  for (const bad of [
    calls.makePost({ postId: post.id, phone: 1, chatId: 591 }), // e'londa ikkinchi raqam yo'q
    calls.makePost({ postId: 99_999, phone: 0, chatId: 591 }), // e'lon yo'q
    `${token.slice(0, -2)}xx`,
    token.slice(2), // "p." siz — yuk tokeni sifatida ham o'tmaydi
  ]) {
    const r = await call("GET", `/pub/call?c=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, bad);
    assert.ok(!r.body.includes("tel:"));
  }
});

test("ilova kirishi: kod → botda tasdiq → token bir marta; begona kod va tasdiqsiz — yo'q", async () => {
  const start = await call("POST", "/pub/auth/app");
  assert.equal(start.status, 200);
  const { code, url, tgUrl, expiresIn } = start.body;
  assert.match(code, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(url, `https://t.me/Yuk_Ekspert_agent?start=app_${code}`);
  assert.equal(tgUrl, `tg://resolve?domain=Yuk_Ekspert_agent&start=app_${code}`);
  assert.equal(expiresIn, 600);

  // hali tasdiqlanmagan — kutadi
  assert.deepEqual((await call("GET", `/pub/auth/app/${code}`)).body, { status: "pending" });
  assert.equal((await call("GET", `/pub/auth/app/${code}`)).status, 202);
  // yo'q kod
  assert.equal((await call("GET", "/pub/auth/app/yoqkod-yoqkod-yoqkod-yoq")).status, 410);

  // bot tasdiqladi (bot.js al:ok) — ikkinchi odam endi tasdiqlay olmaydi
  store.saveDriver(USER.id, { name: "Ali Valiyev", username: USER.username });
  assert.equal(store.confirmAppLogin(code, USER.id), true);
  assert.equal(store.confirmAppLogin(code, 999), false);

  const done = await call("GET", `/pub/auth/app/${code}`);
  assert.equal(done.status, 200);
  assert.equal(done.body.me.chatId, USER.id);
  const me = await call("GET", "/pub/me", { token: done.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.chatId, USER.id);
  // token faqat bir marta
  assert.equal((await call("GET", `/pub/auth/app/${code}`)).status, 410);
});

test("POST /pub/me/push: ilova tokeni saqlanadi, noto'g'risi — 400, chiqqanda o'chadi", async () => {
  store.saveDriver(561, { name: "Push", role: "haydovchi", active: true });
  const token = sessions.issue(561);
  const fcm = "fcm-token-zzzzzzzzzzzzzzzzzzzzzzzz:abc";
  assert.equal((await call("POST", "/pub/me/push", { body: { token: fcm } })).status, 401);
  assert.equal((await call("POST", "/pub/me/push", { token, body: { token: "x y" } })).status, 400);
  assert.equal((await call("POST", "/pub/me/push", { token, body: { token: fcm, platform: "android" } })).status, 200);
  assert.deepEqual(store.pushTokens().filter((t) => t.chatId === 561).map((t) => t.token), [fcm]);
  await call("POST", "/pub/me/logout", { token });
  assert.equal(store.pushTokens().some((t) => t.chatId === 561), false);
});
