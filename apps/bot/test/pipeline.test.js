import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { NO_CONTACT, createWorker, processPost, ruleParse } from "../src/pipeline.js";

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
  const loadIds = []; // deliver ning 5-argumenti — bazadagi yuk id («📞 Telefon qilish» tugmasi uchun)
  const deps = {
    parser,
    store,
    publish: async (load) => (published.push(load), 100 + published.length),
    deliver: async (chatId, load, post, kind, loadId) => (delivered.push(chatId), loadIds.push(loadId), true),
  };
  // postedAt standart: id tartibida (1-e'lon eng eski), bir millisekundda qo'shilsa ham tartib aniq bo'lsin
  const add = (id, text = `e'lon ${id} ${"x".repeat(20)}`, postedAt = Date.now() - 1000 + id) =>
    store.addPost({ source: "@g", messageId: id, text, postedAt });
  return { store, deps, published, delivered, loadIds, add };
}

test("yuk kanalga va faqat mos, faol haydovchiga boradi", async () => {
  const { store, deps, published, delivered, loadIds, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  add(1);
  const result = await processPost(store.takeNewPosts()[0], deps);
  const [saved] = store.recentLoads();
  assert.deepEqual(loadIds, [saved.id], "deliver yuk id'sini oladi");
  assert.deepEqual(result, { status: "done", kind: "yuk", loads: 1, outOfScope: 0, fresh: 1, sent: 1 });
  assert.equal(published.length, 1);
  assert.deepEqual(delivered, [1], "Isuzu (5 t) va pauzadagi haydovchiga bormaydi");
  assert.equal(store.takeNewPosts().length, 0);
  assert.equal(store.stats().loads24h.sent, 1);
  // Kimga yuborilgani yoziladi (boshqaruv markazi «Olgan yuklari»)
  assert.equal(store.listDrivers().find((d) => d.chatId === 1).deliveries.total, 1);
});

test("yetmagan xabar (botni bloklagan) — xato bilan yoziladi, sanalmaydi", async () => {
  const { store, deps, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  deps.deliver = async () => ({ ok: false, error: "Forbidden: bot was blocked by the user" });
  add(1);
  const result = await processPost(store.takeNewPosts()[0], deps);
  assert.equal(result.sent, 0);
  const d = store.listDrivers().find((u) => u.chatId === 1).deliveries;
  assert.deepEqual([d.total, d.failed, d.lastError], [0, 1, "Forbidden: bot was blocked by the user"]);
});

test("yo'nalishini «📋 Mos yuklar» da tanlamagan haydovchiga yuk bormaydi; «Hamma joy» tanlagan — oladi", async () => {
  const { store, deps, delivered, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  const fresh = { vehicle: FURA.vehicle, fromAreas: [], toAreas: [], routeAt: null, mode: "own" };
  store.saveDriver(4, { role: "haydovchi", profile: fresh, active: true });
  store.saveDriver(5, { role: "haydovchi", profile: { ...fresh, routeAt: Date.now() }, active: true });
  add(1);
  await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(delivered.sort(), [1, 5], "4 — yo'nalish tanlanmagan (aks holda butun O'zbekistondagi yuklar kelardi)");
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

test("yo'nalish doirasi: Rossiya yuki chiqmaydi, Qozog'iston yuki chiqadi; ROUTE_SCOPE=hammasi — hammasi", async () => {
  const russia = { ...LOAD, fromCity: "Moskva", fromRegion: "xorij", fromCountry: "Rossiya" };
  const kazakh = { ...LOAD, fromCity: "Olmaota", fromRegion: "xorij", fromCountry: "Qozog'iston", toCity: "Qo'qon", toRegion: "fargona" };
  const { store, deps, published, add } = setup([
    { ok: true, postType: "yuk_bor", loads: [russia] },
    { ok: true, postType: "yuk_bor", loads: [russia, kazakh] },
  ]);
  add(1);
  add(2);
  const [first, second] = store.takeNewPosts();
  assert.deepEqual(await processPost(first, deps), { status: "skipped", reason: "route", kind: "yuk", outOfScope: 1 });
  assert.equal(store.listPosts({ status: "done" }).items.find((p) => p.id === first.id).error, "Boshqa yo'nalish: Rossiya → O'zbekiston");
  const mixed = await processPost(second, deps);
  assert.deepEqual([mixed.status, mixed.loads, mixed.outOfScope, mixed.fresh], ["done", 1, 1, 1]);
  assert.deepEqual(published.map((l) => l.fromCountry), ["Qozog'iston"], "faqat doiradagisi kanalga");
  assert.equal(store.listLoads({}).total, 1, "doiradan tashqaridagi yuk bazaga yozilmaydi");

  const all = setup([{ ok: true, postType: "yuk_bor", loads: [russia] }]);
  all.add(1);
  const outcome = await processPost(all.store.takeNewPosts()[0], { ...all.deps, routeScope: "hammasi" });
  assert.equal(outcome.status, "done");
  assert.equal(all.published.length, 1);
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
  assert.deepEqual(statuses, ["skipped", "done", "failed"], "mashina bo'sh — endi yuk beruvchilarga (bu yerda yo'q)");
  assert.equal(published.length, 0, "bo'sh mashina kanalga chiqmaydi");
  assert.equal(store.stats().posts.failed, 1);
  assert.equal(store.stats().trucks24h.total, 1);
  assert.equal(store.stats().loads24h.total, 0);
});

test("rollar: bo'sh mashina faqat mos yuk beruvchiga, yuk faqat haydovchiga", async () => {
  const truck = { ...LOAD, fromCity: "Samarqand", fromRegion: "samarqand", toCity: "Toshkent", toRegion: "toshkent_sh", phones: ["+998900000009"] };
  const { store, deps, delivered, add } = setup([
    { ok: true, postType: "mashina_bor", loads: [truck] },
    { ok: true, postType: "yuk_bor", loads: [LOAD] },
  ]);
  const kinds = [];
  deps.deliver = async (chatId, load, post, kind) => (delivered.push(chatId), kinds.push(kind), true);
  const shipper = (chatId, fromAreas, extra = {}) =>
    store.saveDriver(chatId, {
      role: "yuk_beruvchi",
      profile: { fromAreas, toAreas: [], domestic: true, international: false, truckClasses: [], bodyTypes: [], ...extra },
      active: true,
      ...extra.user,
    });
  shipper(10, ["samarqand"]);
  shipper(11, ["buxoro"]); // boshqa joyda
  shipper(12, ["samarqand"], { truckClasses: ["isuzu"] }); // fura kerak emas
  shipper(13, ["samarqand"], { user: { active: false } }); // pauzada
  add(1, "Samarqanddan Toshkentga bo'sh fura bor xxxxxxx");
  add(2, "Toshkentdan Samarqandga yuk bor xxxxxxxxxxxxxx");

  const [first, second] = store.takeNewPosts();
  const truckResult = await processPost(first, deps);
  assert.deepEqual({ kind: truckResult.kind, sent: truckResult.sent }, { kind: "mashina", sent: 1 });
  assert.deepEqual(delivered, [10]);
  await processPost(second, deps);
  assert.deepEqual(delivered, [10, 1], "yuk FURA haydovchisiga; yuk beruvchilarga bormaydi");
  assert.deepEqual(kinds, ["mashina", "yuk"]);
  assert.equal(store.recentLoads({ kind: "mashina" }).length, 1);
  assert.equal(store.recentLoads().length, 1, "standart — faqat yuklar");
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

  // Kutish e'lon joylangan vaqtdan emas, navbatga tushgan vaqtdan: collector 5 daqiqa oldingi e'lonni hozir
  // olib kelgan bo'lsa ham, unga sherik e'lonlar yig'ilishi uchun kutamiz
  const late = setup([]);
  late.deps.parser = batchParser([], [yuk(LOAD)]).parser; // bitta e'lon — oddiy so'rov
  late.add(1, undefined, Date.now() - 5 * 60_000);
  let lateClock = Date.now();
  const lateWorker = createWorker(late.deps, { batch: 5, log: () => {}, now: () => lateClock });
  assert.equal(await lateWorker.runOnce({ fillWaitMs: 90_000 }), 0, "joylanganiga 5 daqiqa, lekin navbatga hozir tushdi");
  lateClock += 91_000;
  assert.equal(await lateWorker.runOnce({ fillWaitMs: 90_000 }), 1);

  // Guruh to'lsa — darhol
  const full = setup([]);
  full.deps.parser = batchParser([[yuk(LOAD), yuk(BUXORO)]]).parser;
  full.add(1);
  full.add(2);
  assert.equal(await createWorker(full.deps, { batch: 2, log: () => {} }).runOnce({ fillWaitMs: 60_000 }), 2);
});

// 2026-11-09: a'zo bo'lingan guruhdan jonli kelgan e'lon 90 s emas, 30 s kutadi — aks holda jonli rejim foydasiz
test("worker: jonli kelgan e'lon (via=live) qisqaroq kutadi, so'rab olingani — avvalgidek", async () => {
  const wait = { fillWaitMs: 90_000, liveWaitMs: 30_000 };
  // Faqat so'rab olingan e'lon: 31 s da hali kutadi
  const polled = setup([]);
  polled.deps.parser = batchParser([], [yuk(LOAD)]).parser;
  polled.add(1);
  let clock = Date.now() + 31_000;
  assert.equal(await createWorker(polled.deps, { batch: 5, log: () => {}, now: () => clock }).runOnce(wait), 0, "so'rab olingan — 90 s kutadi");

  // Yoniga jonli e'lon qo'shildi: uning 30 s i o'tishi bilan ikkalasi birga ketadi
  const { store, deps } = setup([]);
  deps.parser = batchParser([[yuk(LOAD), yuk(BUXORO)]]).parser;
  store.addPost({ source: "@g", messageId: 1, text: "Toshkentdan Samarqandga 20 t tent kerak" });
  store.addPost({ source: "@g", messageId: 2, text: "Buxorodan Navoiyga 10 t ref kerak", via: "live" });
  clock = Date.now() + 20_000;
  const worker = createWorker(deps, { batch: 5, log: () => {}, now: () => clock });
  assert.equal(await worker.runOnce(wait), 0, "jonli e'lonning ham 30 s i hali o'tmagan");
  clock += 11_000;
  assert.equal(await worker.runOnce(wait), 2, "jonlining 30 s i o'tdi — eskisi ham birga ketadi");
});

test("worker: joylanganiga 3 soatdan oshgan e'lon AI'ga bormaydi, «Eskirgan» deb yopiladi", async () => {
  const { store, deps, published, add } = setup([]);
  const { parser, calls } = batchParser([], [yuk(LOAD)]);
  deps.parser = parser;
  const HOUR = 3_600_000;
  add(1, "kechagi yuk Toshkent Samarqand xxxxxxxxxx", Date.now() - 4 * HOUR);
  add(2, "yangi yuk Toshkent Samarqand xxxxxxxxxxxx");
  const logs = [];
  let clock = Date.now();
  const worker = createWorker(deps, { log: (m) => logs.push(m), now: () => clock, maxAgeMs: 3 * HOUR });

  assert.equal(await worker.runOnce(), 1, "faqat yangisi");
  assert.deepEqual(calls.single, ["yangi yuk Toshkent Samarqand xxxxxxxxxxxx"]);
  assert.equal(published.length, 1);
  const old = store.db.prepare("SELECT status, error FROM posts WHERE message_id = 1").get();
  assert.equal(old.status, "done");
  assert.match(old.error, /^Eskirgan: joylanganiga 3 soatdan oshgan/);
  assert.ok(logs.some((m) => /1 ta e'lon eskirgan/.test(m)));

  // Daqiqada bir martadan ko'p tekshirilmaydi; daqiqa o'tgach — yana
  add(3, "yana bir kechagi e'lon xxxxxxxxxxxxxxxxxx", Date.now() - 5 * HOUR);
  assert.equal(await worker.runOnce(), 1, "hali bir daqiqa o'tmagan — oddiy e'londek oladi");
  add(4, "uchinchi kechagi e'lon xxxxxxxxxxxxxxxxxxx", Date.now() - 5 * HOUR);
  clock += 61_000;
  assert.equal(await worker.runOnce(), 0);
  assert.equal(store.db.prepare("SELECT status FROM posts WHERE message_id = 4").get().status, "done");
});

test("worker: maxAgeMs berilmasa (--dry-run, eski testlar) eski e'lon ham tahlil qilinadi", async () => {
  const { deps, add } = setup([]);
  const { parser, calls } = batchParser([], [yuk(LOAD)]);
  deps.parser = parser;
  add(1, undefined, Date.now() - 24 * 3_600_000);
  assert.equal(await createWorker(deps, { log: () => {} }).runOnce(), 1);
  assert.equal(calls.single.length, 1);
});

// --- Bir nechta AI ulanishi parallel (start) ---

// Har bir e'lonning o'z yo'nalishi bo'lsin (takror deb tashlanmasin): e'lon matnidagi raqam → shahar
const loadFor = (text) => ({ ...LOAD, toCity: `Shahar ${text.match(/e'lon (\d+)/)[1]}` });

// Soxta pool: har bir ulanish o'z parseBatch'i bilan; limit — shu ulanish dam oladi
function fakePool(slots, { batchSize = 2 } = {}) {
  const state = Object.fromEntries(slots.map((s) => [s.id, { busy: false, restUntil: 0, calls: [] }]));
  const pool = {
    batchSize,
    batchWaitMs: 0,
    size: () => slots.length,
    nextReadyIn: () => {
      const free = slots.filter((s) => !state[s.id].busy);
      return free.length ? Math.max(0, Math.min(...free.map((s) => state[s.id].restUntil - Date.now()))) : null;
    },
    acquire() {
      const slot = slots.find((s) => !state[s.id].busy && state[s.id].restUntil <= Date.now());
      if (!slot) return null;
      state[slot.id].busy = true;
      return {
        id: slot.id,
        label: slot.id,
        batchSize: slot.batchSize ?? null,
        describe: (e) => e.message,
        parser: {
          async parseBatch(texts) {
            state[slot.id].calls.push(texts.length);
            await new Promise((resolve) => setTimeout(resolve, slot.delay ?? 5));
            if (slot.limitOnce && state[slot.id].calls.length === 1) throw Object.assign(new Error("429 limit"), { limit: true });
            if (slot.broken) throw new Error("500 server xatosi");
            return texts.map((t) => yuk(loadFor(t)));
          },
          async parse(text) {
            return yuk(loadFor(text));
          },
        },
        // Haqiqiy pool kabi: limit — "minute"; noma'lum xato va boshqa ulanish bor — "error" (e'lonlar boshqasiga)
        fail(error) {
          const reason = error.limit ? "minute" : slots.length > 1 ? "error" : null;
          if (!reason) return null;
          state[slot.id].restUntil = Date.now() + 60_000;
          return { ms: 60_000, reason, flagged: slot.flag || undefined };
        },
        release() {
          state[slot.id].busy = false;
        },
      };
    },
  };
  return { pool, state };
}

async function runUntil(worker, done, ms = 3000) {
  const run = worker.start();
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  worker.stop();
  await run;
}

test("parallel: ikki AI ulanishi navbatni bo'lishib oladi, hech bir e'lon ikki marta tahlil qilinmaydi", async () => {
  const { store, deps, published, add } = setup([]);
  const { pool, state } = fakePool([{ id: "a", delay: 30 }, { id: "b", delay: 30 }]);
  deps.pool = pool;
  for (let i = 1; i <= 8; i++) add(i);
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m), idleMs: 10 });
  await runUntil(worker, () => store.stats().posts.done === 8);
  assert.equal(store.stats().posts.done, 8);
  assert.equal(published.length, 8, "har bir yuk bir marta");
  assert.ok(state.a.calls.length > 0 && state.b.calls.length > 0, "ikkala ulanish ham ishladi");
  assert.equal(state.a.calls.reduce((s, n) => s + n, 0) + state.b.calls.reduce((s, n) => s + n, 0), 8);
  assert.match(logs[0], /2 ta ulanish/);
});

test("parallel: bitta ulanish limitga tushsa, o'sha e'lonlarni ikkinchisi oladi", async () => {
  const { store, deps, published, add } = setup([]);
  const { pool, state } = fakePool([{ id: "a", limitOnce: true }, { id: "b", delay: 20 }]);
  deps.pool = pool;
  for (let i = 1; i <= 6; i++) add(i);
  const logs = [];
  await runUntil(createWorker(deps, { log: (m) => logs.push(m), idleMs: 10 }), () => store.stats().posts.done === 6);
  assert.equal(store.stats().posts.done, 6);
  assert.equal(published.length, 6);
  assert.equal(state.a.calls.length, 1, "a dam olyapti — boshqa so'ralmadi");
  assert.ok(logs.some((m) => /\[a\].*2 ta e'lon boshqa AI'ga o'tdi, o'zi .* dam oladi/.test(m)));
});

test("parallel: ulanishning o'z chegarasi (1pro — kichik guruh) umumiy o'lchamdan ustun", async () => {
  const { store, deps, add } = setup([]);
  const { pool, state } = fakePool([{ id: "kichik", batchSize: 2, delay: 1 }], { batchSize: 5 });
  deps.pool = pool;
  for (let i = 1; i <= 6; i++) add(i);
  await runUntil(createWorker(deps, { log: () => {}, idleMs: 10 }), () => store.stats().posts.done === 6);
  assert.equal(store.stats().posts.done, 6);
  assert.deepEqual(state.kichik.calls, [2, 2, 2]);
});

test("parallel: yuborish ketma-ket — kanalga bir vaqtda faqat bitta xabar", async () => {
  const { store, deps, add } = setup([]);
  const { pool } = fakePool([{ id: "a", delay: 1 }, { id: "b", delay: 1 }, { id: "c", delay: 1 }]);
  deps.pool = pool;
  let inFlight = 0;
  let maxInFlight = 0;
  deps.publish = async () => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return 1;
  };
  for (let i = 1; i <= 9; i++) add(i);
  await runUntil(createWorker(deps, { log: () => {}, idleMs: 10 }), () => store.stats().posts.done === 9);
  assert.equal(store.stats().posts.done, 9);
  assert.equal(maxInFlight, 1);
});

test("parallel: ulanish yo'q bo'lsa bir marta ogohlantiradi va kutadi", async () => {
  const { deps, add } = setup([]);
  deps.pool = { batchSize: 2, batchWaitMs: 0, size: () => 0, nextReadyIn: () => null, acquire: () => null };
  add(1);
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m), idleMs: 5 });
  await runUntil(worker, () => false, 60);
  assert.equal(logs.filter((m) => /kalit qo'shing/.test(m)).length, 1);
});

test("xato: ulanish xato qaytarishi bilan uning e'lonlari darhol ishlayotgan boshqa ulanishga o'tadi", async () => {
  const { store, deps, published, add } = setup([]);
  const { pool, state } = fakePool([{ id: "a", broken: true, flag: true }, { id: "b", delay: 5 }]);
  deps.pool = pool;
  for (let i = 1; i <= 6; i++) add(i);
  const logs = [];
  await runUntil(createWorker(deps, { log: (m) => logs.push(m), idleMs: 10 }), () => store.stats().posts.done === 6);
  assert.equal(store.stats().posts.done, 6, "hech bir e'lon yo'qolmadi");
  assert.equal(published.length, 6);
  assert.equal(state.a.calls.length, 1, "xato bergan ulanish dam olyapti");
  assert.equal(state.b.calls.reduce((s, n) => s + n, 0), 6, "hammasini b tahlil qildi");
  assert.ok(logs.some((m) => /\[a\]: 500 server xatosi — 2 ta e'lon boshqa AI'ga o'tdi/.test(m)));
  assert.ok(logs.some((m) => /\[a\] «muammoli» deb belgilandi/.test(m)));
});

test("xato: bitta e'lon 3 ta ulanishda xato bersa — 'failed' (cheksiz aylanmaydi)", async () => {
  const { store, deps, add } = setup([]);
  const { pool, state } = fakePool([{ id: "a", broken: true }, { id: "b", broken: true }, { id: "c", broken: true }]);
  deps.pool = pool;
  add(1);
  add(2);
  await runUntil(createWorker(deps, { log: () => {}, idleMs: 10 }), () => store.stats().posts.failed === 2);
  assert.equal(store.stats().posts.failed, 2);
  assert.deepEqual([state.a.calls.length, state.b.calls.length, state.c.calls.length], [1, 1, 1]);
  const [post] = store.listPosts({ status: "failed" }).items;
  assert.match(post.error, /3 ta AI ulanishida xato: 500 server xatosi/);
});

// --- AI'siz qoidaviy parser (deps.rules) ---
const parsedBy = (store) => Object.fromEntries(store.listPosts().items.map((p) => [p.messageId, p.parsedBy]));

test("qoidaviy parser: ishonchli e'lon AI'siz yuboriladi, qolgani AI'ga", async () => {
  // AI faqat bitta javob beradi — ikkinchi e'lon uchun
  const { store, deps, delivered, add } = setup([{ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, weightT: 5, truckClass: "isuzu" }] }]);
  let aiCalls = 0;
  const parse = deps.parser.parse;
  deps.parser.parse = (...args) => (aiCalls++, parse(...args));
  deps.rules = (text) => (text.startsWith("oddiy") ? { ok: true, postType: "yuk_bor", loads: [LOAD] } : null);
  add(1, "oddiy e'lon: Toshkentdan Samarqandga 20 tonna tent fura kerak");
  add(2, "murakkab e'lon, qoidalar tushunmaydi va AI'ga qoladi");
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m) });
  assert.equal(await worker.runOnce(), 2);
  assert.equal(aiCalls, 1, "AI faqat ikkinchi e'lonni ko'rdi");
  assert.deepEqual(delivered, [1, 2]);
  assert.deepEqual(parsedBy(store), { 1: "rules", 2: "ai" });
  assert.ok(logs.some((m) => /#\d+ @g: 1\/1 yangi yuk, 1 ta haydovchiga ⚡ AI'siz/.test(m)));
});

test("qoidaviy parser: AI ulanishi yo'q (limit tugagan) bo'lsa ham oddiy e'lon ketadi", async () => {
  const { store, deps, delivered, add } = setup([]);
  deps.pool = { size: () => 0, acquire: () => null, nextReadyIn: () => null, batchSize: 10 };
  deps.rules = (text) => (text.startsWith("oddiy") ? { ok: true, postType: "yuk_bor", loads: [LOAD] } : null);
  add(1, "oddiy e'lon: Toshkentdan Samarqandga 20 tonna tent fura kerak");
  add(2, "murakkab e'lon, qoidalar tushunmaydi va AI'ga qoladi");
  const worker = createWorker(deps, { log: () => {} });
  assert.equal(await worker.runOnce(), 1);
  assert.deepEqual(delivered, [1]);
  assert.equal(store.takeNewPosts().length, 1, "murakkab e'lon AI'ni kutyapti");
  // Har e'lon bir marta tekshiriladi: ikkinchi aylanishda qoidalar uni qayta ko'rmaydi
  let checked = 0;
  const rules = deps.rules;
  deps.rules = (text) => (checked++, rules(text));
  assert.equal(await worker.runOnce(), 0);
  assert.equal(checked, 0);
});

test("qoidaviy parser: eskirgan e'lon AI'siz ham yuborilmaydi", async () => {
  const { store, deps, delivered, add } = setup([]);
  deps.pool = { size: () => 0, acquire: () => null, nextReadyIn: () => null, batchSize: 10 };
  deps.rules = () => ({ ok: true, postType: "yuk_bor", loads: [LOAD] });
  add(1, "oddiy e'lon: Toshkentdan Samarqandga 20 tonna tent fura kerak", Date.now() - 4 * 3_600_000);
  const worker = createWorker(deps, { log: () => {}, maxAgeMs: 3 * 3_600_000 });
  await worker.runOnce();
  assert.deepEqual(delivered, []);
  assert.match(store.listPosts().items[0].error, /Eskirgan/);
});

test("ruleParse: haqiqiy qoidaviy parser — ishonchli bo'lsa natija, aks holda null", () => {
  const result = ruleParse("Toshkentdan Samarqandga 20 tonna tent fura kerak +998900000001");
  assert.equal(result.ok, true);
  assert.equal(result.postType, "yuk_bor");
  assert.equal(result.loads[0].toCity, "Samarqand");
  assert.deepEqual(result.loads[0].phones, ["+998900000001"]);
  assert.equal(ruleParse("Hasanboydan Toshkentga 20 tonna yuk bor +998900000001"), null, "noma'lum joy — AI'ga");
});

test("kanal va guruhga a'zo bo'lmagan haydovchiga yuk bormaydi (canReceive), yozuv ham qo'shilmaydi", async () => {
  const { store, deps, delivered, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  store.saveDriver(4, { profile: FURA, active: true });
  const asked = [];
  deps.canReceive = async (user) => (asked.push(user.chatId), user.chatId !== 1);
  add(1);
  const result = await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(delivered, [4]);
  assert.equal(result.sent, 1);
  assert.deepEqual(asked.sort(), [1, 4], "faqat mos haydovchilar so'raladi (Isuzu va pauzadagi — yo'q)");
  assert.equal(store.listDrivers().find((d) => d.chatId === 1).deliveries.failed, 0);
});

// --- Aloqasiz e'lonlar (deps.requireContact; .env REQUIRE_CONTACT) ---
const postsById = (store) => Object.fromEntries(store.listPosts().items.map((p) => [p.messageId, p]));
const SITE_TEXT = "Toshkentdan Samarqandga 20 tonna un bor, tent fura kerak, aloqa saytimizda";

test("aloqasiz: telefon ham, lichka ham yo'q e'lon qoidaviy parserga ham, AI'ga ham bormaydi; lichkasi bori boradi", async () => {
  const { store, deps, delivered } = setup([{ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: [] }] }]);
  let aiCalls = 0;
  const parse = deps.parser.parse;
  deps.parser.parse = (...args) => (aiCalls++, parse(...args));
  let ruleCalls = 0;
  deps.rules = () => (ruleCalls++, null); // qoidalar tushunmaydi — AI'ga qoladi
  deps.requireContact = true;
  store.addPost({ source: "@g", messageId: 1, text: SITE_TEXT, postedAt: Date.now() - 2000 });
  store.addPost({ source: "@g", messageId: 2, text: "Toshkentdan Samarqandga 20 tonna un bor, lichkaga yozing", postedAt: Date.now() - 1000, sender: "ali_logist" });
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.equal(ruleCalls, 1, "qoidalar faqat lichkasi bor e'lonni ko'rdi");
  assert.equal(aiCalls, 1, "AI ham faqat uni");
  assert.deepEqual(delivered, [1], "lichkasi bor yuk haydovchiga ketdi («💬 Lichkasi»)");
  const posts = postsById(store);
  assert.equal(posts[1].status, "done");
  assert.equal(posts[1].error, `${NO_CONTACT} — AI'ga yuborilmadi`);
  assert.equal(posts[1].parsedBy, null, "hech kim tahlil qilmadi");
  assert.equal(posts[2].error, null);
  assert.equal(store.recentLoads().length, 1, "aloqasiz e'londan yuk yozilmadi");
});

