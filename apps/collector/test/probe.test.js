// Foydalanuvchi qo'shgan guruhni ko'rib chiqish (probe.js) va collector'dagi navbati (live.js). Telegram'ga ulanmaydi.
// Telefon raqamlari soxta (+998 90 000 00 0X).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { judgeProbe } from "../src/probe.js";
import { runLive } from "../src/live.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 10, 7, 0);
const LOAD = (i) => `Toshkentdan Samarqandga ${10 + i} tonna un bor, tent kerak +998 90 000 00 0${i % 10}`;
const NOPHONE = (i) => `Toshkentdan Samarqandga ${10 + i} tonna un bor, tent kerak, aloqa saytimizda`;
const CHAT = (i) => `Assalomu alaykum hammaga, bugun ishlar qalay? ${i}`;
// Xabarlar ro'yxati: har biri minutesAgo daqiqa oldin yozilgan
const messages = (list) => list.map(([text, minutesAgo], i) => ({ id: 1000 + i, text, date: Math.floor((NOW - minutesAgo * MIN) / 1000) }));

test("judgeProbe: yuk e'lonlari bor — sinovga; suhbat guruhi, o'lik guruh, bo'sh guruh — rad", () => {
  const cargo = judgeProbe(messages([[LOAD(1), 600], [CHAT(1), 300], [LOAD(2), 120], [LOAD(3), 30], ["rasm", 10]]), { now: NOW });
  assert.equal(cargo.ok, true);
  assert.equal(cargo.note, "Oxirgi 5 ta xabaridan 3 tasi yuk e'loniga o'xshaydi");
  assert.deepEqual(cargo.stats, { messages: 5, texts: 4, loadLike: 3, withContact: 3, loadLikeDay: 3, lastAt: NOW - 10 * MIN });

  const chat = judgeProbe(messages([[CHAT(1), 50], [LOAD(1), 40], [CHAT(2), 30], [LOAD(2), 20]]), { now: NOW });
  assert.equal(chat.ok, false);
  assert.equal(chat.note, "Oxirgi 4 ta xabaridan faqat 2 tasi yuk e'loniga o'xshaydi");
  assert.equal(judgeProbe(messages([[CHAT(1), 5]]), { now: NOW }).note, "Oxirgi 1 ta xabaridan birortasi ham yuk e'loniga o'xshamaydi");

  const dead = judgeProbe(messages([[LOAD(1), 9 * DAY / MIN], [LOAD(2), 8 * DAY / MIN], [LOAD(3), 8 * DAY / MIN]]), { now: NOW });
  assert.equal(dead.ok, false);
  assert.match(dead.note, /^Guruhda 7 kundan beri xabar yo'q \(oxirgisi 02\.11\.2026 da\)$/);

  assert.deepEqual(judgeProbe([], { now: NOW }), {
    ok: false,
    note: "Guruhda birorta ham xabar topilmadi",
    stats: { messages: 0, texts: 0, loadLike: 0, withContact: 0, loadLikeDay: 0, lastAt: null },
  });
});

test("judgeProbe: aloqasiz yuk e'lonlari (telefon ham, lichka ham yo'q) sanalmaydi — bot ularni baribir yubormaydi", () => {
  const site = judgeProbe(messages([[NOPHONE(1), 40], [NOPHONE(2), 30], [NOPHONE(3), 20], [LOAD(1), 10]]), { now: NOW });
  assert.equal(site.ok, false);
  assert.equal(site.note, "Oxirgi 4 ta xabaridagi 4 ta yuk e'lonidan faqat 1 tasida telefon raqami yoki yozgan odamning lichkasi bor");
  assert.equal(site.stats.loadLike, 4);
  assert.equal(site.stats.withContact, 1);
  const none = judgeProbe(messages([[NOPHONE(1), 30], [NOPHONE(2), 20], [NOPHONE(3), 10]]), { now: NOW });
  assert.equal(none.note, "Oxirgi 3 ta xabaridagi 3 ta yuk e'lonining birortasida ham telefon raqami yoki yozgan odamning lichkasi yo'q");
  // Yozgan odamning username'i bor — lichkasiga yozsa bo'ladi
  const senders = messages([[NOPHONE(1), 30], [NOPHONE(2), 20], [NOPHONE(3), 10]]).map((m) => ({ ...m, sender: "ali_logist" }));
  assert.equal(judgeProbe(senders, { now: NOW }).ok, true);
  // REQUIRE_CONTACT=0 — avvalgidek
  assert.equal(judgeProbe(messages([[NOPHONE(1), 30], [NOPHONE(2), 20], [NOPHONE(3), 10]]), { now: NOW, requireContact: false }).ok, true);
});

// runLive soxta soat bilan (live.test.js dagidek): sleep vaqtni suradi, `minutes` o'tgach to'xtaydi
async function simulate({ clock, minutes, ...options }) {
  const controller = new AbortController();
  const end = clock.t + minutes * MIN;
  const logs = [];
  await runLive({
    log: (message) => logs.push(message),
    signal: controller.signal,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
      if (clock.t >= end) controller.abort();
    },
    ...options,
  });
  return logs;
}

