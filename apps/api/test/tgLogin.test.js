import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { openStore } from "@yuk/store";
import { createPublicApp } from "../src/public.js";
import { createSessions } from "../src/telegramAuth.js";
import { cleanCode, createTgLogin, maskPhone, normalizeLoginPhone } from "../src/tgLogin.js";
import { createLoginSession } from "../../collector/src/loginWorker.js";

const ENV = { TG_API_ID: "1", TG_API_HASH: "test" };
const USER = { userId: "77", username: "yuk_ikki", firstName: "Ikkinchi" };

// Soxta worker (apps/collector loginWorker.js o'rniga): har so'rovga script javob beradi.
// undefined — javob yo'q (Telegram osilib qoldi), "crash" — jarayon yiqildi. Haqiqiy Telegram'ga hech narsa ketmaydi
function fakeWorkers(script = defaultScript) {
  const spawned = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.sent = [];
    child.send = (message) => {
      child.sent.push(message);
      if (message.type === "cancel") return void setImmediate(() => child.emit("exit", 0));
      const reply = script(message);
      if (reply === "crash") setImmediate(() => child.emit("exit", 1));
      else if (reply) setImmediate(() => child.emit("message", reply));
    };
    child.kill = () => child.emit("exit", null);
    spawned.push(child);
    return child;
  };
  return { spawn, spawned };
}

function defaultScript(message) {
  if (message.type === "start") return { type: "code", via: "app", length: 5 };
  if (message.type === "code") {
    if (message.code === "11111") return { type: "error", retry: true, message: "Kod noto'g'ri. Qayta kiriting." };
    if (message.code === "22222") return { type: "password", hint: "mushuk" };
    if (message.code === "99999") return "crash";
    if (message.code === "88888") return undefined;
    return { type: "done", user: USER };
  }
  if (message.type === "password") {
    return message.password === "good" ? { type: "done", user: USER } : { type: "error", retry: true, message: "2FA parol noto'g'ri. Qayta kiriting." };
  }
  return undefined;
}

const stores = [];
function setup({ script, env = ENV, files = [], now, stepTimeoutMs = 2000, ...options } = {}) {
  const store = openStore({ file: ":memory:" });
  stores.push(store);
  const workers = fakeWorkers(script);
  const tgLogin = createTgLogin({
    store,
    env,
    spawn: workers.spawn,
    sessionExists: (name) => files.includes(name),
    stepTimeoutMs,
    log: () => {},
    ...(now ? { now } : {}),
    ...options,
  });
  return { store, tgLogin, workers };
}
after(() => stores.forEach((s) => s.close()));

const rejects = (promise, status, pattern) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });

test("raqam, yashirish va kod: har xil yozilishlar", () => {
  assert.equal(normalizeLoginPhone("+998 90 123-45-67"), "+998901234567");
  assert.equal(normalizeLoginPhone("90 123 45 67"), "+998901234567");
  assert.equal(normalizeLoginPhone("998901234567"), "+998901234567");
  assert.equal(normalizeLoginPhone("00998901234567"), "+998901234567");
  assert.equal(normalizeLoginPhone("+7 (701) 123-45-67"), "+77011234567");
  assert.equal(normalizeLoginPhone("12345"), null);
  assert.equal(normalizeLoginPhone("salom"), null);
  assert.equal(maskPhone("+998901234567"), "+998 90 ••• •• 67");
  assert.equal(maskPhone("+77011234567"), "+7701 ••• •• 67");
  assert.equal(cleanCode("12345"), "12345");
  assert.equal(cleanCode(" 12 345 "), "12345");
  assert.equal(cleanCode("Login code: 54321. Do not give this code to anyone"), "54321");
  assert.equal(cleanCode("kod"), null);
});

