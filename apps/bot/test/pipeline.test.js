import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createWorker, processPost } from "../src/pipeline.js";

const LOAD = {
  fromCity: "Toshkent", fromRegion: "toshkent_sh", fromCountry: "O'zbekiston",
  toCity: "Samarqand", toRegion: "samarqand", toCountry: "O'zbekiston",
  weightT: 20, bodyType: "tent", truckClass: "fura", loadingSides: [], phones: ["+998900000001"],
};
const FURA = { vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 25000 }, fromAreas: ["toshkent"], mode: "own" };
const ISUZU = { vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000 }, fromAreas: ["toshkent"], mode: "own" };

function setup(answers) {
  const store = openStore({ file: ":memory:" });
  store.saveDriver(1, { profile: FURA, active: true });
  store.saveDriver(2, { profile: ISUZU, active: true });
  store.saveDriver(3, { profile: FURA, active: false });
  const queue = [...answers];
  const parser = {
    provider: {},
    async parse() {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const published = [];
  const delivered = [];
  const deps = {
    parser,
    store,
    publish: async (load) => (published.push(load), 100 + published.length),
    deliver: async (chatId) => (delivered.push(chatId), true),
  };
  const add = (id, text = `e'lon ${id} ${"x".repeat(20)}`) => store.addPost({ source: "@g", messageId: id, text, postedAt: Date.now() });
  return { store, deps, published, delivered, add };
}

test("yuk kanalga va faqat mos, faol haydovchiga boradi", async () => {
  const { store, deps, published, delivered, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  add(1);
  const result = await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(result, { status: "done", loads: 1, fresh: 1, sent: 1 });
  assert.equal(published.length, 1);
  assert.deepEqual(delivered, [1], "Isuzu (5 t) va pauzadagi haydovchiga bormaydi");
  assert.equal(store.takeNewPosts().length, 0);
  assert.equal(store.stats().loads24h.sent, 1);
});

test("boshqa guruhdagi o'sha yuk (boshqacha matn) ikkinchi marta yuborilmaydi", async () => {
  const answer = { ok: true, postType: "yuk_bor", loads: [LOAD] };
  const { store, deps, published, delivered, add } = setup([answer, { ...answer, loads: [{ ...LOAD, price: 5000000 }] }]);
  add(1, "Toshkentdan Samarqandga 20 t tent kerak +998900000001");
  add(2, "Тошкент - Самарканд 20т тент. Нарх 5 млн +998900000001");
  for (const post of store.takeNewPosts()) await processPost(post, deps);
  assert.equal(published.length, 1);
  assert.deepEqual(delivered, [1]);
});

test("reklama, mashina bo'sh e'loni va AI xatosi", async () => {
  const { store, deps, published, add } = setup([
    { ok: true, postType: "boshqa", loads: [] },
    { ok: true, postType: "mashina_bor", loads: [LOAD] },
    { ok: false, error: "JSON o'qilmadi" },
  ]);
  add(1);
  add(2);
  add(3);
  const statuses = [];
  for (const post of store.takeNewPosts()) statuses.push((await processPost(post, deps)).status);
  assert.deepEqual(statuses, ["skipped", "skipped", "failed"]);
  assert.equal(published.length, 0);
  assert.equal(store.stats().posts.failed, 1);
});

test("worker: daqiqalik limitda kutadi va o'sha e'lonni qayta oladi", async () => {
  const limit = Object.assign(new Error("429"), { status: 429 });
  const { store, deps, delivered, add } = setup([limit, { ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  deps.parser.provider = { retryAfterMs: (e) => (e === limit ? 1 : null), isFatal: () => false, describeError: (e) => e.message };
  add(1);
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m) });
  await worker.runOnce();
  assert.equal(store.takeNewPosts().length, 1, "e'lon navbatda qoldi");
  await worker.runOnce();
  assert.equal(store.takeNewPosts().length, 0);
  assert.deepEqual(delivered, [1]);
  assert.match(logs[0], /kutamiz/);
});

test("worker: tushunarsiz xato — e'lon 'failed', navbat to'xtamaydi", async () => {
  const { store, deps, delivered, add } = setup([new Error("kutilmagan"), { ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  add(1);
  add(2, "boshqa e'lon matni, uzunroq yozildi");
  const worker = createWorker(deps, { log: () => {} });
  await worker.runOnce();
  assert.equal(store.stats().posts.failed, 1);
  assert.equal(store.stats().posts.done, 1);
  assert.deepEqual(delivered, [1]);
});
