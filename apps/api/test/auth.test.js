// Boshqaruv markaziga kirish (adminAuth.js + app.js'dagi sessiya eshigi).
// Sinov: xato/to'g'ri login va parol, cookie va Bearer token, login/parolni qo'yish va almashtirish,
// urinishlar limiti. (2026-11-11, Azimjon: «login sahifa ... username va parolli bo'lishligi kerak» —
// kirish endi LOGIN + PAROL; xato login va xato parolda bir xil javob qaytadi.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { checkNewPassword, hashPassword, parseCookies, verifyPassword } from "../src/adminAuth.js";

const secret = Buffer.alloc(32, 7);
const processes = { list: () => [], start: async (n) => ({ name: n }), stop: async (n) => ({ name: n }), restart: async (n) => ({ name: n }), logs: () => ({ lines: [], last: 0 }) };
const JSON_ADMIN = { "x-yuk-admin": "1", "content-type": "application/json" };

// Har sinov o'z IP'si bilan urinadi — urinishlar limiti bir-biriga xalaqit bermasin
async function startEnv(env) {
  const store = openStore({ file: ":memory:" });
  const app = createApp({ store, processes, env, secret });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, ip = "9.9.9.1" } = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...JSON_ADMIN, "x-forwarded-for": ip, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* HTML / matn javob */
    }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  const cookieOf = (answer) => {
    const raw = answer.headers.getSetCookie?.() ?? [];
    const line = raw.find((c) => c.startsWith("yuk_admin="));
    return line ? line.split(";")[0] : null;
  };
  return { store, server, call, cookieOf, port: server.address().port };
}

let ctx, store, server;
before(async () => {
  ctx = await startEnv({ ADMIN_PASS: "parol-12345" });
  ({ store, server } = ctx);
});
after(() => {
  server.close();
  store.close();
});

test("parol hisobi: scrypt, bir xil parol — har safar boshka qator; tekshirish to'g'ri/xato", () => {
  const a = hashPassword("salom-12345");
  const b = hashPassword("salom-12345");
  assert.notEqual(a, b, "salt tufayli qatorlar har xil");
  assert.ok(a.startsWith("scrypt:"));
  assert.ok(!a.includes("salom"));
  assert.equal(verifyPassword("salom-12345", a), true);
  assert.equal(verifyPassword("salom-1234", a), false);
  assert.equal(verifyPassword("salom-12345", "to'g'ri-emas"), false);
  assert.equal(verifyPassword("salom-12345", ""), false);
});