test("aloqasiz: qoidaviy parser o'chiq (RULE_PARSER=0) bo'lsa ham AI'ga bormaydi; REQUIRE_CONTACT o'chiq — avvalgidek", async () => {
  const on = setup([]);
  on.deps.requireContact = true;
  on.store.addPost({ source: "@g", messageId: 1, text: SITE_TEXT, postedAt: Date.now() - 1000 });
  assert.equal(await createWorker(on.deps, { log: () => {} }).runOnce(), 0, "AI'ga hech narsa ketmadi");
  assert.match(postsById(on.store)[1].error, /^Aloqasiz:/);

  const off = setup([{ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: [] }] }]);
  off.store.addPost({ source: "@g", messageId: 1, text: SITE_TEXT, postedAt: Date.now() - 1000 });
  await createWorker(off.deps, { log: () => {} }).runOnce();
  assert.deepEqual(off.delivered, [1]);
});

test("aloqasiz: AI natijasidagi yuklarda telefon yo'q va lichka yo'q — saqlanmaydi, yuborilmaydi (oxirgi to'siq)", async () => {
  const { store, deps, delivered, published, add } = setup([{ ok: true, postType: "mashina_bor", loads: [{ ...LOAD, phones: [] }] }]);
  deps.requireContact = true;
  add(1);
  const result = await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(result, { status: "skipped", reason: "contact", kind: "mashina" });
  assert.deepEqual(delivered, []);
  assert.deepEqual(published, []);
  assert.equal(store.recentLoads({ kind: "mashina" }).length, 0);
  assert.equal(postsById(store)[1].error, NO_CONTACT);
  assert.equal(postsById(store)[1].parsedBy, "ai");
});

