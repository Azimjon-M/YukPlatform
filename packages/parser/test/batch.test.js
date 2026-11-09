// Batch: bir so'rovda bir nechta e'lon. Haqiqiy API chaqirilmaydi — soxta Gemini client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { formatBatch, readBatchAnswer } from "../src/batch.js";
import { createParser, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_WAIT_SEC, DEFAULT_LIVE_WAIT_SEC, resolveSettings } from "../src/parse.js";
import { BATCH_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../src/prompt.js";
import { BATCH_SCHEMA, LOAD_PROPERTIES, POST_SCHEMA } from "../src/schema.js";

// Sxemadagi hamma maydon null/bo'sh, faqat berilganlari to'ldirilgan yuk
const load = (fields) => ({
  ...Object.fromEntries(Object.keys(LOAD_PROPERTIES).map((k) => [k, null])),
  category: "fura",
  loadingSides: [],
  partial: false,
  negotiable: false,
  ...fields,
});
const TOSH_SAM = load({ fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand" });
const AND_NAV = load({ fromCity: "Andijon", fromRegion: "andijon", toCity: "Navoiy", toRegion: "navoiy" });

const POSTS = [
  "Toshkentdan Samarqandga fura kerak 90 111 22 33",
  "Reklama: kanalimizga obuna bo'ling",
  "Andijondan Navoiyga isuzu kerak +998 93 444 55 66",
];

// Gemini javobi: matn yoki xato. answers — har bir so'rovga navbatdagi javob
function fakeGemini(answers) {
  const calls = [];
  const queue = [...answers];
  const generateContent = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "object") return next; // to'liq javob (masalan, bloklangan)
    return { text: next, modelVersion: "gemini-x", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } };
  };
  return { calls, models: { generateContent } };
}
const batchJson = (posts) => JSON.stringify({ posts });
const singleJson = (postType, loads = []) => JSON.stringify({ postType, loads });
const parserWith = (answers) => {
  const client = fakeGemini(answers);
  return { client, parser: createParser({ provider: "gemini", model: "gemini-test", client }) };
};

// --- so'rov matni va javobni taqsimlash (AI'siz) ---

test("formatBatch: har bir e'lon raqamli sarlavha bilan", () => {
  assert.equal(formatBatch(["  birinchi\n", "ikkinchi"]), "=== POST 1 ===\nbirinchi\n\n=== POST 2 ===\nikkinchi");
});

test("readBatchAnswer: javob tartibi aralash bo'lsa ham raqami bo'yicha taqsimlanadi", () => {
  const { items, problem } = readBatchAnswer(
    batchJson([
      { id: 3, postType: "yuk_bor", loads: [AND_NAV] },
      { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
      { id: 2, postType: "boshqa", loads: [] },
    ]),
    3,
  );
  assert.equal(problem, null);
  assert.deepEqual(items.map((i) => i.loads[0]?.fromCity ?? i.postType), ["Toshkent", "boshqa", "Andijon"]);
});

test("readBatchAnswer: yaroqsiz javobda hech bir e'longa natija berilmaydi", () => {
  const ok = (id) => ({ id, postType: "boshqa", loads: [] });
  const cases = {
    "{buzuq": /JSON/,
    '{"items": []}': /posts/,
    [batchJson([ok(1), ok(2)])]: /yo'q: 3/,
    [batchJson([ok(1), ok(2), ok(2)])]: /ikki marta/,
    [batchJson([ok(0), ok(1), ok(2)])]: /noma'lum raqam/,
    [batchJson([ok(1), ok(2), ok(3), ok(4)])]: /noma'lum raqam/,
    [batchJson([ok(1), ok("2"), ok(3)])]: /noma'lum raqam/,
    [batchJson([ok(1), { id: 2, postType: "yuk_bor" }, ok(3)])]: /to'liq emas/,
  };
  for (const [json, expected] of Object.entries(cases)) {
    const { items, problem } = readBatchAnswer(json, 3);
    assert.match(problem, expected, json);
    assert.deepEqual(items, [null, null, null], json);
  }
});

test("batch ko'rsatmasi oddiy ko'rsatma bilan boshlanadi (kesh) va sarlavhani tushuntiradi", () => {
  assert.ok(BATCH_SYSTEM_PROMPT.startsWith(SYSTEM_PROMPT));
  assert.ok(BATCH_SYSTEM_PROMPT.includes("=== POST <n> ==="));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(BATCH_SYSTEM_PROMPT));
  assert.deepEqual(BATCH_SCHEMA.properties.posts.items.required, ["id", "postType", "loads"]);
});

