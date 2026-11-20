import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { accountSources, readerAccounts, runAccount, sessionGone, superviseAccounts } from "../src/accounts.js";

const MIN = 60_000;
const long = (s) => `${s} — Toshkentdan Samarqandga 20 t tent kerak, +998 90 123 45 67`;
const YOPIQ = "-1001234567";

// Virtual vaqt: sleep(ms) — soxta taymer; advance(ms) taymerlarni navbat bilan uyg'otib, soatni suradi.
// Bir nechta halqa (asosiy, qo'shimcha akkauntlar, supervisor) bir vaqtda «uxlaydi» — har biri o'z vaqtida uyg'onadi
function virtualTime(start = Date.UTC(2026, 10, 13, 6, 0)) {
  const clock = { t: start };
  let timers = [];
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const sleep = (ms) => new Promise((resolve) => timers.push({ at: clock.t + Math.max(0, ms), resolve }));
  async function advance(ms) {
    const end = clock.t + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > end) break;
      const next = timers.shift();
      clock.t = Math.max(clock.t, next.at);
      next.resolve();
    }
    clock.t = end;
  }
  // To'xtatilgandan keyin: kutayotganlarni uyg'otib, promise tugashini kutadi
  async function drain(promise) {
    let done = false;
    promise.finally(() => (done = true)).catch(() => {});
    for (let i = 0; i < 500 && !done; i++) {
      await flush();
      const all = timers;
      timers = [];
      for (const timer of all) timer.resolve();
    }
    return promise;
  }
  return { clock, now: () => clock.t, sleep, advance, drain };
}

// Soxta Telegram: har akkauntning kimligi, guruhlari va guruhlardagi xabarlar.
// files — sessions/*.session (nom → o'zgargan vaqt); connectError — ulanishda tashlanadigan xato
function fakeTelegram(time, accounts) {
  const posts = {}; // guruh → [{ id, at }]
  const tg = {
    files: new Map(),
    connects: [],
    disconnects: [],
    joins: [],
    since: [],
    accounts,
    post(peer) {
      const list = (posts[peer] ??= [{ id: 100, at: 0 }]);
      list.push({ id: list.at(-1).id + 1, at: time.clock.t });
    },
    async listAccounts() {
      return [...tg.files].map(([name, changedAt]) => ({ name, changedAt }));
    },
    async connectSaved(name) {
      tg.connects.push(name);
      const error = accounts[name].connectError;
      if (error) throw error;
      return { name };
    },
    async whoAmI(client) {
      const a = accounts[client.name];
      return { userId: a.userId, username: a.username ?? null, firstName: a.firstName ?? null };
    },
    async listChats(client) {
      return accounts[client.name].chats ?? [];
    },
    async disconnect(client) {
      tg.disconnects.push(client.name);
    },
    createReader(client) {
      const visible = (source) => (posts[source.value] ??= [{ id: 100, at: 0 }]).filter((p) => p.at <= time.clock.t);
      return {
        async latestId(source) {
          return visible(source).at(-1).id;
        },
        async since(source, minId) {
          tg.since.push([client.name, source.value]);
          return visible(source)
            .filter((p) => p.id > minId)
            .map((p) => ({ id: p.id, text: long(`${source.value} ${p.id}`), date: Math.floor(p.at / 1000) }));
        },
        // Yopiq guruhga (id) akkaunt a'zo, ochiq guruhlarni (username) a'zo bo'lmasdan o'qiydi
        async membership(list) {
          return new Map(list.map((s) => [s.value, s.kind === "id"]));
        },
        async join(source) {
          tg.joins.push([client.name, source.value]);
          return "joined";
        },
      };
    },
  };
  return tg;
}

function setup() {
  const time = virtualTime();
  const store = openStore({ file: ":memory:", now: time.now });
  const tg = fakeTelegram(time, {
    asosiy: { userId: "111", firstName: "Asosiy" },
    ikkinchi: { userId: "222", username: "yuk_ikki", chats: [{ id: YOPIQ, title: "Haydovchilar (yopiq)", username: null, type: "guruh" }] },
    uchinchi: { userId: "333" },
  });
  return { time, store, tg };
}

const account = (store, name) => store.listTgAccounts().find((a) => a.name === name);

test("accountSources: asosiyga — akkauntsiz manbalar, qo'shimchaga — o'ziniki (o'chirilgani yo'q)", () => {
  const { store } = setup();
  store.addSource("@ochiq");
  store.addSource(YOPIQ, { account: "ikkinchi" });
  store.addSource("-1009999", { account: "ikkinchi", enabled: false });
  assert.deepEqual(accountSources(store, "asosiy")(), [{ kind: "username", value: "ochiq" }]);
  assert.deepEqual(accountSources(store, "ikkinchi")(), [{ kind: "id", value: YOPIQ }]);
  assert.deepEqual(accountSources(store, "uchinchi")(), []);
});