// --- Yuk beruvchining o'z yuki («📦 Yuk berish»: post.direct) ---
test("yuk beruvchi yuki: AI'siz, eskirmasdan darhol mos haydovchilarga; natija yuk beruvchiga (onDirect)", async () => {
  const { store, deps, delivered } = setup([]);
  deps.pool = { size: () => 0, acquire: () => null, nextReadyIn: () => null, batchSize: 10 };
  deps.requireContact = true;
  let aiCalls = 0;
  deps.rules = () => (aiCalls++, null);
  const told = [];
  deps.onDirect = async (post, outcome) => told.push([post.shipper, outcome]);
  store.saveDriver(9, { role: "yuk_beruvchi" });
  const { id } = store.addDirectPost({ chatId: 9, text: "Toshkentdan Samarqandga 20 tonna", loads: [LOAD], via: "bot" });
  const logs = [];
  const worker = createWorker(deps, { log: (m) => logs.push(m), maxAgeMs: 1 }); // 1 ms — oddiy e'lon bo'lsa eskirgan bo'lardi
  assert.equal(await worker.runOnce(), 1);
  assert.equal(aiCalls, 0, "qoidaviy parser ham ko'rmadi");
  assert.deepEqual(delivered, [1], "Isuzu va pauzadagi haydovchiga yo'q");
  assert.deepEqual(told, [[9, { status: "done", kind: "yuk", loads: 1, outOfScope: 0, fresh: 1, sent: 1 }]]);
  const post = store.listPosts().items.find((p) => p.id === id);
  assert.equal(post.status, "done");
  assert.equal(post.parsedBy, "shipper");
  assert.ok(logs.some((m) => / 📦 yuk beruvchidan$/.test(m)));
  assert.equal(store.shipperPosts(9)[0].sent, 1);

  // Xuddi o'sha yuk qayta yuborilsa — takror: haydovchiga ikkinchi marta bormaydi, yuk beruvchiga aytiladi
  store.addDirectPost({ chatId: 9, text: "yana o'sha", loads: [LOAD], via: "web" });
  await worker.runOnce();
  assert.deepEqual(delivered, [1]);
  assert.equal(told[1][1].fresh, 0);
});