test("cookie sarlavhasi ajratiladi (= belgisi va bo'sh qiymatlar bilan)", () => {
  assert.deepEqual(parseCookies("a=1; yuk_admin=abc.def; b=2"), { a: "1", yuk_admin: "abc.def", b: "2" });
  assert.deepEqual(parseCookies("yuk_admin="), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test("yangi parol talabi: kamida 8 belgi, ikki marta bir xil", () => {
  assert.equal(checkNewPassword("parol-12345", "parol-12345"), "parol-12345");
  assert.throws(() => checkNewPassword("qisqa", "qisqa"), /kamida 8 belgi/);
  assert.throws(() => checkNewPassword("uzunparol12", "boshqa"), /bir xil yozilmadi/);
});

test("parol qo'yilgan — /api/overview sessiyasiz 401, /api/session ochiq va ulanish holatini aytadi", async () => {
  const anonymous = await ctx.call("GET", "/api/overview", {});
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.body.error, /Kirish/);

  const session = await ctx.call("GET", "/api/session", { ip: "9.9.9.2" });
  assert.equal(session.status, 200);
  assert.deepEqual({ signedIn: session.body.signedIn, configured: session.body.configured, source: session.body.source }, {
    signedIn: false,
    configured: true,
    source: "env",
  });
  // KIRMAGAN odam login'ni bilmaydi (uni sinab topmasin)
  assert.equal(session.body.login, null);
  assert.equal(session.body.envLogin, null, "hisob qo'yilgan bo'lsa envLogin ham yo'q (login hech qayerda ko'rinmaydi)");

  // kirgandan keyin — login qaytadi (panel «Hisob» oynasida ko'rsatadi)
  const in1 = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.2" });
  const seen = await ctx.call("GET", "/api/session", { headers: { cookie: ctx.cookieOf(in1) }, ip: "9.9.9.2" });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.signedIn, true);
  assert.equal(seen.body.login, "admin");
  assert.equal(seen.body.user, "admin", "tokendagi «kim» ham qaytadi");
});

test("login: xato parol 401, to'g'ri parol — httpOnly cookie va sessiya ishlaydi", async () => {
  const wrong = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "notogri" }, ip: "9.9.9.3" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "Login yoki parol noto'g'ri");

  // LOGIN bilan xatolik — xabar PAROL bilan xatoda bilan BIR XIL: tashqaridagi odam login'ni
  // sinab topib olmasin (enumeratsiya)
  const wrongUser = await ctx.call("POST", "/api/login", { body: { username: "boshqa-odam", password: "parol-12345" }, ip: "9.9.9.3" });
  assert.equal(wrongUser.status, 401);
  assert.equal(wrongUser.body.error, wrong.body.error);

  // bo'sh login va bo'sh parol — 400 (nechta urinish bo'lishidan qat'i nazar)
  const empty = await ctx.call("POST", "/api/login", { body: {}, ip: "9.9.9.3" });
  assert.equal(empty.status, 400);

  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.4" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.login, "admin", "LOGIN so'rovida qaytadi (sahifa uni keyin ko'rsatadi)");
  const cookie = ctx.cookieOf(ok);
  assert.ok(cookie?.startsWith("yuk_admin="), "cookie qaytarildi");

  const withCookie = await ctx.call("GET", "/api/overview", { headers: { cookie }, ip: "9.9.9.5" });
  assert.equal(withCookie.status, 200);
  assert.ok(withCookie.body.metrics, "ma'lumot keldi");

  // cookie'da httpOnly va Path=/ — JS o'qiy olmaydi, boshqa yo'l bilan ham ochilmaydi
  const setCookie = (ok.headers.getSetCookie() ?? []).join(";");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /SameSite=Lax/);
});

test("Bearer token (curl/sinov) cookie o'rniga ishlaydi, noto'g'ri token 401", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.6" });
  const token = ctx.cookieOf(ok).slice("yuk_admin=".length);
  const byBearer = await ctx.call("GET", "/api/processes", { headers: { authorization: `Bearer ${token}` }, ip: "9.9.9.7" });
  assert.equal(byBearer.status, 200);
  const fake = await ctx.call("GET", "/api/processes", { headers: { authorization: "Bearer abc.def" }, ip: "9.9.9.7" });
  assert.equal(fake.status, 401);
});

test("o'zgartiruvchi so'rov sessiya BILAN ham x-yuk-admin'siz 403 (CSRF himoyasi ishlab turadi)", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.8" });
  const cookie = ctx.cookieOf(ok);
  const noHeader = await ctx.call("POST", "/api/posts/retry-failed", { body: {}, headers: { cookie, "x-yuk-admin": "" }, ip: "9.9.9.9" });
  assert.equal(noHeader.status, 403);
  const withHeader = await ctx.call("POST", "/api/posts/retry-failed", { body: {}, headers: { cookie }, ip: "9.9.9.9" });
  assert.equal(withHeader.status, 200);
});

// Host localhost bo'lmasa — hech qanday sessiya yordam bermaydi (fetch Host sarlavhasini o'zgartira olmaydi,
// shuning uchun node:http bilan yozamiz)
async function rawGet(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET", headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("Host almashtirilib kelsa (DNS rebinding) — sessiya bo'lsa ham 403", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.11" });
  const cookie = ctx.cookieOf(ok);
  const bad = await rawGet(ctx.port, "/api/overview", { host: "evil.example", cookie });
  assert.equal(bad.status, 403);
  assert.match(bad.text, /faqat shu kompyuterdan/);
  const good = await rawGet(ctx.port, "/api/overview", { host: "localhost:3000", cookie });
  assert.equal(good.status, 200);
});

