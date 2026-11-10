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
