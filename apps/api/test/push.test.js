import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { openStore } from "@yuk/store";
import { createFeedList } from "../src/feedList.js";
import { createFcm } from "../src/fcm.js";
import { RELEASE_KEY, createPusher, createReleaseNotifier, pushMessage } from "../src/push.js";

const NOW = 1_800_000_000_000;
const TOKEN = "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa:bbb";
const LOAD = (n) => `Toshkentdan Samarqandga 20 tonna yuk bor, fura kerak. +998 90 000 00 ${String(n).padStart(2, "0")}`;

function setup() {
  let now = NOW;
  const store = openStore({ file: ":memory:", now: () => now });
  let id = 0;
  const add = (text) => store.addPost({ source: "@yuk_aaa", messageId: ++id, link: null, text, postedAt: now - 1000 });
  store.saveDriver(7, { role: "haydovchi", profile: { feed: { mode: "tezkor", sources: [] } }, active: true });
  const sent = [];
  const pusher = createPusher({ store, feedList: createFeedList({ store, now: () => now }), send: async (token, data) => (sent.push({ token, data }), "ok") });
  return { store, add, sent, pusher, tickTime: (ms) => (now += ms) };
}

test("birinchi aylanishda eskilari yuborilmaydi, keyin faqat yangilari", async () => {
  const { store, add, sent, pusher } = setup();
  add(LOAD(1));
  store.savePushToken(7, TOKEN);
  await pusher.tick();
  assert.equal(sent.length, 0);
  add(LOAD(2));
  await pusher.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].data.title, /^📍 .+ → .+/);
  assert.equal(sent[0].data.categoryId, "yuk");
  assert.equal(JSON.parse(sent[0].data.body).phone.replace(/\D/g, ""), "998900000002");
  await pusher.tick();
  assert.equal(sent.length, 1); // takror yo'q
});

test("pauzada yuborilmaydi; o'lik token o'chadi; chiqqanda tokenlar o'chadi", async () => {
  const { store, add, sent, pusher } = setup();
  store.savePushToken(7, TOKEN);
  await pusher.tick();
  store.saveDriver(7, { active: false });
  add(LOAD(3));
  await pusher.tick();
  assert.equal(sent.length, 0);

  const gone = createPusher({ store, feedList: createFeedList({ store, now: () => NOW }), send: async () => "gone" });
  store.saveDriver(7, { active: true });
  add(LOAD(4));
  await gone.tick();
  assert.equal(store.pushTokens().length, 0);

  store.savePushToken(7, TOKEN);
  store.dropPushTokensOf(7);
  assert.equal(store.pushTokens().length, 0);
});

test("bir aylanishda ko'pi bilan 3 ta, eng yangisi oxirida (telefonda tepada)", async () => {
  const { store, add, sent, pusher } = setup();
  store.savePushToken(7, TOKEN);
  await pusher.tick();
  for (let n = 10; n < 16; n++) add(LOAD(n));
  await pusher.tick();
  assert.equal(sent.length, 3);
  assert.match(JSON.parse(sent[2].data.body).phone, /15$/);
});

test("yo'nalishsiz e'lon — «🚚 Yangi yuk», raqamsiz — tugmasiz", () => {
  const msg = pushMessage({ id: 5, load: { phones: [] }, post: { text: "a".repeat(300) } });
  assert.equal(msg.title, "🚚 Yangi yuk");
  assert.equal(msg.categoryId, "");
  assert.equal(msg.message.length, 180);
});

test("FCM: JWT bilan token oladi, yuboradi; 404 — gone", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { project_id: "p1", client_email: "x@p1.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const calls = [];
  let status = 200;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "AT", expires_in: 3600 }) };
    return { ok: status === 200, status, json: async () => ({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }) };
  };
  const send = createFcm(key, { fetch, now: () => NOW });
  assert.equal(await send(TOKEN, { title: "t" }), "ok");
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.message.android.priority, "HIGH");
  assert.equal(calls[1].init.headers.authorization, "Bearer AT");
  status = 404;
  assert.equal(await send(TOKEN, {}), "gone");
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1); // token keshda
});

test("body ichida e'lonning o'zi, 4 KB dan oshmaydi (uzun kirill matn qisqartiriladi)", () => {
  const item = { id: 9, load: { fromRegion: "toshkent", phones: ["+998900000001"] }, post: { source: "@a", postedAt: 1, text: "Юк бор ".repeat(800) } };
  const msg = pushMessage(item);
  const body = JSON.parse(msg.body);
  assert.equal(body.item.id, 9);
  assert.equal(body.item.post.source, "@a");
  assert.ok(body.item.post.text.endsWith("…"));
  const total = Object.entries(msg).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  assert.ok(total < 4096, `jami ${total} bayt`);
  const short = JSON.parse(pushMessage({ ...item, post: { ...item.post, text: "qisqa" } }).body);
  assert.equal(short.item.post.text, "qisqa");
});

test("yangi ilova versiyasi: birinchi marta faqat eslab qoladi, keyingi versiyada hammaga bir marta «yangilang»", async () => {
  const store = openStore({ file: ":memory:", now: () => 1 });
  store.savePushToken(1, "a".repeat(30));
  store.savePushToken(2, "b".repeat(30));
  let apk = { version: "1.0.0", versionCode: 10 };
  const sent = [];
  const notifier = createReleaseNotifier({ store, readRelease: () => apk, send: async (token, data) => (sent.push({ token, data }), "ok") });
  await notifier.tick();
  assert.equal(sent.length, 0);
  assert.equal(store.getSetting(RELEASE_KEY), "10");
  apk = { version: "1.1.0", versionCode: 11 };
  await notifier.tick();
  await notifier.tick(); // takrorlanmaydi
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(sent[0].data.body).type, "update");
  assert.match(sent[0].data.message, /1\.1\.0/);
  store.close();
});