test("urinishlar limiti: ketma-ket xato paroldan keyin 429, boshqa IP ta'sirlanmaydi", async () => {
  const ip = "9.9.9.20";
  let last;
  for (let i = 0; i < 9; i += 1) last = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "notogri" }, ip });
  assert.equal(last.status, 429);
  assert.match(last.body.error, /Juda ko'p urinish/);
  // to'g'ri parol ham shu IP uchun hozir rad etiladi
  const right = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip });
  assert.equal(right.status, 429);
  const other = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.21" });
  assert.equal(other.status, 200);
});

test("logout cookie'ni o'chiradi, sessiya yana so'raladi", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.30" });
  const cookie = ctx.cookieOf(ok);
  const out = await ctx.call("POST", "/api/logout", { body: {}, headers: { cookie }, ip: "9.9.9.30" });
  assert.equal(out.status, 200);
  assert.match((out.headers.getSetCookie() ?? []).join(";"), /yuk_admin=;.*Max-Age=0/);
});

test("parolni almashtirish: eski parol tasdiqlanadi, keyingi kirish yangi parol bilan", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.40" });
  const cookie = ctx.cookieOf(ok);
  const wrongOld = await ctx.call("POST", "/api/password", { body: { oldPassword: "notogri", password: "yana-yangi-1", repeat: "yana-yangi-1" }, headers: { cookie }, ip: "9.9.9.41" });
  assert.equal(wrongOld.status, 401);
  const shortNew = await ctx.call("POST", "/api/password", { body: { oldPassword: "parol-12345", password: "qisqa", repeat: "qisqa" }, headers: { cookie }, ip: "9.9.9.41" });
  assert.equal(shortNew.status, 400);

  const changed = await ctx.call("POST", "/api/password", { body: { oldPassword: "parol-12345", password: "yana-yangi-1", repeat: "yana-yangi-1" }, headers: { cookie }, ip: "9.9.9.42" });
  assert.equal(changed.status, 200);
  const oldPass = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "parol-12345" }, ip: "9.9.9.43" });
  assert.equal(oldPass.status, 401);
  const newPass = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "yana-yangi-1" }, ip: "9.9.9.44" });
  assert.equal(newPass.status, 200);
  assert.equal(store.getSetting("admin_pass_source"), "manual", "panel orqali qo'yilgan parol — manual");
});

test("MENI ESLAB QOL: cookie muddati uzunroq bo'ladi", async () => {
  const short = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "yana-yangi-1" }, ip: "9.9.9.50" });
  const long = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "yana-yangi-1", remember: true }, ip: "9.9.9.51" });
  const maxAge = (answer) => Number(/Max-Age=(\d+)/.exec((answer.headers.getSetCookie() ?? []).join(";"))?.[1] ?? 0);
  assert.ok(maxAge(long) > maxAge(short) * 10, "30 kun > 12 soat");
});

test("login: katta-kichik harf va bo'sh joy farq qilmaydi, yaroqsiz login 400", async () => {
  // parol bu sinovlarga qadar «yana-yangi-1» ga almashtirilgan (yuqoridagi sinov)
  const up = await ctx.call("POST", "/api/login", { body: { username: "  ADMIN  ", password: "yana-yangi-1" }, ip: "9.9.9.70" });
  assert.equal(up.status, 200, "login — bo'sh joylari olinib kichik harfda solishtiriladi");
  const noUser400 = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "" }, ip: "9.9.9.71" });
  assert.equal(noUser400.status, 400);
  assert.match(noUser400.body.error, /Parolni kiriting/);
});

