// OpenAI-mos provayder (1pro.uz) — soxta fetch bilan, internetsiz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser } from "../src/parse.js";
import { pauseFor } from "../src/pool.js";
import { envSeedEntries, getProvider } from "../src/providers/index.js";
import { ApiHttpError, extractJson, nextTashkentMidnight, onepro } from "../src/providers/openaiCompat.js";
import { conformLoad, conformPost, LOAD_PROPERTIES } from "../src/schema.js";

const POST = "Тошкентдан Самарқандга 20 тонна ун, тент фура 90 123 45 67";

// Soxta fetch: javoblar navbat bilan qaytadi; har bir so'rov calls ga yoziladi
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, headers = {} } = next;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };
  return { fetch, calls };
}

const answer = (content, extra = {}) => ({
  body: {
    model: "qwen3.8-flash-next-iq3_s",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5836, completion_tokens: 165, prompt_tokens_details: { cached_tokens: 5829 } },
    ...extra,
  },
});

function client(fake, options = {}) {
  const waits = [];
  return { waits, client: onepro.createClient({ apiKey: "sk-sinov", fetch: fake.fetch, sleep: async (ms) => waits.push(ms), ...options }) };
}

test("1pro: so'rov shakli, JSON ```...``` ichida kelsa ham o'qiladi, token sarfi", async () => {
  const fake = fakeFetch(answer('```json\n{"postType":"yuk_bor","loads":[{"fromCity":"Toshkent","toCity":"Samarqand","weightT":20}]}\n```'));
  const { client: c } = client(fake);
  const result = await onepro.generate(c, { text: "matn", model: "qwen3.8-flash", system: "ko'rsatma", schema: { type: "object" } });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.json).loads[0].toCity, "Samarqand");
  assert.equal(result.model, "qwen3.8-flash-next-iq3_s");
  assert.deepEqual(result.usage, { input: 7, output: 165, cacheRead: 5829, cacheWrite: 0 });

  const [call] = fake.calls;
  assert.equal(call.url, "https://1pro.uz/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, "Bearer sk-sinov");
  assert.equal(call.body.model, "qwen3.8-flash");
  assert.deepEqual(call.body.messages, [
    { role: "system", content: "ko'rsatma" },
    { role: "user", content: "matn" },
  ]);
  assert.equal(call.body.response_format.type, "json_schema");
  assert.deepEqual(call.body.response_format.json_schema.schema, { type: "object" });
  assert.ok(call.body.max_tokens > 0, "javob uzunligi cheklangan");
});

test("1pro: ONEPRO_BASE_URL boshqa manzilga yo'naltiradi", async () => {
  const fake = fakeFetch(answer("{}"));
  const saved = process.env.ONEPRO_BASE_URL;
  process.env.ONEPRO_BASE_URL = "https://boshqa.uz/v1/";
  try {
    const { client: c } = client(fake);
    await onepro.generate(c, { text: "x", model: "m" });
  } finally {
    if (saved === undefined) delete process.env.ONEPRO_BASE_URL;
    else process.env.ONEPRO_BASE_URL = saved;
  }
  assert.equal(fake.calls[0].url, "https://boshqa.uz/v1/chat/completions");
});

test("1pro: sxemani majburlamagani uchun javob sxemaga moslanadi (tushgan maydonlar, noto'g'ri qiymatlar)", async () => {
  // 2026-11-06 dagi haqiqiy javobga o'xshash: bo'sh maydonlar yo'q, viloyat noto'g'ri, kuzov katta harfda
  const content = JSON.stringify({
    postType: "yuk_bor",
    loads: [{ fromCity: "Toshkent", fromRegion: "Toshkent", toCity: "Samarqand", weightT: "20", bodyType: "Tent", truckClass: "fura", extra: 1 }],
  });
  const fake = fakeFetch(answer(content));
  const parser = createParser({ provider: "onepro", model: "qwen3.8-flash", client: client(fake).client });
  const result = await parser.parse(POST);
  assert.equal(result.ok, true);
  const [load] = result.loads;
  assert.deepEqual(Object.keys(load).sort(), [...Object.keys(LOAD_PROPERTIES), "phones"].sort());
  assert.equal(load.fromRegion, "toshkent_sh", "shahar ro'yxatidan to'g'rilandi");
  assert.equal(load.toRegion, "samarqand");
  assert.equal(load.weightT, 20);
  assert.equal(load.bodyType, "tent");
  assert.deepEqual(load.loadingSides, []);
  assert.equal(load.partial, false);
  assert.equal(load.price, null);
  assert.equal(load.category, "fura");
  assert.deepEqual(load.phones, ["+998901234567"]);
  assert.ok(!fake.calls[0].body.messages[1].content.includes("123 45 67"), "telefon AI'ga yuborilmaydi");
});

