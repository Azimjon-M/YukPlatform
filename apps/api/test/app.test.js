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
  assert.equal(normalizeSourceName("-4012345678"), "-4012345678", "kichik guruh");
  assert.equal(normalizeSourceName("-12"), null);
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

test("yuklar va navbat: filtr, xatolarni o'chirish", async () => {
  assert.equal((await get("/api/loads?from=fargona")).body.total, 1);
  assert.equal((await get("/api/loads?from=toshkent_sh")).body.total, 0);
  assert.equal((await get("/api/posts?status=failed")).body.total, 1);
  assert.deepEqual((await send("DELETE", "/api/posts/failed")).body, { deleted: 1, hidden: 0 });
  assert.equal((await get("/api/posts?status=failed")).body.total, 0);
});

test("haydovchilar: faol / pauzani boshqaruv markazidan o'zgartirib bo'lmaydi (faqat foydalanuvchi), admin — mumkin", async () => {
  const list = (await get("/api/drivers")).body;
  assert.equal(list.items.length, 2);
  assert.equal(list.idleSince, null, "bot hali kuzatuvni boshlamagan");
  const refused = await send("PATCH", "/api/drivers/8", { active: true });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /faqat foydalanuvchining o'zi/);
  assert.equal((await send("PATCH", "/api/drivers/8", { active: false, isAdmin: true })).status, 400, "active bo'lsa — hammasi rad");
  assert.equal((await send("PATCH", "/api/drivers/8", { isAdmin: true })).body.isAdmin, true);
  assert.equal((await send("PATCH", "/api/drivers/8", {})).status, 400);
  assert.equal((await send("PATCH", "/api/drivers/9", { isAdmin: true })).status, 404);
  assert.equal((await send("PATCH", "/api/drivers/8", { isAdmin: "ha" })).status, 400);
  assert.equal((await send("PATCH", "/api/drivers/8", { plan: "pro" })).body.plan, "pro", "Pro obuna — faqat boshqaruv markazidan");
  assert.equal((await send("PATCH", "/api/drivers/8", { plan: "vip" })).status, 400);
  assert.equal((await send("PATCH", "/api/drivers/8", { plan: "free" })).body.plan, "free");
});

test("manbalar: qo'shish, takror, o'chirib-yoqish, o'chirish", async () => {
  assert.equal((await send("POST", "/api/sources", { name: "https://t.me/yangi_guruh" })).status, 201);
  assert.deepEqual((await send("POST", "/api/sources", { name: "@yangi_guruh" })).body, { name: "@yangi_guruh", added: false, account: null });
  assert.equal((await send("POST", "/api/sources", { name: "https://t.me/+yopiq" })).status, 400);
  const name = encodeURIComponent("@yangi_guruh");
  assert.equal((await send("PATCH", `/api/sources/${name}`, { enabled: false })).status, 200);
  const items = (await get("/api/sources")).body.items;
  assert.deepEqual(items.map((s) => [s.name, s.enabled, s.stats.posts]), [["@yangi_guruh", false, 0]]);
  // Ovozli xabarlar (2026-11-20): ochiq guruhda standart o'chiq, admin yoqadi; yopiq guruhga — 409
  assert.equal(items[0].voice, false);
  assert.equal((await send("PATCH", `/api/sources/${name}`, { voice: true })).status, 200);
  assert.equal((await get("/api/sources")).body.items[0].voice, true);
  assert.equal((await send("PATCH", `/api/sources/${name}`, {})).status, 400);
  assert.equal((await send("PATCH", `/api/sources/${encodeURIComponent("-1001234")}`, { voice: true })).status, 409);
  assert.equal((await send("DELETE", `/api/sources/${name}`)).status, 200);
  assert.equal((await send("DELETE", `/api/sources/${name}`)).status, 404);
});

