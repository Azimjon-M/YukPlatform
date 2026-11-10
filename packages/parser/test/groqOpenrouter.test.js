// Groq va OpenRouter (bepul) — soxta fetch bilan, internetsiz.
// Javoblar va xato matnlari 2026-11-09 dagi haqiqiy javoblarga o'xshatib yozilgan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser } from "../src/parse.js";
import { BATCH_SCHEMA } from "../src/schema.js";
import { pauseFor } from "../src/pool.js";
import { ApiHttpError, groq, nextUtcMidnight, openrouter, parseDuration } from "../src/providers/openaiCompat.js";
import { envSeedEntries, getProvider } from "../src/providers/index.js";

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
  body: { model: "openai/gpt-oss-120b", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 6600, completion_tokens: 320 }, ...extra },
});
const posts = (n) => answer(JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ id: i + 1, postType: "boshqa", loads: [] })) }));
const make = (provider, fake, options = {}) => provider.createClient({ apiKey: "sinov-kalit", fetch: fake.fetch, sleep: async () => {}, ...options });

// Groq'ning haqiqiy xato matnlari (tashkilot raqami olib tashlangan)
const groqError = (status, text, headers = {}) => ({ status, body: { error: { message: text, type: "tokens", code: "rate_limit_exceeded" } }, headers });
const TOO_LARGE = "Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8054, please reduce your message size and try again.";
const TPM = "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7400, Requested 1500. Please try again in 6.75s.";
const TPD = "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199100, Requested 1500. Please try again in 10m48.5s.";

test("parseDuration: Groq vaqt yozuvlari", () => {
  assert.equal(parseDuration("7.66s"), 7660);
  assert.equal(parseDuration("2m59.56s"), 179_560);
  assert.equal(parseDuration("1h2m3s"), 3_723_000);
  assert.equal(parseDuration("450ms"), 450);
  assert.equal(parseDuration("12"), 12_000, "faqat son — soniya");
  assert.equal(parseDuration("ertaga"), null);
  assert.equal(parseDuration(undefined), null);
});

