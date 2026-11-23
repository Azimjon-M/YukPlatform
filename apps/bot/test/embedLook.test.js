import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createEmbedLook } from "../src/embedLook.js";

// 2 o'lchamli soxta model: [1,0] → yuk (p≈1), [0,1] → emas (p≈0)
const model = { kind: "logreg", signature: "embeddinggemma-2-uz/2/Classification", dimensions: 2, bias: 0, weights: Float32Array.from([12, -12]) };
const unsure = { chatter: true, score: 0.4, origins: [], trucks: [] }; // fastLook ikkilangan, «emas» degan
const sure = { chatter: true, score: 0.001, origins: [], trucks: [] };

function setup({ vector = [1, 0], delayMs = 0, down = false } = {}) {
  const store = openStore({ file: ":memory:" });
  const calls = [];
  const embedder = {
    embed: async (texts) => {
      calls.push(texts);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return down ? null : texts.map(() => Float32Array.from(vector));
    },
  };
  const look = createEmbedLook({ store, embedder, model });
  const rows = () => store.db.prepare("SELECT * FROM embed_verdicts").all();
  return { store, look, calls, rows };
}
const flush = () => new Promise((r) => setTimeout(r, 5));

test("soya (standart): so'raladi va yoziladi, lekin kutilmaydi (null)", async () => {
  const { look, calls, rows } = setup();
  assert.equal(look.check({ id: 1, text: "yuk bor" }, unsure), null);
  await flush();
  assert.equal(calls.length, 1);
  const [row] = rows();
  assert.deepEqual([row.fast, row.mixed, row.used, row.mode], [0, 1, 0, "shadow"]);
});

test("ishonchli fastLook, yuk beruvchining yuki, off — embedding so'ralmaydi", async () => {
  const { store, look, calls } = setup();
  assert.equal(look.check({ id: 1, text: "a" }, sure), null);
  assert.equal(look.check({ id: 2, text: "a", shipper: 5 }, unsure), null);
  store.setSetting("embed_config", JSON.stringify({ mode: "off" }));
  assert.equal(look.check({ id: 3, text: "a" }, unsure), null);
  await flush();
  assert.equal(calls.length, 0);
});

test("live: aralash qaror qaytadi va ishlatilgan deb yoziladi", async () => {
  const { store, look, rows } = setup();
  store.setSetting("embed_config", JSON.stringify({ mode: "live" }));
  const better = await look.check({ id: 1, text: "yuk bor" }, unsure);
  assert.equal(better.chatter, false);
  assert.ok(better.embed > 0.99);
  assert.deepEqual([rows()[0].used, rows()[0].mode], [1, "live"]);
});

test("live: 1pro kechiksa — fastLook qarori, yozuvda used=0; ishlamasa — fastLook, yozuv yo'q", async () => {
  const slow = setup({ delayMs: 60 });
  slow.store.setSetting("embed_config", JSON.stringify({ mode: "live", timeoutMs: 10 }));
  const got = await slow.look.check({ id: 1, text: "yuk bor" }, unsure);
  assert.equal(got, unsure);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(slow.rows()[0].used, 0);
  assert.equal(slow.look.stats.late, 1);

  const down = setup({ down: true });
  down.store.setSetting("embed_config", JSON.stringify({ mode: "live" }));
  assert.equal(await down.look.check({ id: 1, text: "x" }, unsure), unsure);
  assert.equal(down.rows().length, 0);
  assert.equal(down.look.stats.failed, 1);
});

test("buzilgan sozlama — standart (soya)", async () => {
  const { store, look } = setup();
  store.setSetting("embed_config", "{buzuq");
  assert.equal(look.config().mode, "shadow");
  assert.equal(look.check({ id: 1, text: "a" }, unsure), null);
});
