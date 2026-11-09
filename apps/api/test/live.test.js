// Jonli yangilanish (live.js): belgilar o'zgarsa — ulangan sahifalarga «change» xabari; HTTP ustida /api/live
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { changedTopics, createLive, processMarks } from "../src/live.js";

// Express javobining o'rniga: yozilganlarni yig'adi, "close" ni qo'lda chaqiramiz
function fakeClient() {
  const req = new EventEmitter();
  const res = { head: null, chunks: [], ended: false, writeHead: (status, headers) => (res.head = { status, headers }), write: (t) => res.chunks.push(t), end: () => (res.ended = true) };
  return { req, res, text: () => res.chunks.join("") };
}

test("changedTopics: birinchi o'lchovda hech narsa, keyin faqat o'zgarganlari", () => {
  assert.deepEqual(changedTopics(null, { a: "1" }), []);
  assert.deepEqual(changedTopics({ a: "1", b: "2" }, { a: "1", b: "3" }), ["b"]);
});

test("processMarks: holat va oxirgi log qatori", () => {
  const processes = { list: () => [{ name: "bot", status: "running", pid: 5, startedAt: 9, crashes: 0 }], logs: () => ({ last: 42 }) };
  assert.deepEqual(processMarks(processes), { processes: "bot:running:5:9:0", logs: "bot:42" });
});

test("createLive: ulanganda ready, o'zgarishda change, uzilganda taymer to'xtaydi", () => {
  let marks = { drivers: "1", posts: "1" };
  const live = createLive({ marks: () => marks, intervalMs: 60_000 });
  const a = fakeClient();
  live.handler(a.req, a.res);
  assert.equal(a.res.head.status, 200);
  assert.match(a.res.head.headers["content-type"], /^text\/event-stream/);
  assert.match(a.text(), /retry: 3000[\s\S]*event: ready/);

  assert.deepEqual(live.tick(), [], "hech narsa o'zgarmadi");
  marks = { drivers: "2", posts: "1" };
  assert.deepEqual(live.tick(), ["drivers"]);
  assert.match(a.text(), /event: change\ndata: \{"topics":\["drivers"\]\}\n\n$/);

  const b = fakeClient();
  live.handler(b.req, b.res);
  assert.equal(live.clients(), 2);
  a.req.emit("close");
  assert.equal(live.clients(), 1);
  live.close();
  assert.equal(b.res.ended, true);
  assert.equal(live.clients(), 0);
});

test("createLive: baza band bo'lsa — xato yutiladi, keyingi safar davom etadi", () => {
  let fail = false;
  const logs = [];
  const live = createLive({ marks: () => {
    if (fail) throw new Error("database is locked");
    return { drivers: "1" };
  }, intervalMs: 60_000, log: (m) => logs.push(m) });
  const c = fakeClient();
  live.handler(c.req, c.res);
  fail = true;
  assert.deepEqual(live.tick(), []);
  assert.deepEqual(live.tick(), []);
  assert.equal(logs.length, 1, "bir marta yoziladi");
  live.close();
});

test("GET /api/live: oqim ochiladi, bazadagi o'zgarish «change» bo'lib keladi", async () => {
  const store = openStore({ file: ":memory:" });
  const processes = { list: () => [], logs: () => ({ last: 0 }) };
  const app = createApp({ store, processes, env: {} });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (pattern) => {
      while (!pattern.test(text)) text += decoder.decode((await reader.read()).value, { stream: true });
    };
    await until(/event: ready/);
    store.saveDriver(7, { name: "Ali" }); // bot yozgandek
    app.locals.live.tick(); // taymerni kutmasdan
    await until(/event: change/);
    assert.match(text, /"topics":\["drivers"\]/);
  } finally {
    controller.abort();
    app.locals.live.close();
    server.close();
    store.close();
  }
});