const liveList = (store) => () =>
  store
    .listSources()
    .filter((s) => s.enabled)
    .map((s) => ({ kind: "username", value: s.name.slice(1) }));

test("collector: foydalanuvchi qo'shgan guruh darhol ko'riladi — sinov boshlanadi, oxirgi 3 soat navbatga, keyin o'z navbati bilan", async () => {
  const clock = { t: NOW };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  store.addUserSource({ name: "@Yangi_Yuk", chatId: 7, title: "Yangi yuk" });
  const history = messages([[LOAD(1), 5 * 60], [LOAD(2), 100], [CHAT(1), 50], [LOAD(3), 20]]);
  const calls = [];
  const reader = {
    async latestId() {
      return history.at(-1).id;
    },
    async since(source, minId, limit) {
      calls.push({ name: source.value, minId, limit });
      return history.filter((m) => m.id > minId);
    },
  };
  const logs = await simulate({ clock, minutes: 3, sources: liveList(store), reader, store });

  const row = store.findSource("@yangi_yuk");
  assert.equal(row.checkState, "trial");
  assert.equal(row.enabled, true);
  assert.equal(row.checkStats.probe.loadLike, 3);
  assert.equal(row.checkStats.probe.queued, 3, "5 soat oldingisi olinmadi: bot 3 soatdan eskisini baribir tashlaydi");
  assert.deepEqual(calls[0], { name: "Yangi_Yuk", minId: 0, limit: 50 });
  assert.equal(store.getCursor("@Yangi_Yuk"), history.at(-1).id);
  assert.deepEqual(store.takeNewPosts(10).map((p) => p.source), ["@Yangi_Yuk", "@Yangi_Yuk", "@Yangi_Yuk"]);
  assert.ok(calls.slice(1).every((c) => c.minId === history.at(-1).id), "keyin — faqat yangi xabarlar");
  assert.ok(calls.length >= 3, `sinovdagi guruh so'rab turiladi (${calls.length})`);
  assert.ok(logs.some((l) => l.startsWith("@Yangi_Yuk: foydalanuvchi qo'shgan guruh sinovga olindi — Oxirgi 4 ta xabaridan 3 tasi")));
});

