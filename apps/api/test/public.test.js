import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore } from "@yuk/store";
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
let server, base, store, sessions, adminServer, adminBase;
const env = { BOT_TOKEN, ADMIN_IDS: "558" };
const HOUR = 3600 * 1000;

function addLoad(id, load, { hoursAgo = 1, kind = "yuk" } = {}) {
  const post = store.addPost({ source: "@yuk", messageId: id, link: `https://t.me/yuk/${id}`, text: `e'lon ${id}`, postedAt: NOW - hoursAgo * HOUR });
  return store.addLoad({ postId: post.id, key: `k${id}`, load, kind });
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

  const dist = mkdtempSync(path.join(tmpdir(), "yuk-web-"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Yuk Ekspert</title>");
  const notify = async (chatId, text, extra) => notified.push({ chatId, text, extra });
  const app = createPublicApp({ store, env, sessions, scope: "qoshni", webDist: dist, notify, now: () => NOW });
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
  assert.deepEqual(me, { chatId: 555, name: "Ali Valiyev", username: "ali_haydovchi", role: null, plan: "free", isAdmin: false, profile: null, active: false, phone: null });
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
  assert.equal((await call("GET", "/pub/trucks", { token })).body.code, "no_profile");
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

test("hisobni o'chirish: qator butunlay o'chadi, token ishlamay qoladi, botga «o'chirildi» va menyu olib tashlanadi", async () => {
  store.saveDriver(559, { name: "O'chiriladigan", role: "haydovchi", phone: "+998901234567", active: true, profile: { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] } });
  const token = sessions.issue(559);
  assert.equal((await call("OPTIONS", "/pub/me")).headers.get("access-control-allow-methods").includes("DELETE"), true);
  assert.equal((await call("DELETE", "/pub/me")).status, 401, "tokensiz o'chirib bo'lmaydi");

  const before = notified.length;
  const deleted = await call("DELETE", "/pub/me", { token });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true });
  assert.equal(store.getDriver(559), null);
  assert.equal(store.getDriver(555)?.chatId, 555, "boshqalar joyida");
  assert.equal((await call("GET", "/pub/me", { token })).status, 401, "eski token endi ishlamaydi");
  assert.deepEqual(notified.slice(before), [{ chatId: 559, text: DELETED_TEXT, extra: { reply_markup: { remove_keyboard: true } } }]);
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

test("boshqaruv markazi: haydovchi nomidan web havolasi (token # ichida)", async () => {
  const response = await fetch(`${adminBase}/api/drivers/555/web-link`, { method: "POST", headers: { "x-yuk-admin": "1" } });
  const { url } = await response.json();
  assert.match(url, /^http:\/\/localhost:3001\/#token=/);
  assert.equal(sessions.verify(url.split("#token=")[1]), 555);
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
  const paused = await call("PATCH", "/pub/admin/users/560", { token: helper, body: { active: false } });
  assert.equal(paused.body.phone, undefined);
  assert.ok(!JSON.stringify(paused.body).includes("5550000"));

  // Pauza, rolni almashtirish (sozlamalari saqlanadi, yangi rolda yo'q); admin qilish bu yerdan bo'lmaydi
  assert.equal(paused.body.active, false);
  const switched = await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "yuk_beruvchi", isAdmin: true, plan: "pro" } });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.role, "yuk_beruvchi");
  assert.equal(switched.body.profile, null);
  const after = store.getDriver(560);
  assert.equal(after.isAdmin, false, "Mini App'dan admin qilib bo'lmaydi");
  assert.equal(after.plan, "free", "Mini App'dan obunani o'zgartirib bo'lmaydi");
  assert.equal((await call("PATCH", "/pub/admin/users/560", { token: helper, body: { active: true } })).status, 409, "sozlamasiz yoqib bo'lmaydi");
  const back = await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "haydovchi" } });
  assert.equal(back.body.role, "haydovchi");
  assert.ok(back.body.profile, "haydovchi sozlamalari tiklandi");
  assert.equal(back.body.phone, undefined);
  assert.equal((await call("PATCH", "/pub/admin/users/999999", { token: helper, body: { active: false } })).status, 404);
  assert.equal((await call("PATCH", "/pub/admin/users/560", { token: helper, body: { role: "kosmonavt" } })).status, 400);
});