test("yuk beruvchi yuki AI navbatiga tushmaydi: take() uni o'tkazib yuboradi", async () => {
  const { store, deps, add } = setup([{ ok: true, postType: "yuk_bor", loads: [LOAD] }]);
  store.addDirectPost({ chatId: 9, text: "Toshkentdan Samarqandga 20 tonna", loads: [LOAD] });
  add(2);
  let seen = 0;
  const parse = deps.parser.parse;
  deps.parser.parse = (...args) => (seen++, parse(...args));
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.equal(seen, 1, "AI faqat guruh e'lonini ko'rdi");
  assert.equal(store.takeNewPosts().length, 0);
});

// --- Rejimlar: «⚡ Tezkor» / «📌 Mening guruhlarim» (asl matn, AI'siz — deps.deliverRaw) ---
const RAW_BASE = { vehicle: null, domestic: true, international: false, fromAreas: [], toAreas: [], routeAt: null, mode: "own" };
const TEZKOR = { ...RAW_BASE, feed: { mode: "tezkor", sources: [] } };
const GURUHLARIM = { ...RAW_BASE, feed: { mode: "guruhlarim", sources: ["@YUK_GURUH2"] } }; // harfi boshqacha — baribir topiladi
const PLUS = { ...FURA, routeAt: 1, feed: { mode: "guruhlarim_plus", sources: ["@yuk_guruh2"] } };
const LOAD_TEXT = "Toshkentdan Samarqandga 20 tonna un bor, tent fura kerak +998900000001";
const FAR_TEXT = "Toshkentdan Moskvaga 20 tonna yuk bor, tent fura kerak +998900000002";
const CHAT_TEXT = "Assalomu alaykum, hammaga xayrli kun, ishlaringiz omadli bo'lsin +998900000003";