test("collector: yuk e'loni yo'q guruh rad etiladi va o'qilmaydi; topilmagan guruh — darhol rad; boshqa xato — qayta urinadi", async () => {
  const clock = { t: NOW };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  store.addUserSource({ name: "@suhbat", chatId: 7 });
  store.addUserSource({ name: "@yoq_guruh", chatId: 7 });
  store.addUserSource({ name: "@sekin", chatId: 8 });
  const chats = messages([[CHAT(1), 30], [CHAT(2), 20]]);
  const tries = { sekin: 0, suhbat: 0 };
  const reader = {
    async latestId() {
      return null;
    },
    async since(source) {
      if (source.value === "yoq_guruh") throw Object.assign(new Error("No user has \"yoq_guruh\" as username"), { errorMessage: "USERNAME_NOT_OCCUPIED" });
      tries[source.value]++;
      if (source.value === "sekin" && tries.sekin < 3) throw new Error("Timeout");
      return source.value === "sekin" ? messages([[LOAD(1), 10], [LOAD(2), 9], [LOAD(3), 8]]) : chats;
    },
  };
  await simulate({ clock, minutes: 6, sources: liveList(store), reader, store });

  assert.equal(store.findSource("@suhbat").checkState, "failed");
  assert.equal(store.findSource("@suhbat").checkNote, "Oxirgi 2 ta xabaridan birortasi ham yuk e'loniga o'xshamaydi");
  assert.equal(tries.suhbat, 1, "rad etilgan guruh boshqa o'qilmaydi");
  assert.equal(store.findSource("@yoq_guruh").checkState, "failed");
  assert.match(store.findSource("@yoq_guruh").checkNote, /topilmadi/);
  assert.equal(store.findSource("@sekin").checkState, "trial", "ikki marta xato, uchinchisida o'qildi (1 va 2 daqiqadan keyin)");
  assert.deepEqual(store.takeNewPosts(10).length, 3);
});

// --- Akkaunt guruhlarini tekshirish «🔎 Auto scan» (live.js scanNext, 2026-11-13) ---
test("Auto scan: bosilmaguncha hech narsa tekshirilmaydi; bosilgach «➕ Guruh qo'shish» tekshiruvidan o'tgani sinovga (yopig'i — shu akkaunt bilan), egasiga xabar yo'q", async () => {
  const clock = { t: NOW };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  store.setTgAccountOwner("ufk-1", 560);
  store.saveTgAccount("ufk-1", { userId: "90", status: "ok" });
  store.setTgDialogs("ufk-1", [
    { id: "-1001", title: "Yopiq yuklar", username: null, type: "guruh", members: 900 },
    { id: "-1002", title: "Ochiq yuklar", username: "Ochiq_Yuk", type: "kanal", members: 500 },
    { id: "-1003", title: "Oila", username: null, type: "guruh", members: 12 },
    { id: "-1004", title: "Yuk Ekspert", username: "Yuk_Ekspert", type: "kanal", members: 50 },
  ]);
  const loads = messages([[LOAD(1), 120], [LOAD(2), 60], [LOAD(3), 30], [CHAT(1), 10]]);
  const reads = [];
  const reader = {
    async latestId() {
      return null;
    },
    async since(source, minId, limit) {
      reads.push([source.kind, source.value, minId, limit]);
      return source.value === "-1003" ? messages([[CHAT(1), 30], [CHAT(2), 20]]) : loads;
    },
  };
  const run = (minutes) => simulate({ clock, minutes, sources: () => [], reader, store, scan: "ufk-1", scanExclude: ["@Yuk_Ekspert"] });
  await run(3);
  assert.deepEqual(reads, [], "so'rovsiz — tekshirilmaydi");
  assert.equal(store.dialogScanSummary("ufk-1").pending, 0);

  store.requestAccountScan("ufk-1");
  assert.equal(store.dialogScanSummary("ufk-1").pending, 4);
  const logs = await run(3);
  // Uchala guruh 30 soniyada bittadan, a'zolar ko'pidan boshlab; o'zimizning kanal — tegilmadi
  assert.deepEqual(reads.map((r) => r.slice(0, 2)), [["id", "-1001"], ["id", "-1002"], ["id", "-1003"]]);
  assert.ok(reads.every((r) => r[2] === 0 && r[3] === 50));
  const closed = store.findSource("-1001");
  assert.deepEqual([closed.checkState, closed.enabled, closed.addedBy, closed.title], ["trial", true, 560, "Yopiq yuklar"]);
  assert.equal(store.listSources().find((s) => s.name === "-1001").account, "ufk-1", "yopig'ini shu akkaunt o'qiydi");
  const open = store.findSource("@ochiq_yuk");
  assert.deepEqual([open.checkState, open.chatType], ["trial", "channel"]);
  assert.equal(store.listSources().find((s) => s.name === "@Ochiq_Yuk").account, null, "ochig'ini asosiy akkaunt o'qiydi");
  assert.equal(store.findSource("-1003"), null, "suhbat guruhi manbaga olinmadi");
  // Birinchi guruhning oxirgi 3 soatdagi 4 ta xabari navbatga; ikkinchisida matnlar aynan o'sha — takror (AI'ga bormaydi)
  assert.deepEqual(store.takeNewPosts(20).map((p) => p.source), ["-1001", "-1001", "-1001", "-1001"]);
  // Egasiga hech qanday xabar: na har guruh uchun (sourceNotices), na umumiy (bot_notices)
  assert.deepEqual(store.sourceNotices(), []);
  assert.deepEqual(store.takeBotNotices(), []);
  const summary = store.dialogScanSummary("ufk-1");
  assert.equal(summary.running, false, "navbat tugadi — so'rov o'chdi");
  assert.equal(summary.doneAt != null, true);
  assert.deepEqual([summary.checked, summary.pending, summary.rejected, summary.trial], [3, 0, 1, 2]);
  assert.ok(logs.some((l) => l.includes("«Yopiq yuklar»: akkaunt guruhi tekshirildi — -1001 sinovga olindi")));
  assert.ok(logs.some((l) => l.startsWith("Auto scan tugadi: shu safar 3 ta guruh tekshirildi, 2 tasi sinovga olindi")));

  // Keyin o'z-o'zidan qayta tekshirilmaydi; yana bosilsa — rad etilgani qayta ko'riladi, manbalarga tegilmaydi
  await run(3);
  assert.equal(reads.length, 3);
  store.requestAccountScan("ufk-1");
  await run(2);
  assert.deepEqual(reads.slice(3).map((r) => r[1]), ["-1003"]);
});