test("sessionGone: bekor qilingan sessiya — qayta urinilmaydi; tarmoq xatosi — urinadi", () => {
  assert.ok(sessionGone({ code: "SESSION" }));
  assert.ok(sessionGone({ code: 401, errorMessage: "AUTH_KEY_UNREGISTERED" }));
  assert.ok(sessionGone({ errorMessage: "AUTH_KEY_DUPLICATED" }));
  assert.ok(sessionGone(new Error("SESSION_REVOKED")));
  assert.ok(!sessionGone(new Error("Not connected")));
  assert.ok(!sessionGone({ errorMessage: "FLOOD_WAIT_30" }));
});

test("qo'shimcha akkaunt: yopiq guruhni o'qiydi (havolasiz), guruhlar ro'yxati bazada; tekshiruv va a'zo bo'lish — yo'q", async () => {
  const { time, store, tg } = setup();
  store.addSource(YOPIQ, { account: "ikkinchi" });
  store.setJoinState(YOPIQ, "wanted"); // asosiy akkaunt bo'lsa, 1 daqiqada a'zo bo'lardi
  store.addUserSource({ name: "@yangi_guruh", chatId: 5 }); // foydalanuvchi qo'shgan — faqat asosiy tekshiradi
  const controller = new AbortController();
  const logs = [];
  const run = runAccount({ name: "ikkinchi", client: { name: "ikkinchi" }, telegram: tg, store, log: (m) => logs.push(m), signal: controller.signal, now: time.now, sleep: time.sleep });
  await time.advance(2 * MIN);
  tg.post(YOPIQ);
  await time.advance(2 * MIN);
  controller.abort();
  await time.drain(run);

  const [post] = store.takeNewPosts();
  assert.deepEqual([post.source, post.link, post.via], [YOPIQ, null, "poll"], "yopiq guruh xabariga havola yo'q");
  assert.deepEqual(tg.joins, []);
  assert.ok(!tg.since.some(([, peer]) => peer === "yangi_guruh"), "foydalanuvchi guruhini qo'shimcha akkaunt tekshirmaydi");
  assert.equal(store.sourcesToProbe().length, 1);
  const saved = account(store, "ikkinchi");
  assert.deepEqual([saved.userId, saved.username, saved.status, saved.dialogs], ["222", "yuk_ikki", "ok", 1]);
  assert.ok(logs.includes("Akkaunt guruh va kanallari: 1 ta (yopig'i 1 ta)"));
  assert.equal(store.listSources().find((s) => s.name === YOPIQ).joined, true);
});

test("asosiy akkaunt: a'zo bo'lish navbati va foydalanuvchi guruhini tekshirish ishlaydi (taqqoslash uchun)", async () => {
  const { time, store, tg } = setup();
  store.addSource("@ochiq");
  store.setJoinState("@ochiq", "wanted");
  store.addUserSource({ name: "@yangi_guruh", chatId: 5 });
  const controller = new AbortController();
  const run = runAccount({ name: "asosiy", client: { name: "asosiy" }, telegram: tg, store, log: () => {}, signal: controller.signal, now: time.now, sleep: time.sleep });
  await time.advance(3 * MIN);
  controller.abort();
  await time.drain(run);
  assert.deepEqual(tg.joins, [["asosiy", "ochiq"]]);
  assert.ok(tg.since.some(([, peer]) => peer === "yangi_guruh"));
});

test("guruhlar ro'yxati: 30 daqiqada bir va boshqaruv markazi so'rasa (1 daqiqadan tez emas)", async () => {
  const { time, store, tg } = setup();
  let lists = 0;
  const telegram = { ...tg, listChats: async (client) => (lists++, tg.listChats(client)) };
  const controller = new AbortController();
  const run = runAccount({ name: "ikkinchi", client: { name: "ikkinchi" }, telegram, store, log: () => {}, signal: controller.signal, now: time.now, sleep: time.sleep });
  await time.advance(10 * MIN);
  assert.equal(lists, 1, "boshida bir marta");
  store.requestDialogsRefresh();
  await time.advance(10_000);
  assert.equal(lists, 2, "so'ralgach darhol");
  store.requestDialogsRefresh();
  await time.advance(30_000);
  assert.equal(lists, 2, "1 daqiqadan tez emas");
  await time.advance(40_000);
  assert.equal(lists, 3);
  await time.advance(31 * MIN);
  assert.equal(lists, 4, "30 daqiqada bir");
  controller.abort();
  await time.drain(run);
});