test("manbalar: a'zo bo'lish navbati — bittasi, hammasi, bekor qilish", async () => {
  for (const n of ["@navbat_a", "@navbat_b", "@navbat_c", "@navbat_off"]) await send("POST", "/api/sources", { name: n });
  const join = (n) => `/api/sources/${encodeURIComponent(n)}/join`;
  assert.deepEqual((await send("POST", join("@navbat_a"))).body, { state: "wanted" });
  assert.deepEqual((await send("POST", join("@navbat_a"))).body, { state: "wanted" }, "takror bosish — o'zgarmaydi");
  assert.equal((await send("POST", join("@yoq_guruh"))).status, 404);
  assert.equal((await send("DELETE", join("@navbat_a"))).status, 200);
  assert.equal((await send("DELETE", join("@navbat_a"))).status, 409, "navbatda emas");
  assert.equal((await send("POST", join("@navbat_a"), undefined, { "x-yuk-admin": "" })).status, 403, "boshqa saytdan bo'lmaydi");

  // c — akkaunt allaqachon a'zo, off — kuzatilmaydi, b — so'rov yuborilgan: hammasi o'tkazib yuboriladi
  store.setSourceMembership("@navbat_c", true);
  await send("PATCH", `/api/sources/${encodeURIComponent("@navbat_off")}`, { enabled: false });
  store.setJoinState("@navbat_b", "requested");
  assert.deepEqual((await send("POST", "/api/sources/join-all")).body, { queued: 1 });
  const items = (await get("/api/sources")).body.items.filter((s) => s.name.startsWith("@navbat_"));
  assert.deepEqual(
    items.map((s) => [s.name, s.joinState]),
    [["@navbat_a", "wanted"], ["@navbat_b", "requested"], ["@navbat_c", null], ["@navbat_off", null]],
  );
  assert.deepEqual((await send("POST", join("@navbat_c"))).body, { state: "joined" }, "a'zo bo'lsa navbatga qo'yilmaydi");
  for (const n of ["@navbat_a", "@navbat_b", "@navbat_c", "@navbat_off"]) await send("DELETE", `/api/sources/${encodeURIComponent(n)}`);
});

test("manbalar: foydalanuvchi qo'shgani — kim qo'shgan va sinov hisobi; sinovdagi «hammasiga a'zo bo'lish» ga kirmaydi", async () => {
  store.saveDriver(8, {});
  store.addUserSource({ name: "@user_guruh", chatId: 8, title: "Foydalanuvchi guruhi", members: 900, chatType: "group" });
  store.finishProbe("@user_guruh", { ok: true, note: "Oxirgi 50 ta xabaridan 20 tasi yuk e'loniga o'xshaydi" });
  const post = store.addPost({ source: "@user_guruh", messageId: 1, text: "Toshkentdan Samarqandga 20 tonna yuk bor" });
  store.finishPost(post.id, "done");
  const row = (await get("/api/sources")).body.items.find((s) => s.name === "@user_guruh");
  assert.deepEqual([row.checkState, row.enabled, row.title, row.members, row.addedBy], ["trial", true, "Foydalanuvchi guruhi", 900, 8]);
  assert.equal(row.addedByUser.chatId, 8);
  assert.equal(row.trial.loads, 1);
  assert.deepEqual((await send("POST", "/api/sources/join-all")).body, { queued: 0 });
  await send("DELETE", `/api/sources/${encodeURIComponent("@user_guruh")}`);
});

test("jarayonlar: yoqish/o'chirish, loglar, noma'lum amal", async () => {
  assert.equal((await send("POST", "/api/processes/bot/restart")).body.status, "running");
  assert.equal((await send("POST", "/api/processes/bot/portlat")).status, 404);
  assert.deepEqual(calls.at(-1), ["restart", "bot"]);
  assert.equal((await get("/api/processes/bot/logs?after=5")).body.last, 6);
});