// 1 — saralangan (FURA), 7 — tezkor, 8 — guruhlarim (@yuk_guruh2), 9 — guruhlarim + saralangan (@yuk_guruh2, FURA)
function rawSetup(answers = {}) {
  const t = setup([]);
  const { store, deps } = t;
  store.saveDriver(7, { role: "haydovchi", profile: TEZKOR, active: true });
  store.saveDriver(8, { role: "haydovchi", profile: GURUHLARIM, active: true });
  store.saveDriver(9, { role: "haydovchi", profile: PLUS, active: true });
  // AI javobi e'lon matniga qarab (navbatdan qaysi tartibda olinishi muhim emas)
  deps.parser.parse = async (text) => answers[text] ?? { ok: true, postType: "boshqa", loads: [] };
  const raw = [];
  deps.deliverRaw = async (chatId, post, { phones }) => (raw.push([chatId, post.messageId, phones]), { ok: true });
  const post = (source, messageId, text, postedAt = Date.now() - 1000) => store.addPost({ source, messageId, text, postedAt });
  return { ...t, raw, post };
}
const noAi = { size: () => 0, acquire: () => null, nextReadyIn: () => null, batchSize: 10 };

test("tezkor: yuk e'loni AI'siz, asl matn bilan — tezkorga hamma guruhdan, guruhlarimga faqat tanlaganidan", async () => {
  const { store, deps, raw, delivered, post } = rawSetup();
  deps.pool = noAi; // AI umuman yo'q — tezkor yo'l baribir ishlaydi
  post("@g", 1, LOAD_TEXT);
  post("@g", 2, FAR_TEXT);
  post("@yuk_guruh2", 3, LOAD_TEXT.replace("0001", "0004"));
  post("@g", 4, CHAT_TEXT);
  const logs = [];
  await createWorker(deps, { log: (m) => logs.push(m) }).runOnce();
  const got = raw.map(([chatId, id]) => `${id}→${chatId}`).sort();
  assert.deepEqual(got, ["1→7", "3→7", "3→8", "3→9"], "Moskva — tezkorga yo'q (chet el); salomlashish — hech kimga");
  assert.deepEqual(raw.find(([c, id]) => id === 1)[2], ["+998900000001"], "telefonlar matndan");
  assert.deepEqual(delivered, [], "saralangan yo'l AI'ni kutyapti");
  assert.equal(store.takeNewPosts().length, 4, "e'lonlar navbatda qoladi — keyin AI tahlil qiladi");
  assert.deepEqual(store.postDeliveredTo(3).sort(), [7, 8, 9]);
  assert.ok(logs.some((m) => /#\d+ @yuk_guruh2: ⚡ 3 ta haydovchiga asl matn bilan/.test(m)));
});

test("tezkor: o'zi tanlagan guruhdan chet el yuki ham keladi", async () => {
  const { deps, raw, post } = rawSetup();
  deps.pool = noAi;
  post("@yuk_guruh2", 1, FAR_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.map(([c]) => c).sort(), [8, 9], "tezkor (7) — chet el tashlandi; guruhlarim — hammasi");
});

test("tezkor: AI keyin topgan yuk asl matnni olganlarga qayta bormaydi; saralanganlarga — mos bo'lsa", async () => {
  const yukOf = (load) => ({ ok: true, postType: "yuk_bor", loads: [load] });
  const { deps, raw, delivered, post } = rawSetup({
    [LOAD_TEXT]: yukOf(LOAD),
    [CHAT_TEXT]: yukOf({ ...LOAD, toCity: "Buxoro", toRegion: "buxoro", phones: ["+998900000003"] }),
  });
  post("@g", 1, LOAD_TEXT);
  post("@yuk_guruh2", 2, CHAT_TEXT); // AI'siz tekshiruv «yuk emas» dedi, AI esa yuk topdi
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.map(([c, id]) => `${id}→${c}`), ["1→7"]);
  // 1-e'lon (@g): 7 — asl matnni olgan; 1 (saralangan) va 9 (+saralangan, @g tanlanmagan) — mos, oladi; 8 — @g kerak emas.
  // 2-e'lon (@yuk_guruh2): 7, 8, 9 — guruhdagi hamma yuk kerak, asl matn bormagan → saralangani filtrsiz; 1 — mos
  assert.deepEqual(delivered.sort(), [1, 1, 7, 8, 9, 9]);
});

test("tezkor: qoidaviy parser darhol tushungan e'lon — asl matn navbatda turganlarga saralangani ketmaydi", async () => {
  const { deps, raw, delivered, post } = rawSetup();
  deps.pool = noAi;
  deps.rules = (text) => (text === LOAD_TEXT ? { ok: true, postType: "yuk_bor", loads: [LOAD] } : null);
  post("@yuk_guruh2", 1, LOAD_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.map(([c]) => c).sort(), [7, 8, 9]);
  assert.deepEqual(delivered, [1], "faqat saralangan rejimdagi (1)");
});

test("tezkor: bot qayta yoqilsa — asl matn ikkinchi marta yuborilmaydi; eski e'lon va a'zo emas — yo'q", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.pool = noAi;
  post("@g", 1, LOAD_TEXT);
  post("@g", 2, LOAD_TEXT.replace("0001", "0005"), Date.now() - 40 * 60_000); // 40 daqiqa oldin — tezkor uchun eski
  await createWorker(deps, { log: () => {} }).runOnce();
  await createWorker(deps, { log: () => {} }).runOnce(); // yangi ishchi: navbatdagi e'lonlarni boshidan ko'radi
  assert.deepEqual(raw.map(([c, id]) => `${id}→${c}`), ["1→7"]);

  const other = rawSetup();
  other.deps.pool = noAi;
  other.deps.canReceive = async (user) => user.chatId !== 7;
  other.post("@g", 1, LOAD_TEXT);
  await createWorker(other.deps, { log: () => {} }).runOnce();
  assert.deepEqual(other.raw, [], "kanal va guruhga a'zo emas");
  assert.deepEqual(other.store.postDeliveredTo(1), []);
  assert.ok(store.postDeliveredTo(2).length === 0);
});