test("supervisor: yangi sessiya fayli ulanadi; xato — 1, 2 daqiqadan keyin qayta; boshqalariga ta'sir qilmaydi", async () => {
  const { time, store, tg } = setup();
  store.addSource(YOPIQ, { account: "ikkinchi" });
  tg.accounts.uchinchi.connectError = new Error("Not connected");
  const controller = new AbortController();
  const logs = [];
  const run = superviseAccounts({ telegram: tg, store, log: (m) => logs.push(m), signal: controller.signal, now: time.now, sleep: time.sleep, stopTimeoutMs: 50 });
  await time.advance(MIN);
  assert.deepEqual(tg.connects, [], "fayl yo'q — ulanish yo'q");
  tg.files.set("ikkinchi", 1);
  tg.files.set("uchinchi", 1);
  await time.advance(31_000);
  assert.deepEqual(tg.connects.sort(), ["ikkinchi", "uchinchi"]);
  assert.equal(account(store, "ikkinchi").status, "ok");
  assert.deepEqual([account(store, "uchinchi").status, account(store, "uchinchi").error], ["error", "Not connected"]);
  assert.ok(logs.some((m) => m === "[uchinchi] ishlamay qoldi — Not connected; 60 s dan keyin qayta ulanadi"));

  await time.advance(MIN);
  assert.equal(tg.connects.filter((n) => n === "uchinchi").length, 2, "1 daqiqadan keyin qayta");
  await time.advance(MIN);
  assert.equal(tg.connects.filter((n) => n === "uchinchi").length, 2, "keyingisi — 2 daqiqadan keyin");
  delete tg.accounts.uchinchi.connectError;
  await time.advance(MIN + 30_000);
  assert.equal(account(store, "uchinchi").status, "ok");

  tg.post(YOPIQ);
  await time.advance(3 * MIN);
  assert.equal(store.takeNewPosts()[0]?.source, YOPIQ, "ikkinchi akkaunt ishlashda davom etdi");
  controller.abort();
  await time.drain(run);
  assert.deepEqual(tg.disconnects.sort(), ["ikkinchi", "uchinchi"], "ulangan har biri yopildi (ulanmaganlari — yo'q)");
});

test("supervisor: sessiya bekor qilingan / asosiyning o'zi — egasi qayta kirmaguncha urinilmaydi", async () => {
  const { time, store, tg } = setup();
  tg.accounts.ikkinchi.connectError = Object.assign(new Error("Sessiya bekor qilingan"), { code: "SESSION" });
  tg.accounts.uchinchi.userId = "111"; // asosiy akkauntning o'zi
  tg.files.set("ikkinchi", 1);
  tg.files.set("uchinchi", 1);
  const controller = new AbortController();
  const logs = [];
  const owners = new Map([["111", "asosiy"]]);
  const run = superviseAccounts({ telegram: tg, store, owners, log: (m) => logs.push(m), signal: controller.signal, now: time.now, sleep: time.sleep, stopTimeoutMs: 50 });
  await time.advance(10 * MIN);
  assert.deepEqual(tg.connects.sort(), ["ikkinchi", "uchinchi"], "faqat bir marta");
  assert.equal(account(store, "ikkinchi").status, "logged_out");
  assert.deepEqual([account(store, "uchinchi").status, account(store, "uchinchi").userId], ["duplicate", "111"]);
  assert.ok(logs.some((m) => m.startsWith("[uchinchi] bu «asosiy» akkauntining o'zi")));
  assert.equal(owners.get("111"), "asosiy");

  // Egasi qayta kirdi — fayl yangilandi
  delete tg.accounts.ikkinchi.connectError;
  tg.files.set("ikkinchi", 2);
  await time.advance(31_000);
  assert.equal(account(store, "ikkinchi").status, "ok");
  controller.abort();
  await time.drain(run);
});

test("supervisor: sessiya fayli o'chirilsa — akkaunt to'xtaydi; collector o'chiq paytda o'chirilgani ham belgilanadi", async () => {
  const { time, store, tg } = setup();
  store.saveTgAccount("eski", { userId: "999", status: "ok" });
  tg.files.set("ikkinchi", 1);
  const controller = new AbortController();
  const run = superviseAccounts({ telegram: tg, store, log: () => {}, signal: controller.signal, now: time.now, sleep: time.sleep, stopTimeoutMs: 50 });
  await time.advance(10_000);
  assert.equal(account(store, "eski").status, "logged_out");
  assert.equal(account(store, "ikkinchi").status, "ok");
  tg.files.delete("ikkinchi");
  await time.advance(31_000);
  assert.deepEqual([account(store, "ikkinchi").status, tg.disconnects], ["logged_out", ["ikkinchi"]]);
  controller.abort();
  await time.drain(run);
});