test("conformLoad / conformPost: Gemini'ning to'liq javobi o'zgarmaydi, buzuqlari tozalanadi", () => {
  const full = conformLoad({ fromCity: " Andijon ", weightT: 20, pallets: 33.4, loadingSides: ["orqa", "tom", "orqa"], note: "", priceUnit: "TONNA" });
  assert.equal(full.fromCity, "Andijon");
  assert.equal(full.pallets, 33);
  assert.deepEqual(full.loadingSides, ["orqa"], "ro'yxatda yo'q va takror tushdi");
  assert.equal(full.note, null, "bo'sh matn → null");
  assert.equal(full.priceUnit, "tonna");
  assert.deepEqual(conformPost({ postType: "nimadir", loads: "yo'q" }), { postType: "boshqa", loads: [] });
  assert.deepEqual(conformPost({ postType: "mashina_bor", loads: [null, 5] }), { postType: "mashina_bor", loads: [] });
  const again = conformLoad(full);
  assert.deepEqual(again, full, "ikki marta o'tkazilsa ham o'zgarmaydi");
});

test("1pro: kunlik limit (429) — qayta urinilmaydi, Retry-After gacha dam oladi", async () => {
  const fake = fakeFetch({ status: 429, body: { error: { message: "Kunlik limit tugadi" } }, headers: { "Retry-After": "3600" } });
  const { client: c, waits } = client(fake);
  const error = await onepro.generate(c, { text: "x", model: "m" }).catch((e) => e);
  assert.ok(error instanceof ApiHttpError);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(waits, []);
  assert.equal(onepro.isDailyLimit(error), true);
  assert.equal(onepro.retryAfterMs(error), null);
  assert.equal(onepro.isFatal(error), true);
  assert.match(onepro.describeError(error), /bugungi limit/);
  const now = Date.UTC(2026, 10, 6, 10, 0);
  assert.deepEqual(pauseFor(onepro, error, now), { ms: 3_600_000, reason: "daily", resetAt: now + 3_600_000 });
  // Retry-After bo'lmasa — Toshkent yarim tunigacha (UTC 19:00)
  const noHeader = new ApiHttpError(429, "Kunlik limit tugadi");
  assert.deepEqual(pauseFor(onepro, noHeader, now), { ms: 9 * 3_600_000, reason: "daily", resetAt: now + 9 * 3_600_000 });
});

test("1pro: daqiqalik 429 va 503 — kutib qayta urinadi, oxiri xato", async () => {
  const fake = fakeFetch({ status: 429, body: { error: { message: "Too many requests" } }, headers: { "Retry-After": "5" } }, { status: 503, body: "band" }, answer('{"postType":"boshqa","loads":[]}'));
  const { client: c, waits } = client(fake);
  const result = await onepro.generate(c, { text: "x", model: "m" });
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [5000, 6000], "Retry-After 5 s, keyin 3·2 s");

  const down = fakeFetch({ status: 502, body: "Bad gateway" }, { status: 502, body: "Bad gateway" });
  const error = await onepro.generate(client(down, { attempts: 2 }).client, { text: "x", model: "m" }).catch((e) => e);
  assert.equal(error.status, 502);
  assert.equal(down.calls.length, 2);
  assert.equal(pauseFor(onepro, error).reason, "busy");
});

