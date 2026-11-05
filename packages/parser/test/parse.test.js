// Parser mantig'ini haqiqiy API'siz tekshiradi: soxta (fake) clientlar ishlatiladi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { createParser, resolveSettings } from "../src/parse.js";
import { gemini } from "../src/providers/gemini.js";
import { LOAD_PROPERTIES, POST_SCHEMA } from "../src/schema.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";

const LOAD = {
  category: "fura",
  fromCity: "Toshkent",
  fromPlace: null,
  fromRegion: "toshkent_sh",
  fromCountry: "O'zbekiston",
  toCity: "Farg'ona",
  toPlace: null,
  toRegion: "fargona",
  toCountry: "O'zbekiston",
  cargo: "sement",
  weightT: 20,
  volumeM3: null,
  pallets: null,
  truckClass: null,
  bodyType: "tent",
  vehicleCount: null,
  loadingSides: [],
  partial: false,
  price: 3500000,
  priceUnit: "reys",
  currency: "UZS",
  payment: null,
  negotiable: false,
  when: null,
  note: null,
};

test("namunaviy yuk sxemadagi barcha maydonlarga ega", () => {
  assert.deepEqual(Object.keys(LOAD).sort(), Object.keys(LOAD_PROPERTIES).sort());
});

test("ko'rsatmada haydovchi bilan kelishilgan asosiy qoidalar bor", () => {
  for (const rule of ["LARGER number", "NEVER default to tent", "Never fill in the region's capital", "multiply by 1000", "fiyat"]) {
    assert.ok(SYSTEM_PROMPT.includes(rule), rule);
  }
  // Ko'rsatma keshlanishi uchun o'zgarmas bo'lishi kerak: sana yoki vaqt qo'shilmagan
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(SYSTEM_PROMPT));
});
const JSON_TEXT = JSON.stringify({ postType: "yuk_bor", loads: [LOAD] });
const POST = "Тош-Фаргона 20т тент 90 123 45 67";

function fakeClaude(response) {
  const calls = [];
  const create = async (request) => {
    calls.push(request);
    return { model: request.model, usage: { input_tokens: 10, output_tokens: 5 }, ...response };
  };
  return { calls, beta: { messages: { create } } };
}

function fakeGemini(response) {
  const calls = [];
  const generateContent = async (request) => {
    calls.push(request);
    return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 60 }, ...response };
  };
  return { calls, models: { generateContent } };
}

const claudeOk = {
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: JSON_TEXT },
  ],
};
const geminiOk = { text: JSON_TEXT, modelVersion: "gemini-x", candidates: [{ finishReason: "STOP" }] };

// --- sozlamalar ---

test("standart provayder — gemini, .env dagi bo'sh qiymatlar e'tiborga olinmaydi", () => {
  const saved = { ...process.env };
  process.env.PARSER_PROVIDER = "";
  process.env.PARSER_MODEL = "";
  try {
    const s = resolveSettings();
    assert.equal(s.provider.id, "gemini");
    assert.equal(s.model, "gemini-flash-lite-latest");
  } finally {
    process.env = saved;
  }
});

test("noma'lum provayder tushunarli xato beradi", () => {
  assert.throws(() => resolveSettings({ provider: "gpt" }), /Noma'lum provayder/);
});

// --- Gemini ---

test("gemini: so'rov to'g'ri tuziladi", async () => {
  const client = fakeGemini(geminiOk);
  await createParser({ provider: "gemini", model: "gemini-test", client }).parse(POST);
  const req = client.calls[0];
  assert.equal(req.model, "gemini-test");
  assert.equal(req.contents, "Тош-Фаргона 20т тент [telefon]", "AI'ga telefon raqami yuborilmaydi");
  assert.equal(req.config.systemInstruction, SYSTEM_PROMPT);
  assert.equal(req.config.responseMimeType, "application/json");
  assert.equal(req.config.responseJsonSchema, POST_SCHEMA);
});

test("gemini: javob o'qiladi, telefonlar biriktiriladi, tokenlar normallashadi", async () => {
  const result = await createParser({ provider: "gemini", client: fakeGemini(geminiOk) }).parse(POST);
  assert.equal(result.ok, true);
  assert.equal(result.postType, "yuk_bor");
  assert.deepEqual(result.loads[0].phones, ["+998901234567"]);
  assert.equal(result.model, "gemini-x");
  assert.deepEqual(result.usage, { input: 40, output: 20, cacheRead: 60, cacheWrite: 0 });
});

test("gemini: bloklangan yoki bo'sh javob xato sifatida qaytadi", async () => {
  const blocked = await createParser({
    provider: "gemini",
    client: fakeGemini({ promptFeedback: { blockReason: "SAFETY" } }),
  }).parse(POST);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /SAFETY/);

  const cut = await createParser({
    provider: "gemini",
    client: fakeGemini({ text: '{"postType":', candidates: [{ finishReason: "MAX_TOKENS" }] }),
  }).parse(POST);
  assert.equal(cut.ok, false);
});

