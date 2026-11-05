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
  // postedAt standart: id tartibida (1-e'lon eng eski), bir millisekundda qo'shilsa ham tartib aniq bo'lsin
  const add = (id, text = `e'lon ${id} ${"x".repeat(20)}`, postedAt = Date.now() - 1000 + id) =>
    store.addPost({ source: "@g", messageId: id, text, postedAt });
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

// --- Batch: bir nechta e'lon bitta AI so'rovida ---

const BUXORO = { ...LOAD, toCity: "Buxoro", toRegion: "buxoro" };
const NAVOIY = { ...LOAD, toCity: "Navoiy", toRegion: "navoiy" };
const yuk = (...loads) => ({ ok: true, postType: "yuk_bor", loads });

// parseBatch javoblari navbati (natijalar massivi yoki Error); parse — faqat bittadan tahlil uchun
function batchParser(batchAnswers, singleAnswers = []) {
  const batches = [...batchAnswers];
  const singles = [...singleAnswers];
  const calls = { batch: [], single: [] };
  return {
    calls,
    parser: {
      provider: {},
      async parse(text) {
        calls.single.push(text);
        const next = singles.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      async parseBatch(texts) {
        calls.batch.push(texts);
        const next = batches.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

test("worker: e'lonlar bitta AI so'rovida, har natija o'z e'loniga; yuklar yuborishdan oldin bazada", async () => {
  const { store, deps, add } = setup([]);
  // Navbatdan eng yangisi birinchi olinadi: 3, 2, 1 — javoblar shu tartibda
  const { parser, calls } = batchParser([[yuk(BUXORO, NAVOIY), { ok: true, postType: "boshqa", loads: [] }, yuk(LOAD)]]);
  deps.parser = parser;
  const sentFor = [];
  const savedBeforeSend = [];
  deps.publish = async (load, post) => {
    sentFor.push(`${post.messageId}:${load.toCity}`);
    savedBeforeSend.push(store.stats().loads24h.total);
    return null;
  };
  add(1);
  add(2);
  add(3);
  const worker = createWorker(deps, { log: () => {} });
  assert.equal(await worker.runOnce(), 3);
  assert.equal(calls.batch.length, 1);
  assert.equal(calls.batch[0].length, 3);
  assert.equal(calls.single.length, 0);
  assert.deepEqual(calls.batch[0], [3, 2, 1].map((id) => `e'lon ${id} ${"x".repeat(20)}`));
  assert.deepEqual(sentFor, ["3:Buxoro", "3:Navoiy", "1:Samarqand"]);
  assert.deepEqual(savedBeforeSend, [2, 2, 3], "3-e'lonning ikkala yuki birinchisi yuborilishidan oldin yozilgan");
  assert.equal(store.stats().posts.done, 3);
});

test("worker: navbat to'lib qolsa eng yangi e'lonlar birinchi, eskilari keyin", async () => {
  const { store, deps, add } = setup([]);
  const { parser, calls } = batchParser([[yuk(LOAD), yuk(BUXORO)], [yuk(NAVOIY), { ok: true, postType: "boshqa", loads: [] }]]);
  deps.parser = { ...parser, batchSize: 2 };
  const hour = 60 * 60 * 1000;
  // id tartibi (kelish tartibi) va joylangan vaqt farq qiladi: 2-e'lon eng yangi
  add(1, "bir soatlik e'lon, eski yuk matni", Date.now() - hour);
  add(2, "hozirgina joylangan e'lon matni", Date.now());
  add(3, "besh daqiqalik e'lon matni bu yerda", Date.now() - 5 * 60 * 1000);
  add(4, "yarim soatlik e'lon matni bu yerda", Date.now() - hour / 2);
  const worker = createWorker(deps, { log: () => {} });
  await worker.runOnce();
  assert.deepEqual(calls.batch[0], ["hozirgina joylangan e'lon matni", "besh daqiqalik e'lon matni bu yerda"]);
  await worker.runOnce();
  assert.deepEqual(calls.batch[1], ["yarim soatlik e'lon matni bu yerda", "bir soatlik e'lon, eski yuk matni"]);
  assert.equal(store.stats().posts.done, 4);
  // Boshqa joylar (standart) uchun tartib o'zgarmagan: navbat tartibida
  const other = setup([]);
  other.add(1, "birinchi kelgan e'lon matni", Date.now());
  other.add(2, "ikkinchi kelgan e'lon matni", Date.now() + 1000);
  assert.deepEqual(other.store.takeNewPosts().map((p) => p.messageId), [1, 2]);
  assert.deepEqual(other.store.takeNewPosts(10, { newest: true }).map((p) => p.messageId), [2, 1]);
});

test("worker: navbatdan parser.batchSize tadan oladi", async () => {
  const { store, deps, add } = setup([]);
  const { parser, calls } = batchParser([[yuk(LOAD), yuk(BUXORO)]], [yuk(NAVOIY)]);
  deps.parser = { ...parser, batchSize: 2 };
  add(1);
  add(2);
  add(3);
  const worker = createWorker(deps, { log: () => {} });
  assert.equal(await worker.runOnce(), 2);
  assert.equal(await worker.runOnce(), 1);
  assert.deepEqual(calls.batch.map((t) => t.length), [2]);
  assert.equal(calls.single.length, 1, "bitta qolgan e'lon — oddiy so'rov");
  assert.equal(store.stats().posts.done, 3);
});

test("worker: guruhga daqiqalik limit — kutadi, hamma e'lon navbatda qoladi va keyin qayta olinadi", async () => {
  const limit = Object.assign(new Error("429"), { status: 429 });
  const { store, deps, published, add } = setup([]);
  const { parser, calls } = batchParser([limit, [yuk(LOAD), yuk(BUXORO)]]);
  deps.parser = { ...parser, provider: { retryAfterMs: (e) => (e === limit ? 1 : null), isFatal: () => false, describeError: (e) => e.message } };
  add(1);
  add(2);
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m) });
  await worker.runOnce();
  assert.equal(store.takeNewPosts().length, 2, "ikkala e'lon ham navbatda");
  assert.equal(published.length, 0);
  assert.match(logs[0], /kutamiz/);
  await worker.runOnce();
  assert.equal(calls.batch.length, 2);
  assert.equal(store.takeNewPosts().length, 0);
  assert.equal(published.length, 2);
});

test("worker: kunlik limit — 30 daqiqa, model band — 5 daqiqa kutadi, e'lonlar navbatda", async () => {
  for (const [status, seconds] of [[429, 1800], [503, 300]]) {
    const error = Object.assign(new Error(String(status)), { status });
    const { store, deps, add } = setup([]);
    deps.parser = { ...batchParser([error]).parser, provider: { retryAfterMs: () => null, isFatal: () => true, describeError: (e) => e.message } };
    add(1);
    add(2);
    const logs = [];
    const worker = createWorker(deps, { log: (m) => logs.push(m) });
    const run = worker.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    worker.stop(); // uzoq kutishni testda to'xtatamiz
    await run;
    assert.match(logs[0], new RegExp(`${seconds} s kutamiz`));
    assert.equal(store.takeNewPosts().length, 2);
  }
});

test("worker: guruhda kutilmagan xato — e'lonlar bittadan tahlil qilinadi", async () => {
  const { store, deps, add } = setup([]);
  const { parser, calls } = batchParser([new Error("kutilmagan")], [yuk(LOAD), new Error("buzuq")]);
  deps.parser = parser;
  add(1);
  add(2);
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m) });
  await worker.runOnce();
  assert.equal(calls.single.length, 2);
  assert.equal(store.stats().posts.done, 1);
  assert.equal(store.stats().posts.failed, 1);
  assert.match(logs[0], /bittadan/);
});