test("yopiq guruh («➕ Guruh qo'shish»): foydalanuvchi akkaunti id bo'yicha tekshiradi; taklif havolasini ham shu akkaunt aniqlaydi", async () => {
  const clock = { t: NOW };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  store.addUserSource({ name: "-1001234567", chatId: 560, title: "Yopiq", account: "ufk-1" });
  store.addUserSource({ name: "@ochiq", chatId: 560 });
  const invite = store.addInviteCheck({ chatId: 560, hash: "AbCdEf123", accounts: ["ufk-1"] });
  const missing = store.addInviteCheck({ chatId: 560, hash: "Yoq00000", accounts: ["ufk-1"] });
  const reads = [];
  const reader = {
    async latestId() {
      return null;
    },
    async since(source) {
      reads.push([source.kind, source.value]);
      return messages([[LOAD(1), 30], [LOAD(2), 20], [LOAD(3), 10]]);
    },
    async checkInvite(hash) {
      if (hash === "Yoq00000") throw Object.assign(new Error("INVITE_HASH_EXPIRED"), { errorMessage: "INVITE_HASH_EXPIRED" });
      return { member: true, peerId: "-1009999", title: "Taklifdagi", chatType: "group", members: 40 };
    },
  };
  await simulate({ clock, minutes: 2, sources: () => [], reader, store, scan: "ufk-1", probeAccount: "ufk-1" });
  assert.deepEqual(reads, [["id", "-1001234567"]], "faqat o'ziga biriktirilgan yopiq guruh; ochig'ini asosiy tekshiradi");
  assert.equal(store.findSource("-1001234567").checkState, "trial");
  assert.equal(store.findSource("@ochiq").checkState, "probe");
  const results = store.inviteResults();
  assert.deepEqual(
    results.map((r) => [r.id, r.state, r.peerId, r.account, r.title]),
    [
      [invite, "found", "-1009999", "ufk-1", "Taklifdagi"],
      [missing, "invalid", null, null, null],
    ],
  );
});