test("1pro: tarmoq xatosi — 'network' (30 s, model aybdor emas), kalit xatosi — 'key'", async () => {
  const fake = fakeFetch(new TypeError("fetch failed"));
  const error = await onepro.generate(client(fake, { attempts: 1 }).client, { text: "x", model: "m" }).catch((e) => e);
  assert.equal(error.status, 503);
  assert.match(onepro.describeError(error), /aloqa yo'q/);
  assert.equal(pauseFor(onepro, error).reason, "network");

  const bad = fakeFetch({ status: 401, body: { error: { message: "Invalid API key" } } });
  const keyError = await onepro.generate(client(bad).client, { text: "x", model: "m" }).catch((e) => e);
  assert.equal(bad.calls.length, 1, "kalit xatosida qayta urinmaydi");
  assert.equal(pauseFor(onepro, keyError).reason, "key");
});

test("1pro: javob uzilsa (length) yoki JSON bo'lmasa — ok: false", async () => {
  const cut = fakeFetch({ body: { choices: [{ message: { content: '{"posts":[' }, finish_reason: "length" }] } });
  assert.match((await onepro.generate(client(cut).client, { text: "x", model: "m" })).error, /uzilib/);
  const empty = fakeFetch(answer("<think>o'ylayapman</think>Kechirasiz"));
  assert.match((await onepro.generate(client(empty).client, { text: "x", model: "m" })).error, /JSON yo'q/);
  assert.equal(extractJson('<think>{"a":1}</think>\n{"b":2}'), '{"b":2}');
});

test("1pro: modellar ro'yxati — faqat matn modellari, internet-qidiruvsiz", async () => {
  const fake = fakeFetch({
    body: {
      data: [
        { id: "whisper-uzbek", capabilities: ["stt"], model_type: "speech" },
        { id: "qwen3.8-flash", capabilities: ["text", "tools", "thinking"], model_type: "llm" },
        { id: "qwen3.8-flash:online", capabilities: ["text", "web_search"], model_type: "llm" },
      ],
    },
  });
  assert.deepEqual(await onepro.listModels(client(fake).client), ["qwen3.8-flash"]);
  assert.equal(fake.calls[0].url, "https://1pro.uz/v1/models");
});

test("1pro: guruh 6 tadan oshmaydi (javob 100 s ga sig'sin), 524 da qayta urinmaydi — guruh bo'linadi", async () => {
  assert.equal(createParser({ provider: "onepro", client: {} }).batchSize, 6);
  assert.equal(createParser({ provider: "onepro", client: {}, batchSize: 10 }).batchSize, 10, "CLI --batch 10 — o'zgarmaydi");
  assert.equal(createParser({ provider: "gemini", client: {} }).batchSize, 10);

  // 4 ta e'lon: birinchi so'rov 524 → 2 + 2 bo'lib yuboriladi (xuddi shu 4 talik so'rov qaytarilmaydi)
  const two = () => answer(JSON.stringify({ posts: [{ id: 1, postType: "boshqa", loads: [] }, { id: 2, postType: "boshqa", loads: [] }] }));
  const fake = fakeFetch({ status: 524, body: "A timeout occurred" }, two(), two());
  const parser = createParser({ provider: "onepro", client: client(fake).client });
  const results = await parser.parseBatch(["bir", "ikki", "uch", "to'rt"]);
  assert.equal(fake.calls.length, 3);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.ok && /524/.test(r.fallback)));
  assert.equal(onepro.isFatal(new ApiHttpError(524, "timeout")), false);
});

test("Toshkent yarim tuni va .env dan qo'shiladigan provayderlar", () => {
  assert.equal(nextTashkentMidnight(Date.UTC(2026, 10, 6, 18, 59)), Date.UTC(2026, 10, 6, 19, 0));
  assert.equal(nextTashkentMidnight(Date.UTC(2026, 10, 6, 19, 0)), Date.UTC(2026, 10, 7, 19, 0));
  const entries = envSeedEntries({ provider: getProvider("gemini"), model: "gemini-flash-lite-latest" });
  assert.deepEqual(entries, [
    { provider: "gemini", models: ["gemini-flash-lite-latest"] },
    { provider: "onepro", models: ["qwen3.8-flash"] },
  ]);
  assert.ok(!entries.some((e) => e.provider === "claude"), "pullik Claude o'zi qo'shilmaydi");
});