test("worker: yaroqsiz javobdan keyin bittadan tahlilda xato bo'lgan e'lon 'failed', qolgani yuboriladi", async () => {
  const { store, deps, published, add } = setup([]);
  const fallback = "JSON o'qilmadi";
  deps.parser = batchParser([[{ ...yuk(LOAD), fallback }, { ok: false, error: "bloklandi", fallback }]]).parser;
  add(1);
  add(2);
  const logs = [];
  await createWorker(deps, { log: (m) => logs.push(m) }).runOnce();
  assert.equal(published.length, 1);
  assert.equal(store.stats().posts.failed, 1);
  assert.match(logs[0], /yaroqsiz.*2 ta e'lon bo'linib qayta/);
});

test("worker: guruh to'lmagan va e'lonlar yangi bo'lsa yig'ilishini kutadi (limitni tejash)", async () => {
  const { store, deps, add } = setup([]);
  const { parser, calls } = batchParser([[yuk(LOAD), yuk(BUXORO)]]);
  deps.parser = parser;
  add(1);
  add(2);
  let clock = Date.now();
  const worker = createWorker(deps, { batch: 5, log: () => {}, now: () => clock });
  assert.equal(await worker.runOnce({ fillWaitMs: 60_000 }), 0, "2 ta e'lon, 5 ta kerak, hali 1 daqiqa o'tmagan");
  assert.equal(calls.batch.length, 0);
  clock += 61_000;
  assert.equal(await worker.runOnce({ fillWaitMs: 60_000 }), 2, "eng eski e'lon 1 daqiqadan oshdi — kutmaydi");
  assert.equal(store.stats().posts.done, 2);

  // Guruh to'lsa — darhol
  const full = setup([]);
  full.deps.parser = batchParser([[yuk(LOAD), yuk(BUXORO)]]).parser;
  full.add(1);
  full.add(2);
  assert.equal(await createWorker(full.deps, { batch: 2, log: () => {} }).runOnce({ fillWaitMs: 60_000 }), 2);
});