test("normalizeLogin: uzunlik va belgilar tekshiriladi", async () => {
  const { normalizeLogin } = await import("../src/adminAuth.js");
  assert.equal(normalizeLogin(" Azimjon "), "azimjon");
  assert.equal(normalizeLogin("a.b-c_d@1"), "a.b-c_d@1");
  assert.throws(() => normalizeLogin("ab"), /kamida 3 belgi/);
  assert.throws(() => normalizeLogin("a".repeat(41)), /juda uzun/);
  assert.throws(() => normalizeLogin("parol hisobiga"), /faqat harf/);
  assert.throws(() => normalizeLogin(""), /kamida 3 belgi/);
});

test(".env ADMIN_LOGIN: bazada login bo'lmasa — shundan; panel orqali o'zgartirilganni bosib ketmaydi", async () => {
  const c = await startEnv({ ADMIN_PASS: "env-paroli-1", ADMIN_LOGIN: "Azimjon" });
  try {
    const ok = await c.call("POST", "/api/login", { body: { username: "azimjon", password: "env-paroli-1" }, ip: "7.7.7.1" });
    assert.equal(ok.status, 200, ".env'dagi login ishlaydi (kichik harfda saqlanadi)");
    const oldAdmin = await c.call("POST", "/api/login", { body: { username: "admin", password: "env-paroli-1" }, ip: "7.7.7.2" });
    assert.equal(oldAdmin.status, 401, "login qo'yilgach «admin» ishlamaydi");

    // paneldan o'zgartirilgan login'ni keyingi .env bosib keta olmaydi
    const cookie = c.cookieOf(ok);
    const changed = await c.call("POST", "/api/account", { body: { username: "yuk-ekspert", oldPassword: "env-paroli-1" }, headers: { cookie }, ip: "7.7.7.3" });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.login, "yuk-ekspert");

    const c2 = await startEnvWith(c.store, { ADMIN_PASS: "env-paroli-1", ADMIN_LOGIN: "boshqacha" });
    const still = await c2.call("POST", "/api/login", { body: { username: "yuk-ekspert", password: "env-paroli-1" }, ip: "7.7.7.4" });
    assert.equal(still.status, 200, "manual login .env'dan kuchli");
    c2.server.close();
  } finally {
    c.server.close();
    c.store.close();
  }
});