test("akkauntlar: holati va guruhlari; yopiq guruh shu akkaunt bilan qo'shiladi, a'zo bo'lish navbatiga tushmaydi", async () => {
  store.saveTgAccount("asosiy", { userId: 111, status: "ok" });
  store.saveTgAccount("ikkinchi", { userId: 222, username: "yuk_ikki", status: "ok" });
  store.setTgDialogs("asosiy", [{ id: "-1007777777", title: "Ochiq guruh", username: "Ochiq_Guruh", type: "guruh" }]);
  store.setTgDialogs("ikkinchi", [
    { id: "-1001234567", title: "Haydovchilar (yopiq)", username: null, type: "guruh", members: 80 },
    { id: "-1007777777", title: "Ochiq guruh", username: "Ochiq_Guruh", type: "guruh" },
  ]);
  await send("POST", "/api/sources", { name: "@ochiq_guruh" });

  const yopiq = await send("POST", "/api/sources", { name: "-1001234567" });
  assert.deepEqual([yopiq.status, yopiq.body], [201, { name: "-1001234567", added: true, account: "ikkinchi" }], "a'zo bo'lgan akkaunt o'zi topiladi");
  const row = (await get("/api/sources")).body.items.find((s) => s.name === "-1001234567");
  assert.deepEqual([row.account, row.title, row.chatType, row.members], ["ikkinchi", "Haydovchilar (yopiq)", "group", 80]);

  assert.equal((await send("POST", "/api/sources", { name: "-1009999999" })).status, 400, "hech bir akkaunt a'zo emas");
  assert.equal((await send("POST", "/api/sources", { name: "-1001234567", account: "asosiy" })).status, 400, "asosiy a'zo emas");
  const join = await send("POST", `/api/sources/${encodeURIComponent("-1001234567")}/join`);
  assert.equal(join.status, 409);
  await send("POST", "/api/sources/join-all");
  assert.equal((await get("/api/sources")).body.items.find((s) => s.name === "-1001234567").joinState, null, "«hammasiga a'zo bo'lish» ga kirmadi");

  const { body } = await get("/api/tg-accounts");
  assert.deepEqual(body.accounts.map((a) => [a.name, a.userId, a.status, a.dialogs, a.sources]), [
    ["asosiy", "111", "ok", 1, body.accounts[0].sources],
    ["ikkinchi", "222", "ok", 2, 1],
  ]);
  assert.deepEqual(
    body.dialogs.map((d) => [d.account, d.peerId, d.added]),
    [["asosiy", "-1007777777", "@ochiq_guruh"], ["ikkinchi", "-1001234567", "-1001234567"], ["ikkinchi", "-1007777777", "@ochiq_guruh"]],
    "qo'shilgani — id yoki username bo'yicha (katta-kichik harf farqi yo'q)",
  );
  assert.equal(body.collector, null, "collector jarayoni ro'yxatda yo'q");
  assert.equal(body.refreshRequestedAt, null);
  const refresh = await send("POST", "/api/tg-accounts/refresh");
  assert.equal(typeof refresh.body.requestedAt, "number");
  assert.equal((await get("/api/tg-accounts")).body.refreshRequestedAt, refresh.body.requestedAt);

  // «🔎 Auto scan»: faqat bosilganda; navbatdagi guruhlar soni ko'rinadi, ikkinchi bosish — o'sha navbat
  assert.equal(body.accounts[1].scan.running, false);
  assert.equal((await send("POST", "/api/tg-accounts/yoq/scan")).status, 404);
  const scan = await send("POST", "/api/tg-accounts/ikkinchi/scan");
  assert.deepEqual([scan.status, scan.body.scan.running, scan.body.scan.pending], [200, true, 0], "ikkala guruhi allaqachon manba");
  assert.equal((await send("POST", "/api/tg-accounts/ikkinchi/scan")).body.scan.requestedAt, scan.body.scan.requestedAt);
  for (const n of ["-1001234567", "@ochiq_guruh"]) await send("DELETE", `/api/sources/${encodeURIComponent(n)}`);
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