// --- O'quvchi akkauntlar (2026-11-20): ochiq guruhni a'zo akkaunt o'qiydi, tasdiqlangan guruhga qo'shiladi ---
test("TG_READERS: asosiy doim birinchi; ochiq guruhni birinchi a'zo va ishlab turgan o'quvchi o'qiydi, hech kim a'zo emas — asosiy", () => {
  assert.deepEqual(readerAccounts({ TG_READERS: "sarvar" }), ["asosiy", "sarvar"]);
  assert.deepEqual(readerAccounts({}), ["asosiy"]);
  const store = openStore({ file: ":memory:" });
  for (const name of ["@Ikkalasi", "@Sarvarda", "@Hechkim", "@Uchinchida"]) store.addSource(name);
  store.addSource("-1009", { account: "sarvar" });
  store.saveTgAccount("sarvar", { userId: "2", status: "ok" });
  store.saveTgAccount("boshqa", { userId: "3", status: "ok" });
  store.setTgDialogs("asosiy", [{ id: "-1001", title: "A", username: "ikkalasi", type: "guruh" }]);
  store.setTgDialogs("sarvar", [
    { id: "-1001", title: "A", username: "Ikkalasi", type: "guruh" },
    { id: "-1002", title: "B", username: "sarvarda", type: "guruh" },
    { id: "-1009", title: "Yopiq", username: null, type: "guruh" },
  ]);
  // «boshqa» — haydovchining akkaunti, TG_READERS da yo'q: ochiq guruhlarni o'qimaydi
  store.setTgDialogs("boshqa", [{ id: "-1004", title: "D", username: "uchinchida", type: "guruh" }]);
  const readers = ["asosiy", "sarvar"];
  const names = (account) => accountSources(store, account, { readers })().map((s) => s.value);
  assert.deepEqual(names("asosiy").sort(), ["Hechkim", "Ikkalasi", "Uchinchida"]);
  assert.deepEqual(names("sarvar").sort(), ["-1009", "Sarvarda"]);
  assert.deepEqual(names("boshqa"), []);
  // Sarvar ishlamay qolsa — uning ochiq guruhi asosiyga qaytadi (yopig'i — o'zida, boshqa hech kim o'qiy olmaydi)
  store.saveTgAccount("sarvar", { userId: "2", status: "error" });
  assert.deepEqual(names("asosiy").sort(), ["Hechkim", "Ikkalasi", "Sarvarda", "Uchinchida"]);
  assert.deepEqual(names("sarvar"), ["-1009"]);
  // TG_READERS faqat asosiy — avvalgidek: hamma ochiq guruh asosiyda
  assert.equal(accountSources(store, "asosiy", { readers: ["asosiy"] })().length, 4);
  store.close();
});

test("tasdiqlangan guruhga qo'shilish navbati: faqat sinovdan o'tgan, yangi tasdiqlangan, a'zo bo'lmagan; har akkaunt bir marta", () => {
  const clock = { t: 1_000_000 };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  assert.deepEqual(store.readerJoinCandidates("asosiy"), [], "birinchi chaqiruv — boshlanish vaqti yoziladi");
  clock.t += 1000;
  // Haydovchining akkauntidan topilgan guruh (Auto scan) → 24 soatlik sinov → tasdiqlandi
  store.addScannedSource({ name: "@Yangi_yuk", addedBy: 5 });
  assert.deepEqual(store.readerJoinCandidates("asosiy"), [], "sinovda — hali emas");
  store.finishTrial("@Yangi_yuk", { ok: true });
  assert.deepEqual(store.readerJoinCandidates("asosiy").map((r) => r.name), ["@Yangi_yuk"]);
  // Sarvar allaqachon a'zo — unga kerak emas
  store.setTgDialogs("sarvar", [{ id: "-1001", title: "Y", username: "yangi_yuk", type: "guruh" }]);
  assert.deepEqual(store.readerJoinCandidates("sarvar"), []);
  store.finishReaderJoin("@Yangi_yuk", "asosiy", { state: "joined" });
  assert.deepEqual(store.readerJoinCandidates("asosiy"), [], "bir marta");
  assert.equal(store.readerJoinsSince("asosiy", 0), 1);
  store.close();
});
