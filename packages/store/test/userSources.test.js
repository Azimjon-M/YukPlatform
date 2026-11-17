import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.js";

const HOUR = 3_600_000;

function fixture() {
  let time = 100 * HOUR;
  const store = openStore({ file: ":memory:", now: () => time });
  return { store, advance: (ms) => (time += ms), now: () => time };
}

test("foydalanuvchi manbasi: probe → sinov → natija, qo'shgan odamga bir marta aytiladi", () => {
  const { store, advance, now } = fixture();
  assert.equal(store.addUserSource({ name: "@Yuk_Guruh", chatId: 7, title: "Yuk guruhi", members: 1200, chatType: "group" }), true);
  assert.equal(store.addUserSource({ name: "@Yuk_Guruh", chatId: 8 }), false, "tekshirilayotganini boshqasi qayta qo'sha olmaydi");
  assert.equal(store.findSource("yuk_guruh").name, "@Yuk_Guruh", "katta-kichik harf farqi yo'q");
  const row = store.listSources().find((s) => s.name === "@Yuk_Guruh");
  assert.equal(row.enabled, false, "tekshirilguncha o'chiq — collector undan e'lon olmaydi");
  assert.equal(row.checkState, "probe");
  assert.equal(row.addedBy, 7);
  assert.deepEqual(store.sourcesToProbe().map((s) => s.name), ["@Yuk_Guruh"]);
  assert.deepEqual(store.userSourceCounts(7), { checking: 1, today: 1, all: 1 });
  assert.deepEqual(store.sourceNotices(), [], "probe holatida aytiladigan narsa yo'q");

  assert.equal(store.finishProbe("@Yuk_Guruh", { ok: true, note: "50 tadan 30 tasi", stats: { messages: 50, loadLike: 30 } }), true);
  const trial = store.findSource("@yuk_guruh");
  assert.equal(trial.checkState, "trial");
  assert.equal(trial.enabled, true);
  assert.equal(trial.checkUntil, now() + 24 * HOUR);
  assert.deepEqual(trial.checkStats, { probe: { messages: 50, loadLike: 30 } });
  assert.deepEqual(store.sourceNotices().map((s) => s.checkState), ["trial"]);
  store.markSourceNotified("@Yuk_Guruh", "trial");
  assert.deepEqual(store.sourceNotices(), []);

  advance(24 * HOUR);
  assert.equal(store.finishTrial("@Yuk_Guruh", { ok: false, note: "atigi 2 ta", stats: { loads: 2 } }), true);
  const failed = store.findSource("@Yuk_Guruh");
  assert.equal(failed.checkState, "failed");
  assert.equal(failed.enabled, false);
  assert.deepEqual(failed.checkStats, { probe: { messages: 50, loadLike: 30 }, trial: { loads: 2 } });
  assert.deepEqual(store.sourceNotices().map((s) => s.checkState), ["failed"]);
  assert.equal(store.finishTrial("@Yuk_Guruh", { ok: true }), false, "sinovda bo'lmagan manba — tegilmaydi");

  // Rad etilgani qayta yuborilsa — boshidan tekshiriladi (bot buni bir haftadan keyingina qiladi)
  assert.equal(store.addUserSource({ name: "@Yuk_Guruh", chatId: 8, title: "Yangi nom" }), true);
  const again = store.findSource("@Yuk_Guruh");
  assert.equal(again.checkState, "probe");
  assert.equal(again.addedBy, 8);
  assert.equal(again.checkStats, null);
  assert.deepEqual(store.sourceNotices(), []);
});

test("admin qo'shgan manbaga foydalanuvchi tega olmaydi; rad etilgan probe — o'chiq", () => {
  const { store } = fixture();
  store.addSource("@TutGruz");
  assert.equal(store.addUserSource({ name: "@TutGruz", chatId: 7 }), false);
  assert.equal(store.findSource("@tutgruz").checkState, null);
  store.addUserSource({ name: "@chat_guruh", chatId: 7 });
  assert.equal(store.finishProbe("@chat_guruh", { ok: false, note: "yuk e'loni yo'q" }), true);
  const row = store.findSource("@chat_guruh");
  assert.equal(row.checkState, "failed");
  assert.equal(row.enabled, false);
  assert.equal(row.checkUntil, null);
  assert.equal(store.finishProbe("@chat_guruh", { ok: true }), false, "faqat probe holatidagisi");
  assert.deepEqual(store.userSourcesOf(7).map((s) => s.name), ["@chat_guruh"]);
});