test("kirish: raqam → kod (noto'g'ri, keyin 2FA) → parol → tayyor; javoblarda kod, parol va to'liq raqam yo'q", async () => {
  const { tgLogin, workers } = setup();
  assert.equal(tgLogin.current(), null);
  const started = await tgLogin.start({ name: " Ikkinchi ", phone: "+998 90 123 45 67", by: 558 });
  assert.deepEqual([started.name, started.step, started.via, started.codeLength, started.phone], ["ikkinchi", "code", "app", 5, "+998 90 ••• •• 67"]);
  const child = workers.spawned[0];
  assert.deepEqual(child.sent[0], { type: "start", name: "ikkinchi", phone: "+998901234567", taken: {} });

  const wrong = await tgLogin.code(started.id, "11111");
  assert.deepEqual([wrong.step, wrong.error], ["code", "Kod noto'g'ri. Qayta kiriting."]);
  await rejects(tgLogin.code(started.id, "kod yo'q"), 400, /Kodni kiriting/);

  const pw = await tgLogin.code(started.id, "22 222");
  assert.deepEqual([pw.step, pw.hint, pw.error], ["password", "mushuk", null]);
  assert.deepEqual(child.sent.at(-1), { type: "code", code: "22222" });
  await rejects(tgLogin.code(started.id, "33333"), 409, /bosqich/);

  const badPw = await tgLogin.password(started.id, "yomon");
  assert.equal(badPw.step, "password");
  assert.match(badPw.error, /parol noto'g'ri/);
  const done = await tgLogin.password(started.id, "good");
  assert.deepEqual([done.step, done.user], ["done", USER]);
  assert.equal(tgLogin.current().step, "done");

  const shown = JSON.stringify([started, wrong, pw, badPw, done, tgLogin.current()]);
  for (const secret of ["901234567", "22222", "good", "yomon"]) assert.ok(!shown.includes(secret), secret);
});

test("tekshiruvlar: nom, raqam, band nom, bittadan kirish, soatlik chegara", async () => {
  const { store, tgLogin } = setup({ files: ["ikkinchi", "eski"], script: () => ({ type: "error", retry: false, message: "Bu raqam Telegram'da bloklangan." }) });
  store.saveTgAccount("ikkinchi", { userId: "77", status: "ok" });
  store.saveTgAccount("eski", { userId: "78", status: "logged_out", error: "Sessiya bekor qilingan" });
  await rejects(tgLogin.start({ name: "asosiy", phone: "+998901234567" }), 400, /asosiy akkaunt/);
  await rejects(tgLogin.start({ name: "2-akkaunt", phone: "+998901234567" }), 400, /lotin harfi/);
  await rejects(tgLogin.start({ name: "uchinchi", phone: "12" }), 400, /tushunarsiz/);
  await rejects(tgLogin.start({ name: "ikkinchi", phone: "+998901234567" }), 409, /allaqachon ulangan/);

  // Sessiyasi yo'qolgan akkauntga qayta kirsa bo'ladi; Telegram xatosi — «failed» holat (xato emas)
  const failed = await tgLogin.start({ name: "eski", phone: "+998901234567" });
  assert.deepEqual([failed.step, failed.error], ["failed", "Bu raqam Telegram'da bloklangan."]);
  for (let i = 0; i < 4; i++) await tgLogin.start({ name: "uchinchi", phone: "+998901234567" });
  await rejects(tgLogin.start({ name: "uchinchi", phone: "+998901234567" }), 429, /Bir soatda 5 marta/);
});