test("PARSER_BATCH va PARSER_BATCH_WAIT: .env dan o'qiladi, noto'g'ri qiymatda standart", () => {
  const saved = { ...process.env };
  try {
    process.env.PARSER_BATCH = "5";
    process.env.PARSER_BATCH_WAIT = "120";
    assert.equal(resolveSettings().batchSize, 5);
    assert.equal(resolveSettings().batchWaitMs, 120_000);
    assert.equal(resolveSettings({ batchSize: "1" }).batchSize, 1);
    process.env.PARSER_BATCH_WAIT = "0";
    assert.equal(resolveSettings().batchWaitMs, 0, "0 — kutmaslik");
    for (const bad of ["abc", "", "0", "-3"]) {
      process.env.PARSER_BATCH = bad;
      assert.equal(resolveSettings().batchSize, DEFAULT_BATCH_SIZE, JSON.stringify(bad));
    }
    process.env.PARSER_BATCH_WAIT = "";
    assert.equal(resolveSettings().batchWaitMs, DEFAULT_BATCH_WAIT_SEC * 1000);
    // Jonli e'lonlar uchun alohida kutish
    delete process.env.PARSER_LIVE_WAIT;
    assert.equal(resolveSettings().liveWaitMs, DEFAULT_LIVE_WAIT_SEC * 1000);
    process.env.PARSER_LIVE_WAIT = "15";
    assert.equal(resolveSettings().liveWaitMs, 15_000);
  } finally {
    process.env = saved;
  }
});

// --- parseBatch ---