test("sinov hisobi: yuk e'lonlari, boshqa guruhdagining nusxasi, eskirganlar sanalmaydi", () => {
  const { store, advance, now } = fixture();
  store.addUserSource({ name: "@yangi", chatId: 7 });
  store.finishProbe("@yangi", { ok: true });
  const since = now();
  // Boshqa guruhdagi yuk e'loni — keyin yangi guruhda aynan nusxasi chiqadi
  const original = store.addPost({ source: "@eski", messageId: 1, text: "Toshkentdan Samarqandga 20 tonna un, tent kerak" });
  store.finishPost(original.id, "done");
  advance(1000);
  const posts = [
    ["Farg'onadan Buxoroga 10 tonna sement kerak", "done", null],
    ["Andijondan Moskvaga ref kerak", "done", "Boshqa yo'nalish: O'zbekiston → Rossiya"],
    ["Assalomu alaykum hammaga, yaxshimisiz", "done", "boshqa"],
    ["Qarshidan Termizga isuzu kerak 5 tonna", "done", "Eskirgan: 4 soat oldin yozilgan"],
    ["Namangandan Toshkentga labo kerak", "new", null],
    ["Jizzaxdan Navoiyga 20 tonna yuk bor, aloqa saytda", "done", "Aloqasiz: telefon raqami ham, lichkasi ham yo'q — AI'ga yuborilmadi"],
  ];
  posts.forEach(([text, status, error], i) => {
    const post = store.addPost({ source: "@yangi", messageId: i + 1, text });
    if (status !== "new") store.finishPost(post.id, status, error);
  });
  const repeat = store.addPost({ source: "@yangi", messageId: 99, text: "Toshkentdan Samarqandga 20 tonna un, tent kerak" }, { dedupeWindowMs: HOUR });
  assert.equal(repeat.status, "duplicate");
  assert.deepEqual(store.trialStats("@yangi", since), { posts: 7, loads: 2, processed: 4, waiting: 1, repeats: 1, noContact: 1 });
  assert.deepEqual(store.trialStats("@yangi", now() + 1), { posts: 0, loads: 0, processed: 0, waiting: 0, repeats: 0, noContact: 0 });
});

test("yopiq guruh o'chirilmaydi: yuk kam bo'lsa ham kuzatuvda qoladi; o'qib bo'lmasa — rad", () => {
  const store = openStore({ file: ":memory:" });
  store.addUserSource({ name: "-1001111111", chatId: 7, account: "dost" });
  assert.equal(store.finishProbe("-1001111111", { ok: false, note: "Oxirgi 50 ta xabarda yuk e'loni yo'q", stats: { messages: 50, loadLike: 0 } }), true);
  let row = store.listSources().find((s) => s.name === "-1001111111");
  assert.equal(row.enabled, true);
  assert.equal(row.checkState, "ok");
  assert.match(row.checkNote, /^Yopiq guruh — e'lon kam bo'lsa ham doim kuzatiladi \(oxirgi 50/);

  // Yuk guruhi deb topilsa — sinovsiz, darhol doimiy
  store.addUserSource({ name: "-1002222222", chatId: 7, account: "dost" });
  store.finishProbe("-1002222222", { ok: true, note: "Yuk guruhi: 3 ta yuk e'loni", stats: {} });
  row = store.listSources().find((s) => s.name === "-1002222222");
  assert.deepEqual([row.enabled, row.checkState, row.checkNote], [true, "ok", "Yuk guruhi: 3 ta yuk e'loni"]);
  assert.equal(store.trialSources().length, 0, "sinovga tushmaydi");

  // Eski sinovdagi yopiq guruh ham yiqilmaydi
  store.addUserSource({ name: "-1004444444", chatId: 7, account: "dost" });
  store.finishProbe("-1004444444", { ok: true, note: "bor", stats: {} });
  row = store.listSources().find((s) => s.name === "-1004444444");
  assert.equal(row.checkState, "ok");

  // Akkaunt o'qiy olmadi (a'zo emas) — rad etiladi
  store.addUserSource({ name: "-1003333333", chatId: 7, account: "dost" });
  store.finishProbe("-1003333333", { ok: false, note: "o'qib bo'lmadi", stats: { error: "CHANNEL_PRIVATE" } });
  row = store.listSources().find((s) => s.name === "-1003333333");
  assert.equal(row.checkState, "failed");

  // Ochiq guruh — avvalgidek o'chiriladi
  store.addUserSource({ name: "@Ochiq", chatId: 7 });
  store.finishProbe("@Ochiq", { ok: true, note: "", stats: {} });
  store.finishTrial("@Ochiq", { ok: false, note: "kam", stats: {} });
  row = store.listSources().find((s) => s.name === "@Ochiq");
  assert.equal(row.enabled, false);
  assert.equal(row.checkState, "failed");
  store.close();
});

test("mergePost: ovozli xabar davomi — birga yangi e'lon, oldingisi yopiladi; yuk topilgan bo'lsa — birlashtirilmaydi", () => {
  const store = openStore({ file: ":memory:" });
  const a = store.addPost({ source: "@g", messageId: 1, text: "Toshkentdan Samarqandga yuk bor", postedAt: 1 });
  store.finishPost(a.id, "done", "Aloqasiz: telefon raqami ham, lichkasi ham yo'q");
  const merged = store.mergePost(a.id, { source: "@g", messageId: 2, text: "Nomerimiz +998 93 123 45 67", postedAt: 2, media: "voice" });
  assert.equal(merged.status, "new");
  const [post] = store.takeNewPosts(5);
  assert.deepEqual([post.id, post.text, post.media], [merged.id, "Toshkentdan Samarqandga yuk bor\nNomerimiz +998 93 123 45 67", "voice"]);
  assert.match(store.listPosts({}).items.find((p) => p.id === a.id).error, /^Davomi bilan birlashtirildi: #/);
  const b = store.addPost({ source: "@g", messageId: 3, text: "Buxorodan Navoiyga yuk bor +998901112233", postedAt: 3 });
  store.addLoad({ postId: b.id, key: "k", load: {}, kind: "yuk" });
  assert.equal(store.mergePost(b.id, { source: "@g", messageId: 4, text: "qo'shimcha", postedAt: 4 }), null, "yuk allaqachon topilgan");
  store.close();
});