test("davom etayotgan kirish bo'lsa — ikkinchisi boshlanmaydi; bekor qilish worker'ni to'xtatadi", async () => {
  const { tgLogin, workers } = setup();
  const first = await tgLogin.start({ name: "ikkinchi", phone: "+998901234567" });
  await rejects(tgLogin.start({ name: "uchinchi", phone: "+998901234568" }), 409, /«ikkinchi» akkauntiga kirish davom etyapti/);
  assert.equal(tgLogin.cancel("boshqa-id"), false);
  assert.equal(tgLogin.cancel(first.id), true);
  assert.equal(tgLogin.current(), null);
  assert.deepEqual(workers.spawned[0].sent.at(-1), { type: "cancel" });
  await rejects(tgLogin.code(first.id, "33333"), 404, /endi yo'q/);
  const second = await tgLogin.start({ name: "uchinchi", phone: "+998901234568" });
  assert.equal(second.step, "code");
});

test("ishlab turgan akkauntlar worker'ga beriladi (bir akkaunt ikki nom bilan ulanmasin)", async () => {
  const { store, tgLogin, workers } = setup();
  store.saveTgAccount("asosiy", { userId: "10", status: "ok" });
  store.saveTgAccount("ikkinchi", { userId: "77", status: "error", error: "tarmoq" });
  store.saveTgAccount("eski", { userId: "78", status: "logged_out" });
  await tgLogin.start({ name: "uchinchi", phone: "+998901234567" });
  assert.deepEqual(workers.spawned[0].sent[0].taken, { 10: "asosiy", 77: "ikkinchi" });
});

test("shu raqamli akkaunt allaqachon ulangan — yangi nom bilan kod/parol so'ramasdan rad etiladi", async () => {
  const { store, tgLogin, workers } = setup();
  // «birinchi» nomi bilan to'liq kirib bo'lingan (done → raqam xeshi saqlanadi)
  const first = await tgLogin.start({ name: "birinchi", phone: "+998 90 123 45 67", by: 700 });
  assert.equal((await tgLogin.code(first.id, "33333", 700)).step, "done");
  store.saveTgAccount("birinchi", { userId: "77", status: "ok" }); // collector o'z qatorini yozadi, xesh saqlanib qoladi

  // Shu raqam (boshqacha yozilgan), boshqa nom bilan — kod YUBORILMASDAN 409
  await rejects(tgLogin.start({ name: "ikkinchi", phone: "998901234567" }), 409, /allaqachon «birinchi» nomi bilan ulangan/);
  assert.equal(workers.spawned.length, 1, "dublikat uchun yangi kirish jarayoni ochilmasligi kerak");

  // Sessiyasi yo'qolsa (logged_out) — o'sha raqamga o'z nomi bilan qayta kirsa bo'ladi
  store.saveTgAccount("birinchi", { status: "logged_out" });
  assert.equal((await tgLogin.start({ name: "birinchi", phone: "+998901234567" })).step, "code");
});

test("Telegram javob bermasa yoki worker yiqilsa — «failed», qaytadan boshlasa bo'ladi", async () => {
  const slow = setup({ stepTimeoutMs: 30 });
  const login = await slow.tgLogin.start({ name: "ikkinchi", phone: "+998901234567" });
  // Kutish taymeri unref() — test jarayoni uni kutmay chiqib ketmasin (serverda Express jarayonni tirik ushlaydi)
  const keepAlive = setInterval(() => {}, 1000);
  const hung = await slow.tgLogin.code(login.id, "88888").finally(() => clearInterval(keepAlive));
  assert.equal(hung.step, "failed");
  assert.match(hung.error, /javob bermadi/);
  assert.deepEqual(slow.workers.spawned[0].sent.at(-1), { type: "cancel" });

  const crash = setup();
  const again = await crash.tgLogin.start({ name: "ikkinchi", phone: "+998901234567" });
  const crashed = await crash.tgLogin.code(again.id, "99999");
  assert.equal(crashed.step, "failed");
  assert.match(crashed.error, /kutilmaganda to'xtadi/);
  assert.equal((await crash.tgLogin.start({ name: "ikkinchi", phone: "+998901234567" })).step, "code");
});

test("15 daqiqa harakatsiz — kirish bekor; tugagan kirish ham ro'yxatdan tushadi", async () => {
  let time = 1_800_000_000_000;
  const { tgLogin, workers } = setup({ now: () => time });
  const login = await tgLogin.start({ name: "ikkinchi", phone: "+998901234567" });
  time += 15 * 60_000;
  const expired = tgLogin.current();
  assert.equal(expired.step, "failed");
  assert.match(expired.error, /15 daqiqa ichida tugatilmadi/);
  assert.deepEqual(workers.spawned[0].sent.at(-1), { type: "cancel" });
  await rejects(tgLogin.code(login.id, "33333"), 409, /bosqich/);
  time += 15 * 60_000;
  assert.equal(tgLogin.current(), null);
});

test("server kirish uchun sozlanmagan yoki dasturlash rejimida — boshlanmaydi", async () => {
  const bare = setup({ env: {} });
  assert.match(bare.tgLogin.unavailable(), /TG_API_ID/);
  await rejects(bare.tgLogin.start({ name: "ikkinchi", phone: "+998901234567" }), 409, /TG_API_ID/);
  const dev = setup({ env: { ...ENV, YUK_ENV: "dev" } });
  assert.match(dev.tgLogin.unavailable(), /dasturlash rejimida/);
  assert.equal(setup({ env: { ...ENV, YUK_ENV: "dev", DEV_COLLECTOR: "1" } }).tgLogin.unavailable(), null);
});

test("Mini App API: faqat adminlar; akkauntlar ro'yxati (raqamsiz) va kirish bosqichlari", async () => {
  const { store, tgLogin } = setup();
  const sessions = createSessions(randomBytes(32));
  store.saveDriver(558, { name: "Bosh admin" });
  store.saveDriver(560, { name: "Oddiy" });
  store.saveTgAccount("asosiy", { userId: "10", username: "asosiy_akk", firstName: "Asosiy", status: "ok" });
  store.saveTgAccount("eski", { userId: "78", status: "logged_out", error: "Sessiya bekor qilingan" });
  store.addSource("@guruh");
  const app = createPublicApp({ store, env: { BOT_TOKEN: "1:x", ADMIN_IDS: "558" }, sessions, scope: "qoshni", tgLogin });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, token, body) => {
    const response = await fetch(base + url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const plain = sessions.issue(560);
    assert.equal((await call("GET", "/pub/admin/tg-accounts", plain)).status, 403);
    assert.equal((await call("POST", "/pub/admin/tg-accounts/login", plain, { name: "ikkinchi", phone: "+998901234567" })).status, 403);

    const boss = sessions.issue(558);
    const list = await call("GET", "/pub/admin/tg-accounts", boss);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.accounts.map((a) => [a.name, a.status, a.sources, a.error]),
      [
        ["asosiy", "ok", 1, null],
        ["eski", "logged_out", 0, "Sessiya bekor qilingan"],
      ],
    );
    assert.deepEqual([list.body.login, list.body.unavailable], [null, null]);

    const bad = await call("POST", "/pub/admin/tg-accounts/login", boss, { name: "ikkinchi", phone: "salom" });
    assert.deepEqual([bad.status, bad.body.error], [400, "Telefon raqam tushunarsiz. Masalan: +998 90 123 45 67"]);
    const started = await call("POST", "/pub/admin/tg-accounts/login", boss, { name: "ikkinchi", phone: "+998901234567" });
    assert.equal(started.status, 201);
    assert.equal(started.body.login.step, "code");
    const id = started.body.login.id;
    assert.equal((await call("GET", "/pub/admin/tg-accounts", boss)).body.login.step, "code", "Mini App qayta ochilsa — shu bosqich");
    const pw = await call("POST", `/pub/admin/tg-accounts/login/${id}/code`, boss, { code: "22222" });
    assert.equal(pw.body.login.step, "password");
    const done = await call("POST", `/pub/admin/tg-accounts/login/${id}/password`, boss, { password: "good" });
    assert.deepEqual([done.status, done.body.login.step], [200, "done"]);
    assert.deepEqual((await call("DELETE", `/pub/admin/tg-accounts/login/${id}`, boss)).body, { ok: true });
    assert.equal((await call("GET", "/pub/admin/tg-accounts", boss)).body.login, null);
  } finally {
    server.close();
  }
});

test("eski server (tgLogin berilmagan): ro'yxat ochiladi, kirish — «qayta ishga tushirilgach»", async () => {
  const store = openStore({ file: ":memory:" });
  stores.push(store);
  const sessions = createSessions(randomBytes(32));
  store.saveDriver(558, { name: "Bosh admin" });
  const app = createPublicApp({ store, env: { BOT_TOKEN: "1:x", ADMIN_IDS: "558" }, sessions, scope: "qoshni" });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { authorization: `Bearer ${sessions.issue(558)}`, "content-type": "application/json" };
    const list = await (await fetch(`${base}/pub/admin/tg-accounts`, { headers })).json();
    assert.match(list.unavailable, /qayta ishga tushirilgach/);
    const start = await fetch(`${base}/pub/admin/tg-accounts/login`, { method: "POST", headers, body: JSON.stringify({ name: "ikkinchi", phone: "+998901234567" }) });
    assert.equal(start.status, 409);
  } finally {
    server.close();
  }
});