// Bir xil store bilan ikkinchi server (muhit boshqacha) — «.env o'zgarganda nima bo'ladi?» sinovi uchun
async function startEnvWith(store, env) {
  const app = createApp({ store, processes, env, secret });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, ip = "7.0.0.1" } = {}) => {
    const r = await fetch(base + url, { method, headers: { ...JSON_ADMIN, "x-forwarded-for": ip, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
  };
  return { server, call };
}

test("/api/account: login va parol birga yoki alohida o'zgaradi; eski parol shart; sessiya uzilmaydi", async () => {
  const c = await startEnv({ ADMIN_PASS: "hisob-paroli-1" });
  try {
    const login = await c.call("POST", "/api/login", { body: { username: "admin", password: "hisob-paroli-1" }, ip: "6.6.6.1" });
    assert.equal(login.status, 200);
    const cookie = c.cookieOf(login);

    // eski parolsiz — 401 (sessiya bo'lsa ham)
    const noOld = await c.call("POST", "/api/account", { body: { username: "yangi-login" }, headers: { cookie }, ip: "6.6.6.2" });
    assert.equal(noOld.status, 401);
    assert.equal(noOld.body.error, "Eski parol noto'g'ri");

    // hech narsa berilmasa — 400
    const nothing = await c.call("POST", "/api/account", { body: { oldPassword: "hisob-paroli-1" }, headers: { cookie }, ip: "6.6.6.2" });
    assert.equal(nothing.status, 400);

    // faqat LOGIN o'zgaradi, parol eskicha qoladi
    const onlyLogin = await c.call("POST", "/api/account", { body: { username: "  Yuk.Ekspert ", oldPassword: "hisob-paroli-1" }, headers: { cookie }, ip: "6.6.6.3" });
    assert.equal(onlyLogin.status, 200);
    assert.equal(onlyLogin.body.login, "yuk.ekspert");
    const oldPassNewLogin = await c.call("POST", "/api/login", { body: { username: "yuk.ekspert", password: "hisob-paroli-1" }, ip: "6.6.6.4" });
    assert.equal(oldPassNewLogin.status, 200);
    assert.equal((await c.call("POST", "/api/login", { body: { username: "admin", password: "hisob-paroli-1" }, ip: "6.6.6.5" })).status, 401);

    // eski sessiya tokeni o'z kuchida (hisob o'zgargan bilan chiqarib yuborilmaydi)
    const stillIn = await c.call("GET", "/api/overview", { headers: { cookie }, ip: "6.6.6.6" });
    assert.equal(stillIn.status, 200);
    const who = await c.call("GET", "/api/session", { headers: { cookie }, ip: "6.6.6.6" });
    assert.equal(who.body.login, "yuk.ekspert", "sessiya holatida hozirgi login ko'rsatiladi");

    // login + PAROL birga
    const both = await c.call("POST", "/api/account", { body: { username: "azimjon", oldPassword: "hisob-paroli-1", password: "yangi-parol-1", repeat: "yangi-parol-1" }, headers: { cookie }, ip: "6.6.6.7" });
    assert.equal(both.status, 200);
    assert.equal(both.body.login, "azimjon");
    assert.equal((await c.call("POST", "/api/login", { body: { username: "azimjon", password: "yangi-parol-1" }, ip: "6.6.6.8" })).status, 200);
    assert.equal((await c.call("POST", "/api/login", { body: { username: "azimjon", password: "hisob-paroli-1" }, ip: "6.6.6.9" })).status, 401);

    // yaroqsiz login — 400 va hisob o'zgarmaydi
    const bad = await c.call("POST", "/api/account", { body: { username: "x", oldPassword: "yangi-parol-1" }, headers: { cookie }, ip: "6.6.6.10" });
    assert.equal(bad.status, 400);
    assert.equal((await c.call("POST", "/api/login", { body: { username: "azimjon", password: "yangi-parol-1" }, ip: "6.6.6.11" })).status, 200);
  } finally {
    c.server.close();
    c.store.close();
  }
});

test("birinchi ishga tushirish: parol yo'q — panel ochiq, /api/setup parolni qo'yadi va keyin sessiya talab qilinadi", async () => {
  const c = await startEnv({}); // ADMIN_PASS yo'q
  try {
    const open = await c.call("GET", "/api/overview", { ip: "8.8.8.1" });
    assert.equal(open.status, 200, "parol qo'yilmagan — sahifa ochiladi (birinchi parolni qo'yish uchun)");

    const session = await c.call("GET", "/api/session", { ip: "8.8.8.2" });
    assert.deepEqual({ signedIn: session.body.signedIn, configured: session.body.configured }, { signedIn: false, configured: false });

    const setup = await c.call("POST", "/api/setup", { body: { username: "admin", password: "birinchi-parol", repeat: "birinchi-parol" }, ip: "8.8.8.3" });
    assert.equal(setup.status, 200);
    const cookie = c.cookieOf(setup);
    assert.ok(cookie, "setup darhol sessiya beradi");

    const again = await c.call("POST", "/api/setup", { body: { username: "admin", password: "ikkinchi-parol", repeat: "ikkinchi-parol" }, ip: "8.8.8.4" });
    assert.equal(again.status, 409);

    // endi eshik yopildi
    const blocked = await c.call("GET", "/api/overview", { ip: "8.8.8.5" });
    assert.equal(blocked.status, 401);
    const withCookie = await c.call("GET", "/api/overview", { headers: { cookie }, ip: "8.8.8.6" });
    assert.equal(withCookie.status, 200);

    // .env'da parol bo'lmasa ham manual parol o'z kuchida
    const login = await c.call("POST", "/api/login", { body: { username: "admin", password: "birinchi-parol" }, ip: "8.8.8.7" });
    assert.equal(login.status, 200);
  } finally {
    c.server.close();
    c.store.close();
  }
});

test(".env paroli: «env» hisobini yangilaydi, «manual» hisobni bosib keta olmaydi", async () => {
  const a = await startEnv({ ADMIN_PASS: "env-paroli-1" });
  const b = await startEnv({ ADMIN_PASS: "env-paroli-2" });
  try {
    // ikkalasi ham bitta bazadan foydalanmasa ham, o'z store'ida mustaqil: oldin qo'yilgan manual parolni tekshiramiz
    const store = a.store;
    store.setSetting("admin_pass_hash", hashPassword("manual-parol"));
    store.setSetting("admin_pass_source", "manual");
    // shu store bilan yangi server — .env o'zgargan, lekin parol o'zgarmasligi kerak
    const app = createApp({ store, processes, env: { ADMIN_PASS: "env-paroli-3" }, secret });
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${srv.address().port}/api/login`;
    const manual = await fetch(url, { method: "POST", headers: JSON_ADMIN, body: JSON.stringify({ username: "admin", password: "manual-parol" }) });
    assert.equal(manual.status, 200, "manual parol saqlanib qoldi");
    const envNew = await fetch(url, { method: "POST", headers: JSON_ADMIN, body: JSON.stringify({ username: "admin", password: "env-paroli-3" }) });
    assert.equal(envNew.status, 401, ".env paroli manual parolni almashtirmadi");
    srv.close();

    // «env» hisobi bo'lsa — ADMIN_PASS o'zgarsa parol ham yangilanadi
    const store2 = b.store;
    assert.equal(store2.getSetting("admin_pass_source"), "env");
    const app2 = createApp({ store: store2, processes, env: { ADMIN_PASS: "env-paroli-9" }, secret });
    const srv2 = await new Promise((resolve) => {
      const s = app2.listen(0, "127.0.0.1", () => resolve(s));
    });
    const ok = await fetch(`http://127.0.0.1:${srv2.address().port}/api/login`, { method: "POST", headers: JSON_ADMIN, body: JSON.stringify({ username: "admin", password: "env-paroli-9" }) });
    assert.equal(ok.status, 200, ".env o'zgargan — yangi parol ishlaydi");
    srv2.close();
  } finally {
    a.server.close();
    a.store.close();
    b.server.close();
    b.store.close();
  }
});

test("sessiya qayta yoqilgandan keyin ham ishlaydi (token kaliti serverda), muddati o'tsa — 401", async () => {
  const ok = await ctx.call("POST", "/api/login", { body: { username: "admin", password: "yana-yangi-1" }, ip: "9.9.9.60" });
  const token = ctx.cookieOf(ok).slice("yuk_admin=".length);
  // token — imzolangan qator: muddatini buzib ko'rsak (boshqa qism = yaroqsiz imzo) qabul qilinmaydi
  const tampered = `${token.split(".")[0].slice(0, -2)}aa.${token.split(".")[1]}`;
  const bad = await ctx.call("GET", "/api/overview", { headers: { authorization: `Bearer ${tampered}` }, ip: "9.9.9.61" });
  assert.equal(bad.status, 401);
  // kalit boshqa bo'lgan server (bitta baza) tokenni taniymaydi
  const other = createApp({ store, processes, env: {}, secret: Buffer.alloc(32, 11) });
  const srv = await new Promise((resolve) => {
    const s = other.listen(0, "127.0.0.1", () => resolve(s));
  });
  const foreign = await fetch(`http://127.0.0.1:${srv.address().port}/api/overview`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(foreign.status, 401);
  srv.close();
});
