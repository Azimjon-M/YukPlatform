import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmbedder, embedText, textHash } from "../src/embed.js";

const vec = (n, dim = 4) => Array.from({ length: dim }, (_, i) => (i === n % dim ? 1 : 0));
// Soxta 1pro: javoblar navbati (status yoki funksiya)
function fakeApi(replies) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const reply = replies.length ? replies.shift() : 200;
    if (reply !== 200) return { ok: false, status: reply, headers: new Headers(), json: async () => ({}) };
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: body.input.map((_, i) => ({ index: i, embedding: vec(i) })) }) };
  };
  return { calls, fetchFn };
}

test("telefon raqami 1pro'ga yuborilmaydi; bir xil matn — bir xesh", () => {
  assert.equal(embedText("Yuk bor +998 90 000-00-01 Toshkent"), "Yuk bor <tel> Toshkent");
  assert.equal(textHash("a +998900000001"), textHash("a 998 90 000 00 02"));
  // 2000-belgida emoji bo'linmaydi va yolg'iz surrogat qolmaydi
  const cut = embedText("a".repeat(1999) + "🚚🚚");
  assert.equal(cut, "a".repeat(1999) + "🚚");
  assert.equal(embedText("x\ud83d y"), "x y");
});

test("kesh: takror matn API'ga qayta bormaydi, paketda bir marta", async () => {
  const api = fakeApi([]);
  const emb = createEmbedder({ apiKey: "k", dimensions: 4, fetchFn: api.fetchFn });
  const out = await emb.embed(["a", "b", "a"]);
  assert.equal(out.length, 3);
  assert.deepEqual(api.calls[0].input, ["a", "b"]);
  assert.equal(api.calls[0].model, "embeddinggemma-2-uz");
  assert.deepEqual(out[0], out[2]);
  await emb.embed(["b"]);
  assert.equal(api.calls.length, 1, "keshdan");
});

test("500 — bir marta qayta urinadi; 401 — urinmaydi va null qaytaradi (xato tashlamaydi)", async () => {
  const api = fakeApi([500, 200]);
  const emb = createEmbedder({ apiKey: "k", dimensions: 4, fetchFn: api.fetchFn, sleep: async () => {} });
  assert.ok(await emb.embed(["x"]));
  assert.equal(api.calls.length, 2);

  const bad = fakeApi([401]);
  const emb2 = createEmbedder({ apiKey: "k", dimensions: 4, fetchFn: bad.fetchFn, sleep: async () => {} });
  assert.equal(await emb2.embed(["x"]), null);
  assert.equal(bad.calls.length, 1);
  assert.equal(emb2.stats.lastError, "HTTP 401");
});

test("breaker: 3 nosozlikdan keyin 30 s API'ga bormaydi, keyin sinab ko'radi", async () => {
  let time = 0;
  const api = fakeApi([401, 401, 401, 200]);
  const emb = createEmbedder({ apiKey: "k", dimensions: 4, fetchFn: api.fetchFn, now: () => time, sleep: async () => {} });
  for (const t of ["a", "b", "c"]) assert.equal(await emb.embed([t]), null);
  assert.equal(emb.isOpen(), true);
  assert.equal(await emb.embed(["d"]), null);
  assert.equal(api.calls.length, 3, "ochiq paytda so'rov yo'q");
  time += 30_001;
  assert.ok(await emb.embed(["d"]));
  assert.equal(emb.isOpen(), false);
});

test("javob shakli noto'g'ri (o'lcham boshqa) — null", async () => {
  const api = fakeApi([]);
  const emb = createEmbedder({ apiKey: "k", dimensions: 8, fetchFn: api.fetchFn, sleep: async () => {} });
  assert.equal(await emb.embed(["a"]), null);
});

test("kalit yo'q — null, so'rov yo'q", async () => {
  const api = fakeApi([]);
  assert.equal(await createEmbedder({ apiKey: "", fetchFn: api.fetchFn }).embed(["a"]), null);
  assert.equal(api.calls.length, 0);
});