test("tezkor: deliverRaw berilmasa (eski main.js) — tezkor yo'l o'chiq, tezkor haydovchi AI yukini oladi", async () => {
  const { deps, delivered, post } = rawSetup({ [LOAD_TEXT]: { ok: true, postType: "yuk_bor", loads: [LOAD] } });
  delete deps.deliverRaw;
  post("@g", 1, LOAD_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(delivered.sort(), [1, 7, 9]);
});

// --- Obuna: yopiq guruh (qo'shimcha akkaunt o'qiydi, manba nomi -100…) e'loni — faqat Pro va guruhni qo'shganga ---
const CLOSED = "-1001234567";

test("yopiq guruh: yuk faqat Pro va guruhni qo'shgan haydovchiga; kanal va guruh bo'limlariga chiqmaydi", async () => {
  const { store, deps, published, delivered } = setup([
    { ok: true, postType: "yuk_bor", loads: [LOAD] },
    { ok: true, postType: "yuk_bor", loads: [{ ...LOAD, toCity: "Buxoro", toRegion: "buxoro" }] },
  ]);
  store.saveDriver(4, { profile: FURA, active: true, plan: "pro" });
  store.saveDriver(5, { profile: FURA, active: true });
  store.addUserSource({ name: CLOSED, chatId: 5, account: "dost" });
  store.addPost({ source: CLOSED, messageId: 1, text: `yopiq ${"x".repeat(20)}`, postedAt: Date.now() - 2000 });
  await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(delivered.sort(), [4, 5], "1 (bepul) olmaydi; 4 — Pro, 5 — guruhni o'zi qo'shgan");
  assert.equal(published.length, 0, "ochiq kanal / guruh bo'limlariga yo'q");
  // Ochiq guruhdagi yuk — avvalgidek hammaga va kanalga
  delivered.length = 0;
  store.addPost({ source: "@g", messageId: 2, text: `ochiq ${"x".repeat(20)}`, postedAt: Date.now() - 1000 });
  await processPost(store.takeNewPosts()[0], deps);
  assert.deepEqual(delivered.sort(), [1, 4, 5]);
  assert.equal(published.length, 1);
});

test("yopiq guruh: tezkor rejimda ham asl matn faqat Pro'ga", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.pool = noAi;
  store.saveDriver(10, { role: "haydovchi", profile: TEZKOR, active: true, plan: "pro" });
  post(CLOSED, 1, LOAD_TEXT);
  post("@g", 2, LOAD_TEXT.replace("0001", "0005"));
  await createWorker(deps, { log: () => {} }).runOnce();
  const got = raw.map(([chatId, id]) => `${id}→${chatId}`).sort();
  assert.deepEqual(got, ["1→10", "2→10", "2→7"], "7 (bepul tezkor) yopiq guruhdan olmaydi");
});