test("foydalanuvchi o'zi uchun: nomni server beradi, egasi yoziladi, boshqaning kirishi va akkauntiga tegolmaydi", async () => {
  const { store, tgLogin } = setup({ userMaxAccounts: 2 });
  // Begona nom (asosiy yoki boshqaning akkaunti) bilan «qayta kirish» — 404
  store.saveTgAccount("ikkinchi", { userId: "77", status: "logged_out" });
  await rejects(tgLogin.start({ name: "asosiy", phone: "+998901234567", by: 560, mine: true }), 404, /akkauntingiz yo'q/);
  await rejects(tgLogin.start({ name: "ikkinchi", phone: "+998901234567", by: 560, mine: true }), 404, /akkauntingiz yo'q/);

  const a = await tgLogin.start({ phone: "+998901234567", by: 560, mine: true });
  assert.equal(a.name, "ufk-1");
  // Boshqa foydalanuvchi: o'z kirishi bor, birinchisinikini ko'rmaydi va boshqarolmaydi
  const b = await tgLogin.start({ phone: "+998901234568", by: 561, mine: true });
  assert.equal(b.name, "ufl-1");
  assert.equal(tgLogin.current(560).id, a.id);
  assert.equal(tgLogin.current(561).id, b.id);
  assert.equal(tgLogin.current(999), null);
  await rejects(tgLogin.code(a.id, "12345", 561), 404, /endi yo'q/);
  assert.equal(tgLogin.cancel(a.id, 561), false);

  const done = await tgLogin.code(a.id, "12345", 560);
  assert.equal(done.step, "done");
  assert.equal(store.listTgAccounts().find((x) => x.name === "ufk-1").addedBy, 560);
  // Collector keyin o'z ma'lumotini yozsa ham egasi qoladi
  store.saveTgAccount("ufk-1", { userId: "90", status: "ok" });
  assert.equal(store.listTgAccounts().find((x) => x.name === "ufk-1").addedBy, 560);

  // Keyingi akkaunt — keyingi nom; chegara (2 ta) to'lsa — 409
  const second = await tgLogin.start({ phone: "+998901234569", by: 560, mine: true });
  assert.equal(second.name, "ufk-2");
  await tgLogin.code(second.id, "12345", 560);
  store.saveTgAccount("ufk-2", { userId: "91", status: "ok" });
  await rejects(tgLogin.start({ phone: "+998901234560", by: 560, mine: true }), 409, /ko'pi bilan 2 ta/);
  // Sessiyasi yo'qolgan o'z akkauntiga qayta kirish — mumkin
  store.saveTgAccount("ufk-2", { status: "logged_out" });
  assert.equal((await tgLogin.start({ name: "ufk-2", phone: "+998901234569", by: 560, mine: true })).name, "ufk-2");
});

test("foydalanuvchilar chegarasi admin limitiga tegmaydi; bir vaqtda kirishlar soni cheklangan", async () => {
  const { tgLogin } = setup({ userStartsPerHour: 2, usersStartsPerHour: 3, maxUserLogins: 2 });
  const one = await tgLogin.start({ phone: "+998901234567", by: 1, mine: true });
  tgLogin.cancel(one.id, 1);
  await tgLogin.start({ phone: "+998901234567", by: 1, mine: true });
  await rejects(tgLogin.start({ phone: "+998901234567", by: 1, mine: true }), 409, /davom etyapti/);
  await tgLogin.start({ phone: "+998901234568", by: 2, mine: true });
  // 2 ta kirish davom etyapti — uchinchi foydalanuvchi kutadi
  await rejects(tgLogin.start({ phone: "+998901234569", by: 3, mine: true }), 429, /boshqa foydalanuvchilar/);
  for (const login of [tgLogin.current(1), tgLogin.current(2)]) tgLogin.cancel(login.id);
  // Bir foydalanuvchi soatiga 2 marta (1-chi 2 marta so'radi)
  await rejects(tgLogin.start({ phone: "+998901234567", by: 1, mine: true }), 429, /2 marta kod so'radingiz/);
  // Hammasi birga — 3 marta (1: 2 ta, 2: 1 ta)
  await rejects(tgLogin.start({ phone: "+998901234569", by: 3, mine: true }), 429, /juda ko'p kod/);
  // Admin bularga qaramaydi
  assert.equal((await tgLogin.start({ name: "ikkinchi", phone: "+998901234567", by: 558 })).step, "code");
});

test("Mini App API /pub/me/tg-accounts: har kim faqat o'zinikini ko'radi, admin emas ham", async () => {
  const { store, tgLogin } = setup();
  const sessions = createSessions(randomBytes(32));
  store.saveDriver(560, { name: "Oddiy" });
  store.saveDriver(561, { name: "Boshqa" });
  store.saveTgAccount("asosiy", { userId: "10", status: "ok" });
  store.setTgAccountOwner("ufl-1", 561);
  store.saveTgAccount("ufl-1", { userId: "11", status: "ok" });
  const app = createPublicApp({ store, env: { BOT_TOKEN: "1:x" }, sessions, scope: "qoshni", tgLogin });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, token, body) => {
    const response = await fetch(base + url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const me = sessions.issue(560);
    const other = sessions.issue(561);
    assert.equal((await fetch(`${base}/pub/me/tg-accounts`)).status, 401);
    const empty = await call("GET", "/pub/me/tg-accounts", me);
    assert.deepEqual([empty.status, empty.body.accounts, empty.body.login, empty.body.unavailable], [200, [], null, null]);
    assert.deepEqual((await call("GET", "/pub/me/tg-accounts", other)).body.accounts.map((a) => a.name), ["ufl-1"]);

    const started = await call("POST", "/pub/me/tg-accounts/login", me, { phone: "+998901234567", name: "" });
    assert.deepEqual([started.status, started.body.login.name, started.body.login.step], [201, "ufk-1", "code"]);
    const id = started.body.login.id;
    assert.equal((await call("GET", "/pub/me/tg-accounts", other)).body.login, null);
    assert.equal((await call("POST", `/pub/me/tg-accounts/login/${id}/code`, other, { code: "12345" })).status, 404);
    assert.deepEqual((await call("DELETE", `/pub/me/tg-accounts/login/${id}`, other)).body, { ok: false });
    assert.equal((await call("POST", "/pub/me/tg-accounts/login", me, { phone: "+998901234567", name: "ufl-1" })).status, 409, "kirish davom etyapti");

    const done = await call("POST", `/pub/me/tg-accounts/login/${id}/code`, me, { code: "12345" });
    assert.equal(done.body.login.step, "done");
    assert.deepEqual((await call("GET", "/pub/me/tg-accounts", me)).body.accounts.map((a) => a.name), ["ufk-1"]);
    // Admin yo'li oddiy foydalanuvchiga hamon yopiq
    assert.equal((await call("GET", "/pub/admin/tg-accounts", me)).status, 403);
  } finally {
    server.close();
  }
});

// Server (tgLogin) + HAQIQIY worker (createLoginSession) birga — fork o'rniga in-process ulanadi.
// Boshqa testlar ikkalasini ALOHIDA soxtalashtiradi; bu — ular orasidagi shartnomani (xato parol → qayta so'rash)
// uchidan-uchiga qulflaydi. Azimjon hodisasi: «2FA 1 marta xato bo'lsa boshidan» — bu bo'lmasligi kerak.
function bridgeWorkerStore() {
  const USER = { id: 77, username: "yuk_ikki", firstName: "Ikki" };
  const err = (code) => Object.assign(new Error(code), { errorMessage: code });
  const telegram = {
    createClient: async () => ({ fake: true }),
    sendLoginCode: async () => ({ phoneCodeHash: "h1", via: "app", length: 5 }),
    signInWithCode: async (c, { code }) => (code === "22222" ? { password: true, hint: "mushuk" } : { user: USER }),
    signInWithPassword: async (c, pw) => {
      if (pw !== "good") throw err("PASSWORD_HASH_INVALID");
      return { user: USER };
    },
    userInfo: (u) => ({ userId: String(u.id), username: u.username, firstName: u.firstName }),
    saveSession: async () => {},
    closeAuthorization: async () => {},
    disconnect: async () => {},
  };
  const spawn = () => {
    const child = new EventEmitter();
    child.sent = [];
    const session = createLoginSession({ telegram, send: async (m) => void child.emit("message", m) });
    child.send = (m) => {
      child.sent.push(m);
      if (m?.type === "cancel") return void child.emit("exit", 0);
      session.handle(m);
    };
    child.kill = () => child.emit("exit", null);
    return child;
  };
  const store = openStore({ file: ":memory:" });
  stores.push(store);
  return createTgLogin({ store, env: ENV, spawn, log: () => {} });
}

test("haqiqiy worker bilan: 2FA bir marta xato bo'lsa — parol bosqichida qoladi, 3 urinishdan keyin to'xtaydi", async () => {
  const tgLogin = bridgeWorkerStore();
  const s = await tgLogin.start({ name: "ikkinchi", phone: "+998901234567", by: 5 });
  assert.equal((await tgLogin.code(s.id, "22222", 5)).step, "password");

  // 1-xato: boshiga QAYTMAYDI — parol bosqichida qoladi, «Qayta kiriting»
  const p1 = await tgLogin.password(s.id, "yomon", 5);
  assert.equal(p1.step, "password", "bir marta xato — kirish boshidan boshlanmasligi kerak");
  assert.match(p1.error, /Qayta kiriting/);

  // 2-xato ham: hali qayta urinsa bo'ladi
  assert.equal((await tgLogin.password(s.id, "yomon2", 5)).step, "password");

  // 3-xato: urinishlar tugadi
  const p3 = await tgLogin.password(s.id, "yomon3", 5);
  assert.equal(p3.step, "failed");
  assert.match(p3.error, /Urinishlar tugadi/);
});

test("haqiqiy worker bilan: xato parol, keyin to'g'ri parol — kirish tugaydi", async () => {
  const tgLogin = bridgeWorkerStore();
  const s = await tgLogin.start({ name: "ikkinchi", phone: "+998901234567", by: 5 });
  await tgLogin.code(s.id, "22222", 5);
  assert.equal((await tgLogin.password(s.id, "yomon", 5)).step, "password");
  const done = await tgLogin.password(s.id, "good", 5);
  assert.deepEqual([done.step, done.user.userId], ["done", "77"]);
});