test("parseBatch: bitta so'rov, telefonlar yashirilgan, batch ko'rsatmasi va sxemasi", async () => {
  const { client, parser } = parserWith([
    batchJson([
      { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
      { id: 2, postType: "boshqa", loads: [] },
      { id: 3, postType: "yuk_bor", loads: [AND_NAV] },
    ]),
  ]);
  await parser.parseBatch(POSTS);
  assert.equal(client.calls.length, 1);
  const req = client.calls[0];
  assert.equal(req.config.systemInstruction, BATCH_SYSTEM_PROMPT);
  assert.equal(req.config.responseJsonSchema, BATCH_SCHEMA);
  assert.match(req.contents, /^=== POST 1 ===\nToshkentdan Samarqandga fura kerak \[telefon\]\n\n=== POST 2 ===/);
  assert.match(req.contents, /=== POST 3 ===\nAndijondan Navoiyga isuzu kerak \[telefon\]$/);
  assert.ok(!/\d{2} \d{3} \d{2} \d{2}/.test(req.contents), "AI'ga telefon raqami yuborilmaydi");
});

test("parseBatch: javob o'z e'loniga qaytadi, telefon o'sha e'londan olinadi", async () => {
  // Model e'lonlarni teskari tartibda qaytardi — natija baribir e'lonlar tartibida
  const { parser } = parserWith([
    batchJson([
      { id: 3, postType: "yuk_bor", loads: [AND_NAV] },
      { id: 2, postType: "boshqa", loads: [] },
      { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
    ]),
  ]);
  const results = await parser.parseBatch(POSTS);
  assert.equal(results.length, 3);
  assert.equal(results[0].loads[0].fromCity, "Toshkent");
  assert.deepEqual(results[0].loads[0].phones, ["+998901112233"]);
  assert.equal(results[1].postType, "boshqa");
  assert.deepEqual(results[1].phones, []);
  assert.equal(results[2].loads[0].fromCity, "Andijon");
  assert.deepEqual(results[2].loads[0].phones, ["+998934445566"]);
  assert.equal(results[2].loads[0].category, "fura", "kod qoidalari batch'da ham ishlaydi");
  assert.ok(results.every((r) => r.ok && r.batch === 3 && !r.fallback));
  assert.deepEqual(results[0].usage, { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
  assert.equal(results[1].usage, null, "tokenlar bir marta sanaladi");
});

test("parseBatch: buzuq JSON — guruh ikkiga bo'linib qayta yuboriladi (limitni tejash)", async () => {
  const { client, parser } = parserWith([
    "{buzuq",
    batchJson([
      { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
      { id: 2, postType: "boshqa", loads: [] },
    ]),
    singleJson("yuk_bor", [AND_NAV]),
  ]);
  const results = await parser.parseBatch(POSTS);
  assert.equal(client.calls.length, 3, "3 ta → (2 ta) + (1 ta)");
  assert.equal(client.calls[1].config.systemInstruction, BATCH_SYSTEM_PROMPT);
  assert.match(client.calls[1].contents, /=== POST 2 ===\nReklama/);
  assert.ok(!client.calls[1].contents.includes("POST 3"));
  assert.equal(client.calls[2].config.systemInstruction, SYSTEM_PROMPT, "oxirgi bitta e'lon — oddiy so'rov");
  assert.equal(client.calls[2].config.responseJsonSchema, POST_SCHEMA);
  assert.equal(client.calls[2].contents, "Andijondan Navoiyga isuzu kerak [telefon]");
  assert.deepEqual(results.map((r) => r.postType), ["yuk_bor", "boshqa", "yuk_bor"]);
  assert.deepEqual(results[0].loads[0].phones, ["+998901112233"]);
  assert.deepEqual(results[2].loads[0].phones, ["+998934445566"]);
  assert.ok(results.every((r) => r.ok && /JSON/.test(r.fallback)));
});

test("parseBatch: e'lon tushib qolsa, javob uzilsa yoki bloklansa — bo'lib qayta", async () => {
  const half = batchJson([
    { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
    { id: 3, postType: "yuk_bor", loads: [AND_NAV] },
  ]);
  const cut = { text: '{"posts":[', candidates: [{ finishReason: "MAX_TOKENS" }] };
  const blocked = { promptFeedback: { blockReason: "SAFETY" } };
  const firstTwo = batchJson([
    { id: 2, postType: "boshqa", loads: [] },
    { id: 1, postType: "yuk_bor", loads: [TOSH_SAM] },
  ]);
  for (const [answer, reason] of [[half, /yo'q: 2/], [cut, /MAX_TOKENS/], [blocked, /SAFETY/]]) {
    const { client, parser } = parserWith([answer, firstTwo, singleJson("yuk_bor", [AND_NAV])]);
    const results = await parser.parseBatch(POSTS);
    assert.equal(client.calls.length, 3);
    assert.deepEqual(results.map((r) => r.postType), ["yuk_bor", "boshqa", "yuk_bor"]);
    assert.ok(results.every((r) => reason.test(r.fallback)), String(reason));
  }
});

test("parseBatch: bitta yomon e'lon oxiri bittadan qoladi, qolganlari baribir tahlil qilinadi", async () => {
  const blocked = { promptFeedback: { blockReason: "SAFETY" } };
  // 3 ta (blok) → 2 ta (blok) → 1-e'lon OK, 2-e'lon blok; 3-e'lon OK
  const { client, parser } = parserWith([blocked, blocked, singleJson("yuk_bor", [TOSH_SAM]), blocked, singleJson("yuk_bor", [AND_NAV])]);
  const results = await parser.parseBatch(POSTS);
  assert.equal(client.calls.length, 5);
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.match(results[1].error, /SAFETY/);
  assert.deepEqual(results[2].loads[0].phones, ["+998934445566"]);
});

test("parseBatch: limit (429) bo'lsa xato tashlanadi — bo'lib yuborib limitni yemaydi", async () => {
  const limit = new ApiError({ status: 429, message: "Resource exhausted" });
  const { client, parser } = parserWith([limit]);
  await assert.rejects(parser.parseBatch(POSTS), (e) => e === limit);
  assert.equal(client.calls.length, 1);

  // Bo'lib qayta yuborish paytida limit tugasa ham — xato chaqiruvchiga (worker kutadi, e'lonlar navbatda qoladi)
  const second = parserWith(["{buzuq", limit]);
  await assert.rejects(second.parser.parseBatch(POSTS), (e) => e === limit);
  const third = parserWith(["{buzuq", "{buzuq", singleJson("boshqa"), limit]);
  await assert.rejects(third.parser.parseBatch(POSTS), (e) => e === limit);
});

test("parseBatch: boshqa xatoda bo'lib qayta; bittasi yiqilsa faqat o'sha e'lon xato", async () => {
  const internal = new ApiError({ status: 500, message: "Internal" });
  // 3 ta (500) → 2 ta (tarmoq) → 1-e'lon OK, 2-e'lon tarmoq xatosi; 3-e'lon OK
  const { client, parser } = parserWith([
    internal,
    new Error("tarmoq"),
    singleJson("yuk_bor", [TOSH_SAM]),
    new Error("tarmoq"),
    singleJson("yuk_bor", [AND_NAV]),
  ]);
  const results = await parser.parseBatch(POSTS);
  assert.equal(client.calls.length, 5);
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.equal(results[1].error, "tarmoq");
  assert.ok(results.every((r) => /500/.test(r.fallback)), "sabab — birinchi (katta) guruhniki");
});

test("parseBatch: bitta e'lon — oddiy so'rov, bo'sh ro'yxat — so'rovsiz", async () => {
  const { client, parser } = parserWith([singleJson("yuk_bor", [TOSH_SAM])]);
  const [result] = await parser.parseBatch([POSTS[0]]);
  assert.equal(client.calls[0].config.systemInstruction, SYSTEM_PROMPT);
  assert.equal(client.calls[0].contents, "Toshkentdan Samarqandga fura kerak [telefon]");
  assert.equal(result.ok, true);
  assert.equal(result.batch, undefined);
  assert.deepEqual(await parser.parseBatch([]), []);
  assert.equal(client.calls.length, 1);
});