// --- Ovozli xabar (collector media.js): ochiq guruhda aloqa — xabarning havolasi ---
test("ovozli xabar: ochiq guruhda raqamsiz va lichkasiz ham yuboriladi (havola bilan); yopiq guruhda — aloqasiz", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.pool = noAi;
  deps.requireContact = true;
  const text = "Toshkentdan Samarqandga 20 tonna un bor, tent fura kerak";
  store.addPost({ source: "@g", messageId: 1, link: "https://t.me/g/1", text, postedAt: Date.now() - 1000, media: "voice" });
  store.addPost({ source: "-1001234567", messageId: 2, text: `${text}.`, postedAt: Date.now() - 1000, media: "voice" });
  store.addPost({ source: "@g", messageId: 3, link: "https://t.me/g/3", text: `${text}!`, postedAt: Date.now() - 1000 });
  void post;
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.map(([chatId, id]) => `${id}→${chatId}`).sort(), ["1→7"], "faqat ochiq guruhdagi ovozli xabar; oddiy matn va yopiq guruh — aloqasiz");
  const closed = store.listPosts({}).items.filter((p) => p.messageId !== 1);
  assert.ok(closed.every((p) => p.status === "done" && p.error?.startsWith("Aloqasiz")));
});

test("ovozli xabar: yopiq guruhda — gapirgan odam bot foydalanuvchisi bo'lsa (ID bilan «💬 Lichkasi»); begona ID — aloqa emas", async () => {
  const { store, deps, raw } = rawSetup();
  deps.pool = noAi;
  deps.requireContact = true;
  store.saveDriver(7, { plan: "pro" }); // yopiq guruh e'loni — faqat Pro
  store.saveDriver(5551234, { name: "Gapirgan" }); // botga yozgan — bot uni taniydi
  const text = "Toshkentdan Samarqandga 20 tonna un bor, tent fura kerak";
  store.addPost({ source: "-1001234567", messageId: 1, text, postedAt: Date.now() - 1000, media: "voice", senderId: "5551234" });
  store.addPost({ source: "-1001234567", messageId: 2, text: `${text}.`, postedAt: Date.now() - 1000, media: "voice" });
  store.addPost({ source: "-1001234567", messageId: 3, text: `${text}!`, postedAt: Date.now() - 1000, media: "voice", senderId: "999000" });
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.map(([chatId, id]) => `${id}→${chatId}`), ["1→7"], "ID'siz va begona ID — aloqasiz");
});

test("«📌 Mening guruhlarim»da yopiq guruh: Pro haydovchiga asl matn keladi; Pro'si yo'qolsa — kelmaydi", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.pool = noAi;
  store.saveDriver(8, { plan: "pro", profile: { ...GURUHLARIM, feed: { mode: "guruhlarim", sources: ["-1001234567"] } } });
  post("-1001234567", 1, LOAD_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.ok(raw.some(([chatId, id]) => chatId === 8 && id === 1));
  store.saveDriver(8, { plan: "free" });
  post("-1001234567", 2, LOAD_TEXT.replace("0001", "0009"));
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.ok(!raw.some(([chatId, id]) => chatId === 8 && id === 2), "Pro emas — yopiq guruhdan yo'q");
});

// --- Saralash o'chiq (deps.sortingOff, 2026-11-19: «algoritmni noaktiv qil, bizga tezlik kerak sifat emas») ---
test("sortingOff: hamma haydovchiga filtrsiz asl matn (chet el, salomlashish, aloqasiz ham); guruhlarim — faqat tanlaganidan", async () => {
  const yuk = { ok: true, postType: "yuk_bor", loads: [LOAD] };
  const { store, deps, raw, delivered, post } = rawSetup({ [LOAD_TEXT]: yuk });
  deps.sortingOff = true;
  deps.requireContact = true;
  deps.rules = (text) => (text === LOAD_TEXT ? yuk : null);
  post("@g", 1, LOAD_TEXT);
  post("@g", 2, FAR_TEXT);
  post("@g", 3, CHAT_TEXT);
  post("@g", 4, "Toshkentdan Buxoroga yuk bor, isuzu kerak, lichkaga yozing");
  post("@yuk_guruh2", 5, LOAD_TEXT.replace("0001", "0009"));
  post("@g", 6, LOAD_TEXT.replace("0001", "0008"), Date.now() - 40 * 60_000); // eski — yo'q
  await createWorker(deps, { log: () => {} }).runOnce();
  const got = raw.map(([chatId, id]) => `${id}→${chatId}`).sort();
  // 1, 2 — saralangan rejimdagilar ham hamma guruhdan oladi (3 — faol emas); 7 tezkor, 9 «+saralangan» — hamma guruhdan; 8 guruhlarim — faqat @yuk_guruh2
  // 3 — salomlashish: joy ham, yuk belgisi ham yo'q — «quruq gap», telefon bo'lsa ham hech kimga (2026-11-19)
  const want = [];
  for (const id of [1, 2, 4]) for (const c of [1, 2, 7, 9]) want.push(`${id}→${c}`);
  for (const c of [1, 2, 7, 8, 9]) want.push(`5→${c}`);
  assert.deepEqual(got, want.sort());
  assert.deepEqual(delivered, [], "saralangan (AI / qoidalar) nusxasi hech kimga ketmaydi");
  assert.ok(store.takeNewPosts().every((p) => p.messageId !== 4), "aloqasiz e'lon yuborilgach AI'ga bormasdan yopildi");
});

