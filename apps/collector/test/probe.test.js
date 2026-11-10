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
