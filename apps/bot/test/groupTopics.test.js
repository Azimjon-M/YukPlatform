// Guruh bo'limlari: soxta Telegram api bilan — internetga chiqmaydi
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { TRUCK_CLASS_IDS } from "@yuk/shared";
import { GROUP_TOPICS, createGroupPoster, topicFor } from "../src/groupTopics.js";

const LOAD = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, phones: ["+998900000001"] };
const POST = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };

function fakeApi({ goneOnce = null, firstThread = 10 } = {}) {
  const calls = [];
  let thread = firstThread;
  let message = 500;
  return {
    calls,
    async createForumTopic(chat, name, options) {
      calls.push({ method: "createForumTopic", chat, name, options });
      return { message_thread_id: ++thread, name };
    },
    async sendMessage(chat, text, options) {
      calls.push({ method: "sendMessage", chat, text, options });
      if (goneOnce != null && options.message_thread_id === goneOnce) {
        goneOnce = null;
        throw Object.assign(new Error("x"), { description: "Bad Request: message thread not found" });
      }
      return { message_id: ++message };
    },
  };
}

test("har mashina turi o'z bo'limiga, turi yo'q yuk — «Boshqa yuklar»ga", () => {
  assert.equal(topicFor({ truckClass: "fura" }), "fura");
  assert.equal(topicFor({ truckClass: "katta_fura" }), "fura");
  assert.equal(topicFor({ truckClass: "mini_fura" }), "fura");
  assert.equal(topicFor({ truckClass: "kamaz" }), "kamaz");
  assert.equal(topicFor({ truckClass: "katta_isuzu" }), "isuzu");
  assert.equal(topicFor({ truckClass: "kichik" }), "kichik");
  assert.equal(topicFor({ truckClass: "labo" }), "labo");
  assert.equal(topicFor({ truckClass: "yengil_avto" }), "yengil_avto");
  assert.equal(topicFor({ truckClass: null }), "boshqa");
  assert.equal(topicFor({}), "boshqa");
  // vehicles.js ga yangi sinf qo'shilsa — bu yerda ham bo'lim belgilansin
  const covered = GROUP_TOPICS.flatMap((t) => t.classes);
  for (const id of TRUCK_CLASS_IDS) assert.ok(covered.includes(id), `${id} hech qaysi bo'limda yo'q`);
});

test("start bo'limlarni bir marta ochadi, id'lar bazada saqlanadi", async () => {
  const store = openStore({ file: ":memory:" });
  const api = fakeApi();
  const poster = createGroupPoster({ api, store, chat: "@guruh", log: () => {} });
  await poster.start();
  poster.stop();
  assert.equal(api.calls.filter((c) => c.method === "createForumTopic").length, GROUP_TOPICS.length);
  // Qayta yonganda — yangi bo'lim ochilmaydi
  const again = fakeApi();
  const second = createGroupPoster({ api: again, store, chat: "@guruh", log: () => {} });
  await second.start();
  second.stop();
  assert.equal(again.calls.length, 0);
  // Boshqa guruh — o'z bo'limlari
  const other = fakeApi();
  const third = createGroupPoster({ api: other, store, chat: "@boshqa_guruh", log: () => {} });
  await third.start();
  third.stop();
  assert.equal(other.calls.length, GROUP_TOPICS.length);
});

test("yuk mos bo'limga tugmalar bilan boradi; navbat bittadan yuboriladi", async () => {
  const store = openStore({ file: ":memory:" });
  const api = fakeApi();
  const poster = createGroupPoster({ api, store, chat: "@guruh", botUsername: () => "Yuk_Ekspert_agent", log: () => {} });
  await poster.start();
  poster.stop();
  const { topics } = poster.stats();
  poster.push({ ...LOAD, truckClass: "isuzu" }, POST);
  poster.push({ ...LOAD, truckClass: null }, POST);
  assert.equal(poster.stats().queued, 2);
  await poster.tick();
  const first = api.calls.filter((c) => c.method === "sendMessage");
  assert.equal(first.length, 1);
  assert.equal(first[0].options.message_thread_id, topics.isuzu);
  assert.equal(first[0].options.parse_mode, "HTML");
  assert.match(first[0].text, /Toshkent/);
  assert.deepEqual(first[0].options.reply_markup.inline_keyboard.flat().map((b) => b.url), [
    "https://t.me/yuk_guruh/5",
    "https://t.me/Yuk_Ekspert_agent?start=guruh",
  ]);
  await poster.tick();
  assert.equal(api.calls.filter((c) => c.method === "sendMessage").at(-1).options.message_thread_id, topics.boshqa);
  assert.deepEqual({ queued: poster.stats().queued, sent: poster.stats().sent }, { queued: 0, sent: 2 });
});

test("bo'lim qo'lda o'chirilgan bo'lsa — qayta ochiladi va yuk yetadi", async () => {
  const store = openStore({ file: ":memory:" });
  const setup = fakeApi();
  const before = createGroupPoster({ api: setup, store, chat: "@guruh", log: () => {} });
  await before.start();
  before.stop();
  const oldFura = before.stats().topics.fura;
  const api = fakeApi({ goneOnce: oldFura, firstThread: 100 });
  const poster = createGroupPoster({ api, store, chat: "@guruh", log: () => {} });
  poster.push({ ...LOAD, truckClass: "fura" }, POST);
  await poster.tick();
  assert.equal(api.calls.filter((c) => c.method === "createForumTopic").length, 1);
  const sends = api.calls.filter((c) => c.method === "sendMessage");
  assert.equal(sends.length, 2);
  assert.notEqual(sends[1].options.message_thread_id, oldFura);
  assert.equal(poster.stats().sent, 1);
});

test("navbatda uzoq turgan yuk tashlanadi, navbat chegarasi bor", async () => {
  const store = openStore({ file: ":memory:" });
  const api = fakeApi();
  let time = 1_000_000;
  const poster = createGroupPoster({ api, store, chat: "@guruh", log: () => {}, maxQueue: 3, maxAgeMs: 60_000, now: () => time });
  poster.push({ ...LOAD, truckClass: "fura" }, POST);
  time += 61_000;
  poster.push({ ...LOAD, truckClass: "labo" }, POST);
  await poster.tick();
  const sends = api.calls.filter((c) => c.method === "sendMessage");
  assert.equal(sends.length, 1);
  assert.equal(poster.stats().dropped, 1);
  for (let i = 0; i < 5; i++) poster.push(LOAD, POST);
  assert.equal(poster.stats().queued, 3);
  assert.equal(poster.stats().dropped, 3);
});