test("sortingOff: yuk beruvchining o'z yuki — hammaga saralanmasdan («📌 Mening guruhlarim» dan tashqari, avvalgidek)", async () => {
  const { store, deps, delivered } = rawSetup();
  deps.sortingOff = true;
  deps.pool = noAi;
  store.addDirectPost({ chatId: 500, text: "Toshkent → Samarqand, un 20 t +998900000001", loads: [{ ...LOAD, phones: ["+998900000001"] }], via: "bot" });
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual([...new Set(delivered)].sort(), [1, 2, 7, 9]);
});

test("sortingOff + eski «hududim» profil (endi «📍 Qayerdan» filtri): tanlagan viloyatidan ketadigan va joyi aniqlanmagan e'lonlar keladi, boshqasi yo'q", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.sortingOff = true;
  deps.pool = noAi;
  store.saveDriver(10, { role: "haydovchi", active: true, profile: { ...RAW_BASE, feed: { mode: "hududim", sources: [], regions: ["samarqand"] } } });
  post("@g", 1, "Samarqanddan Toshkentga 20 tonna un bor, tent kerak +998900000011");
  post("@g", 2, "Andijondan Buxoroga 10 tonna yuk bor, isuzu kerak +998900000012");
  post("@g", 3, CHAT_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  post("@g", 4, "Namanganga 3 tonna yuk bor +998900000014"); // qayerdan aytilmagan — hammaga
  post("@g", 5, "Hasanboydan Buxoroga 5 tonna piyoz bor +998900000015"); // qayerdan aytilgan, lekin biz bilmaydigan joy — viloyat tanlaganga yo'q
  post("@g", 6, "Наманган - Мурино г. 15 тонна текстиль, реф керак +998900000016"); // strelkasiz «A - B»: chapi — qayerdan
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(raw.filter(([c]) => c === 10).map(([, id]) => id).sort(), [1, 4]);
  assert.deepEqual(raw.filter(([c]) => c === 7).map(([, id]) => id).sort(), [1, 2, 4, 5, 6], "filtrsiz — quruq gapdan (3) boshqa hammasi");
});

test("sortingOff + filtrlar (2026-11-19): quruq gap hech kimga; «🚚 Transport» — tanlagan turi va mashinasi yozilmagan e'lon", async () => {
  const { store, deps, raw, post } = rawSetup();
  deps.sortingOff = true;
  deps.pool = noAi;
  store.saveDriver(10, { role: "haydovchi", active: true, profile: { ...RAW_BASE, feed: { mode: "tezkor", sources: [], trucks: ["isuzu"] } } });
  store.saveDriver(11, { role: "haydovchi", active: true, profile: { ...RAW_BASE, feed: { mode: "tezkor", sources: [], trucks: ["fura"], regions: ["andijon"] } } });
  post("@g", 1, "Samarqanddan Toshkentga 20 tonna un bor, tent fura kerak +998900000011");
  post("@g", 2, "Andijondan Buxoroga 5 tonna yuk bor, isuzu kerak +998900000012");
  post("@g", 3, "Andijondan Toshkentga yuk bor +998900000013"); // mashina yozilmagan
  post("@g", 4, "Clik borlar lichga💋"); // quruq gap: na telefon, na joy
  post("@g", 5, "Ali, kechirasiz, bu guruhda yozish uchun Targo.uz kanali va guruhiga obuna bo'ling");
  await createWorker(deps, { log: () => {} }).runOnce();
  const got = (chat) => raw.filter(([c]) => c === chat).map(([, id]) => id).sort();
  assert.deepEqual(got(10), [2, 3]);
  assert.deepEqual(got(11), [3], "fura + Andijon: 1 — Samarqanddan, 2 — isuzu");
  assert.deepEqual(got(7), [1, 2, 3], "filtrsiz — quruq gapdan boshqa hammasi");
});

test("deps.held: sozlash oynasi ochiq haydovchiga tezkor e'lon yuborilmaydi, boshqalarga — ha", async () => {
  const { deps, raw, post } = rawSetup();
  deps.sortingOff = true;
  deps.pool = noAi;
  deps.held = (chatId) => chatId === 7;
  post("@g", 1, LOAD_TEXT);
  await createWorker(deps, { log: () => {} }).runOnce();
  const got = raw.map(([c]) => c);
  assert.ok(!got.includes(7), "band — yo'q");
  assert.ok(got.includes(1) && got.includes(9));
});

test("tezkor navbat (2026-11-19 tiket): navbatda turganda pauza bosilsa — qolganlari yuborilmaydi; haydovchilar bir-birini kutmaydi", async () => {
  const { store, deps, post } = rawSetup();
  deps.sortingOff = true;
  deps.pool = noAi;
  const sent = [];
  deps.deliverRaw = async (chatId, p) => {
    if (chatId === 7) {
      await new Promise((r) => setTimeout(r, 60)); // sekin chat
      if (p.messageId === 1) store.saveDriver(7, { active: false, why: "user" }); // birinchisi ketayotganda pauza bosdi
    }
    sent.push([chatId, p.messageId, Date.now()]);
    return { ok: true };
  };
  post("@g", 1, LOAD_TEXT);
  post("@g", 2, LOAD_TEXT.replace("0001", "0021"));
  post("@g", 3, LOAD_TEXT.replace("0001", "0031"));
  const started = Date.now();
  await createWorker(deps, { log: () => {} }).runOnce();
  assert.deepEqual(sent.filter(([c]) => c === 7).map(([, id]) => id), [1], "pauzadan keyin — yo'q");
  assert.deepEqual(sent.filter(([c]) => c === 1).map(([, id]) => id), [1, 2, 3]);
  // Boshqa haydovchining 3 ta e'loni sekin chatni kutmagan
  assert.ok(Math.max(...sent.filter(([c]) => c === 1).map(([, , t]) => t)) - started < 50, "1-haydovchi 7-ni kutmadi");
});