test("gemini: limit, kalit va model xatolari ishni to'xtatadi, boshqasi to'xtatmaydi", () => {
  const err = (status, message) => new ApiError({ status, message });
  assert.equal(gemini.isFatal(err(429, "Resource exhausted")), true);
  assert.match(gemini.describeError(err(429, "Resource exhausted")), /limiti tugadi/);
  assert.equal(gemini.isFatal(err(400, "API key not valid")), true);
  assert.equal(gemini.isFatal(err(400, "User location is not supported")), true);
  assert.equal(gemini.isFatal(err(404, "model not found")), true);
  assert.equal(gemini.isFatal(err(503, "high demand")), true);
  assert.match(gemini.describeError(err(503, "high demand")), /band/);
  assert.equal(gemini.isFatal(err(500, "Internal")), false);
  assert.equal(gemini.isFatal(new Error("tarmoq")), false);
});

test("gemini: daqiqalik limitda kutiladi, kunlik limitda to'xtaladi", () => {
  const quota = (quotaId, retryDelay) =>
    new ApiError({ status: 429, message: JSON.stringify({ error: { details: [{ violations: [{ quotaId }] }, { retryDelay }] } }) });
  assert.equal(gemini.retryAfterMs(quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "37s")), 38000);
  assert.equal(gemini.retryAfterMs(new ApiError({ status: 429, message: "Resource exhausted" })), 61000, "ma'lumot yo'q — 1 daqiqa");
  assert.equal(gemini.retryAfterMs(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "3600s")), null);
  assert.match(gemini.describeError(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")), /bugungi/);
  assert.equal(gemini.isDailyLimit(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")), true);
  assert.equal(gemini.isDailyLimit(quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "37s")), false);
  assert.equal(gemini.retryAfterMs(new ApiError({ status: 500, message: "Internal" })), null);
});

// --- Claude ---

test("claude: so'rov to'g'ri tuziladi: sxema, kesh, fallback", async () => {
  const client = fakeClaude(claudeOk);
  await createParser({ provider: "claude", model: "claude-opus-5-5", effort: "low", client }).parse(POST);
  const req = client.calls[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.ok(!JSON.stringify(req.messages).includes("90 123 45 67"), "AI'ga telefon raqami yuborilmaydi");
  assert.equal(req.output_config.effort, "low");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.fallbacks, "default");
});

test("claude: fallback'ni qo'llamaydigan modelda fallback yuborilmaydi", async () => {
  const client = fakeClaude(claudeOk);
  await createParser({ provider: "claude", model: "claude-haiku-5-5", client }).parse(POST);
  assert.equal(client.calls[0].betas, undefined);
  assert.equal(client.calls[0].fallbacks, undefined);
});

test("claude: javob o'qiladi va telefonlar biriktiriladi", async () => {
  const result = await createParser({ provider: "claude", client: fakeClaude(claudeOk) }).parse(POST);
  assert.equal(result.ok, true);
  assert.deepEqual(result.loads[0].phones, ["+998901234567"]);
  assert.equal(result.loads[0].toRegion, "fargona");
});

test("claude: refusal va max_tokens xato sifatida qaytadi", async () => {
  const refused = await createParser({
    provider: "claude",
    client: fakeClaude({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
  }).parse(POST);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /cyber/);

  const cut = await createParser({
    provider: "claude",
    client: fakeClaude({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"postType":' }] }),
  }).parse(POST);
  assert.equal(cut.ok, false);
});

test("buzilgan JSON xato sifatida qaytadi, dastur yiqilmaydi", async () => {
  const result = await createParser({ provider: "gemini", client: fakeGemini({ text: "{buzuq" }) }).parse(POST);
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON/);
});