test("Groq: so'rov shakli — manzil, o'ylash darajasi, qisqa JSON (sxemasiz), max_tokens e'lonlar soniga qarab", async () => {
  const fake = fakeFetch(answer('{"postType":"yuk_bor","loads":[]}'), posts(3));
  const c = make(groq, fake);
  await groq.generate(c, { text: "x", model: "openai/gpt-oss-120b" });
  await groq.generate(c, { text: "x", model: "openai/gpt-oss-120b", posts: 3, schema: BATCH_SCHEMA });
  const [one, three] = fake.calls;
  assert.equal(one.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(one.init.headers.Authorization, "Bearer sinov-kalit");
  assert.equal(one.body.reasoning_effort, "low");
  assert.equal(one.body.include_reasoning, false);
  // Sxema yuborilmaydi (~900 token), maydon nomlari ko'rsatma oxirida; batch'da "posts" shakli
  assert.deepEqual(one.body.response_format, { type: "json_object" });
  assert.match(one.body.messages[0].content, /## Output format[\s\S]*Load fields[\s\S]*weightT/);
  assert.match(one.body.messages[0].content, /^You extract structured data/, "ko'rsatma boshi o'zgarmaydi (kesh)");
  assert.ok(!/"posts"/.test(one.body.messages[0].content.split("## Output format")[1]));
  assert.match(three.body.messages[0].content.split("## Output format")[1], /"posts"/);
  assert.ok(one.body.max_tokens < three.body.max_tokens, "3 ta e'longa ko'proq joy");
  assert.ok(one.body.max_tokens <= 1000, "bitta e'lon: ko'rsatma (~6 100) + javob 8 000 TPM ga sig'sin");

  // Qwen'da o'ylash o'chiriladi
  const qwen = fakeFetch(answer("{}"));
  await groq.generate(make(groq, qwen), { text: "x", model: "qwen/qwen3.8-27b" });
  assert.equal(qwen.calls[0].body.reasoning_effort, "none");
});

test("Qisqa javob: yozilmagan maydonlar null / false / [] bo'ladi, shahar ro'yxatdan to'g'rilanadi", async () => {
  const content = JSON.stringify({ posts: [{ id: 1, postType: "yuk_bor", loads: [{ fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, bodyType: "tent" }] }, { id: 2, postType: "boshqa", loads: [] }] });
  const fake = fakeFetch(answer(content));
  const parser = createParser({ provider: "groq", model: "openai/gpt-oss-120b", client: make(groq, fake) });
  const [first, second] = await parser.parseBatch(["Тошкентдан Самарқандга 20 т тент 90 123 45 67", "salom"]);
  assert.equal(first.ok, true);
  const [load] = first.loads;
  assert.deepEqual([load.fromRegion, load.toRegion, load.weightT, load.bodyType, load.price, load.partial, load.category], ["toshkent_sh", "samarqand", 20, "tent", null, false, "fura"]);
  assert.deepEqual(load.loadingSides, []);
  assert.deepEqual(load.phones, ["+998901234567"]);
  assert.deepEqual([second.ok, second.postType, second.loads], [true, "boshqa", []]);
});

test("Groq: 413 (so'rov TPM ga sig'madi) — bot pool'ida ham guruh shu ulanishda bo'linadi, ulanish aybdor emas", async () => {
  const fake = fakeFetch(groqError(413, TOO_LARGE, { "retry-after": "1" }), posts(2), posts(1));
  // splitOnError: false — bot pool'i kabi (boshqa xatolarda guruh ishchiga qaytadi)
  const parser = createParser({ provider: "groq", model: "openai/gpt-oss-20b", client: make(groq, fake, { attempts: 1 }), splitOnError: false });
  const results = await parser.parseBatch(["bir", "ikki", "uch"]);
  assert.equal(fake.calls.length, 3, "3 → 2 + 1");
  assert.ok(results.every((r) => r.ok && /413/.test(r.fallback)));
  assert.deepEqual(fake.calls.map((c) => c.body.max_tokens), [700 + 250 * 3, 700 + 250 * 2, 700 + 250]);

  const error = new ApiHttpError(413, TOO_LARGE);
  assert.equal(groq.isTooLarge(error), true);
  assert.equal(groq.isFatal(error), false);
  assert.equal(groq.isDailyLimit(error), false, "matnda 'per minute' — kunlik emas");
  assert.match(groq.describeError(error), /kichraytiriladi/);
  // Bitta e'lon sig'madi (bot pool'i): xato emas, «size» — e'lon boshqa ulanishga, bu ulanish «muammoli» bo'lmaydi
  assert.deepEqual(pauseFor(groq, error), { ms: 60_000, reason: "size" });
});

test("Groq: 429 da so'ralgani limitdan katta (qwen OTPM 1 000) — kutilmaydi, guruh bo'linadi; qwen'ga kam max_tokens", async () => {
  const OTPM = "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Used 737, Requested 1450. Please try again in 41.22s.";
  const fake = fakeFetch(groqError(429, OTPM, { "retry-after": "42" }));
  const error = await groq.generate(make(groq, fake), { text: "x", model: "qwen/qwen3.8-27b", posts: 3 }).catch((e) => e);
  assert.equal(fake.calls.length, 1, "kutib qayta urinilmaydi — hech qachon sig'maydi");
  assert.equal(groq.isTooLarge(error), true);
  assert.equal(groq.retryAfterMs(error), null);
  assert.equal(groq.isFatal(error), false);
  assert.equal(pauseFor(groq, error).reason, "size");
  // Oddiy daqiqalik 429 (so'ralgani limitdan kichik) — kutiladi
  const fits = new ApiHttpError(429, "on output tokens per minute (OTPM): Limit 1000, Used 737, Requested 650. Please try again in 20s.");
  assert.equal(groq.isTooLarge(fits), false);
  assert.equal(pauseFor(groq, fits).reason, "minute");

  const qwen = fakeFetch(answer("{}"), answer("{}"));
  await groq.generate(make(groq, qwen), { text: "x", model: "qwen/qwen3.8-27b", posts: 1 });
  await groq.generate(make(groq, qwen), { text: "x", model: "qwen/qwen3.8-27b", posts: 3 });
  assert.deepEqual(qwen.calls.map((c) => c.body.max_tokens), [450, 850], "o'ylamaydi — faqat JSON, 1 000 OTPM dan kam");
});

test("Groq: daqiqalik 429 (TPM) — Retry-After gacha; kunlik (TPD) — matndagi vaqtgacha, 00:00 kutilmaydi", async () => {
  const minute = fakeFetch(groqError(429, TPM, { "retry-after": "7" }));
  const minuteError = await groq.generate(make(groq, minute, { attempts: 1 }), { text: "x", model: "m" }).catch((e) => e);
  assert.equal(groq.isDailyLimit(minuteError), false);
  assert.equal(groq.retryAfterMs(minuteError), 8000);
  assert.equal(minuteError.headers["retry-after"], "7", "limit sarlavhalari saqlanadi");
  assert.equal(pauseFor(groq, minuteError).reason, "minute");

  const now = Date.UTC(2026, 10, 9, 10, 0);
  // Sarlavha yo'q — vaqt matndan olinadi ("try again in 10m48.5s" → 649 s)
  const day = fakeFetch(groqError(429, TPD));
  const dayError = await groq.generate(make(groq, day), { text: "x", model: "m" }).catch((e) => e);
  assert.equal(day.calls.length, 1, "kunlik limitda qayta urinilmaydi");
  assert.equal(groq.isDailyLimit(dayError), true);
  assert.equal(dayError.retryAfterSec, 649);
  assert.deepEqual(pauseFor(groq, dayError, now), { ms: 649_000, reason: "daily", resetAt: now + 649_000 });
  assert.match(groq.describeError(dayError), /asta-sekin/);
  // Hech qanday vaqt yo'q — 1 soat (sirpanuvchi oyna, yarim tun emas)
  const bare = new ApiHttpError(429, "on requests per day (RPD): Limit 1000, Used 1000");
  assert.equal(groq.dailyResetAt(bare, now), now + 3_600_000);
});

test("Groq: modellar ro'yxati — ovoz, filtr va kichik kontekstli modellarsiz", async () => {
  const fake = fakeFetch({
    body: {
      data: [
        { id: "allam-2-7b", context_window: 4096 },
        { id: "meta-llama/llama-prompt-guard-2-86m", context_window: 512 },
        { id: "openai/gpt-oss-120b", context_window: 131072 },
        { id: "openai/gpt-oss-20b", context_window: 131072 },
        { id: "openai/gpt-oss-safeguard-20b", context_window: 131072 },
        { id: "qwen/qwen3.8-27b", context_window: 131072 },
        { id: "whisper-large-v3", context_window: 448 },
        { id: "canopylabs/orpheus-v1-english", context_window: 4000 },
      ],
    },
  });
  assert.deepEqual(await groq.listModels(make(groq, fake)), ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], "qwen3.8-27b ko'rsatmamizga sig'maydi (ITPM 7 000)");
  assert.equal(fake.calls[0].url, "https://api.groq.com/openai/v1/models");
});

test("OpenRouter: faqat :free modellar — pullik modelga so'rov umuman ketmaydi", async () => {
  const fake = fakeFetch(answer("{}"));
  const error = await openrouter.generate(make(openrouter, fake), { text: "x", model: "openai/gpt-5" }).catch((e) => e);
  assert.ok(error instanceof ApiHttpError);
  assert.equal(fake.calls.length, 0, "tarmoqqa chiqilmadi");
  assert.equal(openrouter.isFatal(error), true);
  assert.equal(pauseFor(openrouter, error).reason, "model", "ulanish 6 soat dam oladi");
  assert.match(openrouter.describeError(error), /bepul model emas/);

  const ok = fakeFetch(answer('{"postType":"boshqa","loads":[]}'));
  const result = await openrouter.generate(make(openrouter, ok), { text: "x", model: "nvidia/nemotron-3.5-super-vl:free" });
  assert.equal(result.ok, true);
  assert.equal(ok.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(ok.calls[0].body.model, "nvidia/nemotron-3.5-super-vl:free");
  assert.equal(ok.calls[0].body.response_format.type, "json_object");
  assert.equal(ok.calls[0].body.models, undefined, "zaxira (pullik bo'lishi mumkin) modellar ro'yxati yuborilmaydi");
  assert.deepEqual(ok.calls[0].body.reasoning, { effort: "none" }, "o'ylash o'chirilgan");
});

test("OpenRouter: kunlik limit (free-models-per-day) — X-RateLimit-Reset gacha yoki UTC yarim tunigacha", async () => {
  const now = Date.UTC(2026, 10, 9, 10, 0);
  const reset = Date.UTC(2026, 10, 10, 0, 0);
  const body = { error: { code: 429, message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", metadata: { error_type: "rate_limit_exceeded" } } };
  const fake = fakeFetch({ status: 429, body, headers: { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) } });
  const error = await openrouter.generate(make(openrouter, fake), { text: "x", model: "a:free" }).catch((e) => e);
  assert.equal(fake.calls.length, 1);
  assert.equal(openrouter.isDailyLimit(error), true);
  assert.deepEqual(pauseFor(openrouter, error, now), { ms: reset - now, reason: "daily", resetAt: reset });
  assert.match(openrouter.describeError(error), /05:00/);
  // Sarlavhasiz — UTC yarim tuni (Toshkent 05:00)
  assert.equal(openrouter.dailyResetAt(new ApiHttpError(429, "free-models-per-day"), now), reset);
  assert.equal(nextUtcMidnight(Date.UTC(2026, 10, 9, 23, 59)), reset);

  // Daqiqalik va "upstream band" — qisqa kutish
  const minute = new ApiHttpError(429, "Rate limit exceeded: free-models-per-min.");
  assert.equal(openrouter.isDailyLimit(minute), false);
  assert.equal(pauseFor(openrouter, minute).reason, "minute");
  const upstream = new ApiHttpError(429, "Provider returned error: a:free is temporarily rate-limited upstream. Please retry shortly");
  assert.deepEqual(pauseFor(openrouter, upstream), { ms: 300_000, reason: "minute" }, "bepul hovuz to'lgan — 5 daqiqa");
  assert.equal(openrouter.isDailyLimit(upstream), false);
});

test("OpenRouter: HTTP 200 ichidagi xato va javob o'rtasidagi xato — model band deb", async () => {
  const fake = fakeFetch(
    { body: { error: { code: 502, message: "Provider returned error", metadata: { raw: "upstream timeout" } } } },
    { body: { choices: [{ message: { content: "" }, finish_reason: "error", error: { code: 503, message: "overloaded" } }] } },
  );
  const c = make(openrouter, fake, { attempts: 1 });
  const first = await openrouter.generate(c, { text: "x", model: "a:free" }).catch((e) => e);
  assert.equal(first.status, 502);
  assert.match(first.message, /upstream timeout/);
  assert.equal(pauseFor(openrouter, first).reason, "busy");
  const second = await openrouter.generate(c, { text: "x", model: "a:free" }).catch((e) => e);
  assert.equal(second.status, 503);
});

test("OpenRouter: «Tekshirish» — kalit /key da tekshiriladi, ro'yxatda faqat narxi 0 bo'lgan :free modellar", async () => {
  const fake = fakeFetch(
    { body: { data: { label: "sk-or-v1-…", limit: null, is_free_tier: true } } },
    {
      body: {
        data: [
          { id: "openai/gpt-5", pricing: { prompt: "0.000001", completion: "0.00001" }, context_length: 400000 },
          { id: "nvidia/nemotron-3.5-super-vl:free", pricing: { prompt: "0", completion: "0" }, context_length: 1000000, architecture: { output_modalities: ["text"] } },
          { id: "liquid/lfm-2.5-2.6b:free", pricing: { prompt: "0", completion: "0" }, context_length: 65536 },
          { id: "tiny/model:free", pricing: { prompt: "0", completion: "0" }, context_length: 8192 },
          { id: "image/model:free", pricing: { prompt: "0", completion: "0" }, context_length: 65536, architecture: { output_modalities: ["image"] } },
          { id: "trick/paid:free", pricing: { prompt: "0.0001", completion: "0" }, context_length: 65536 },
          { id: "think/always:free", pricing: { prompt: "0", completion: "0" }, context_length: 65536, reasoning: { mandatory: true } },
        ],
      },
    },
  );
  assert.deepEqual(await openrouter.listModels(make(openrouter, fake)), ["nvidia/nemotron-3.5-super-vl:free", "liquid/lfm-2.5-2.6b:free"]);
  assert.deepEqual(fake.calls.map((c) => c.url), ["https://openrouter.ai/api/v1/key", "https://openrouter.ai/api/v1/models"]);

  const bad = fakeFetch({ status: 401, body: { error: { code: 401, message: "No auth credentials found" } } });
  const error = await openrouter.listModels(make(openrouter, bad)).catch((e) => e);
  assert.equal(error.status, 401);
  assert.equal(bad.calls.length, 1, "kalit noto'g'ri — modellar so'ralmaydi");
});

test("Groq va OpenRouter: boshqaruv markazi uchun ma'lumot, bepul, .env dan qo'shiladi (Groq — o'chirilgan holda)", () => {
  for (const p of [groq, openrouter]) {
    assert.equal(p.free, true);
    assert.equal(p.seedFromEnv, true);
    assert.ok(p.limitNote && p.keyHelp && p.keyPlaceholder && p.title);
  }
  assert.deepEqual([groq.keyEnv, openrouter.keyEnv], [["GROQ_API_KEY"], ["OPENROUTER_API_KEY"]]);
  assert.ok(openrouter.defaultModel.endsWith(":free"));
  assert.equal(groq.seedEnabled, false, "aniqligi past — haydovchilarga noto'g'ri yuk ketmasin");
  const seeds = Object.fromEntries(envSeedEntries({ provider: getProvider("gemini"), model: "gemini-flash-lite-latest" }).map((e) => [e.provider, e]));
  assert.equal(seeds.groq.enabled, false);
  assert.equal(seeds.gemini.enabled, undefined, "boshqalari odatdagidek yoqilgan");
});
