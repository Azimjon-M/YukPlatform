// Boshqaruv markazi → «🔒 A'zolik» (requiredChats.js): havoladan chat, bot admin bo'lmasa — qo'shilmaydi
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { parseChatLink } from "../src/requiredChats.js";

const chats = {
  "@Yuk_Ekspert": { id: -1001, title: "Yuk Ekspert", type: "channel", username: "Yuk_Ekspert", botStatus: "administrator" },
  "@Oddiy_guruh": { id: -1002, title: "Oddiy guruh", type: "supergroup", username: "Oddiy_guruh", botStatus: "member" },
};
const telegram = async (url, options) => {
  const method = url.split("/").pop();
  const body = JSON.parse(options.body);
  const reply = (result) => ({ json: async () => result });
  if (method === "getMe") return reply({ ok: true, result: { id: 99, username: "Yuk_bot" } });
  if (method === "getChat") {
    const chat = chats[body.chat_id];
    return reply(chat ? { ok: true, result: chat } : { ok: false, error_code: 400, description: "chat not found" });
  }
  const chat = Object.values(chats).find((c) => c.id === body.chat_id);
  return reply({ ok: true, result: { status: chat?.botStatus ?? "left" } });
};

let server, base, store;
before(async () => {
  store = openStore({ file: ":memory:" });
  const app = createApp({ store, processes: { list: () => [] }, env: { BOT_TOKEN: "1:t", REQUIRED_CHATS: "@Eski_kanal" }, telegramFetch: telegram });
  await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  store.close();
});
const admin = { "x-yuk-admin": "1", "content-type": "application/json" };
const send = (method, url, body) => fetch(base + url, { method, headers: admin, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("havola: t.me, @, -100; taklif havolasi rad", () => {
  assert.equal(parseChatLink("https://t.me/Yuk_Ekspert"), "@Yuk_Ekspert");
  assert.equal(parseChatLink("@Yuk_Ekspert"), "@Yuk_Ekspert");
  assert.equal(parseChatLink("-1001234567890"), "-1001234567890");
  assert.deepEqual(parseChatLink("https://t.me/+AbCd"), { invite: true });
  assert.equal(parseChatLink("salom dunyo"), null);
});

test("ro'yxat: .env dan boshlanadi; bot admin bo'lsa qo'shiladi, bo'lmasa yo'q; o'chiriladi; bot/server shu ro'yxatni oladi", async () => {
  let res = await fetch(`${base}/api/required-chats`).then((r) => r.json());
  assert.equal(res.source, "env");
  assert.deepEqual(res.items.map((c) => c.ref), ["@Eski_kanal"]);
  assert.equal((await send("POST", "/api/required-chats", { link: "https://t.me/Oddiy_guruh" })).status, 400, "bot admin emas");
  assert.match((await send("POST", "/api/required-chats", { link: "@Yoq_chat" })).body.error, /topa olmadi/);
  const added = await send("POST", "/api/required-chats", { link: "https://t.me/Yuk_Ekspert" });
  assert.equal(added.status, 201);
  assert.equal(added.body.source, "dashboard");
  assert.deepEqual(added.body.items.map((c) => c.ref), ["@Eski_kanal", "@Yuk_Ekspert"]);
  assert.equal((await send("POST", "/api/required-chats", { link: "@yuk_ekspert" })).status, 400, "takror");
  res = await send("DELETE", `/api/required-chats/${encodeURIComponent("@Eski_kanal")}`);
  assert.deepEqual(res.body.items.map((c) => c.ref), ["@Yuk_Ekspert"]);
  assert.deepEqual(store.requiredChatRefs(["@Eski_kanal"]), ["@Yuk_Ekspert"], "bot va ilova serveri bazadagini oladi");
  await send("DELETE", `/api/required-chats/${encodeURIComponent("@Yuk_Ekspert")}`);
  assert.deepEqual(store.requiredChatRefs(["@Eski_kanal"]), [], "hammasi o'chirilsa — a'zolik yo'q (.env ga qaytmaydi)");
});
