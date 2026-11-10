import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { createAiTools, SAMPLE_POST } from "../src/ai.js";

const secret = Buffer.alloc(32, 3);
const env = { GEMINI_API_KEY: "env-kalit-gemini-0000" };
const GOOD = "AIzaYAXSHI-kalit-123456";
const calls = [];
// Soxta AI yordamchilari: "AIzaYAXSHI…" — ishlaydi, qolgani — "kalit noto'g'ri"
const ai = {
  providers: [{ id: "gemini", title: "Google Gemini", free: true, defaultModel: "flash-lite", keyUrl: "https://example" }],
  has: (id) => id === "gemini",
  describe: (id, error) => `tushuntirish: ${error.message}`,
  async listModels(id, key) {
    calls.push(["models", key]);
    if (!key.startsWith("AIzaYAXSHI")) throw new Error("API key not valid");
    return ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  },
  async test(id, model, key) {
    calls.push(["test", model, key]);
    if (model === "band") throw new Error("503");
    return { ok: true, ms: 1200, model, loads: [{ from: "Toshkent", to: "Samarqand" }] };
  },
};

const headers = { "x-yuk-admin": "1", "content-type": "application/json" };

async function start(store, appEnv) {
  const app = createApp({ store, processes: { list: () => [] }, env: appEnv, ai, secret });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: JSON.parse(text), text };
  };
  return { server, call };
}

let ctx, store;
before(async () => {
  store = openStore({ file: ":memory:" });
  store.seedAiKeys([{ provider: "gemini", models: ["flash-lite"] }], env);
  ctx = await start(store, env);
});
after(() => {
  ctx.server.close();
  store.close();
});

test("ro'yxat: .env kaliti bor, kalitning o'zi javobda yo'q", async () => {
  const { body, text } = await ctx.call("GET", "/api/ai");
  assert.deepEqual(body.keys.map((k) => [k.label, k.fromEnv, k.keyHint, k.problem]), [[".env kaliti", true, "…0000", null]]);
  assert.equal(body.providers[0].id, "gemini");
  assert.ok(!text.includes("env-kalit-gemini"));
});

test("kalitni tekshirish: modellar yoki tushunarli xato", async () => {
  assert.deepEqual((await ctx.call("POST", "/api/ai/models", { provider: "gemini", key: GOOD })).body.models, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  const bad = await ctx.call("POST", "/api/ai/models", { provider: "gemini", key: "AIzaYOMON-kalit-99999" });
  assert.deepEqual([bad.status, bad.body.error], [400, "tushuntirish: API key not valid"]);
  assert.equal((await ctx.call("POST", "/api/ai/models", { provider: "openai", key: GOOD })).status, 400);
  assert.equal((await ctx.call("POST", "/api/ai/models", { provider: "gemini", key: "qisqa" })).status, 400);
  assert.equal((await ctx.call("POST", "/api/ai/models", { provider: "gemini", key: "bo'sh joyli kalit 12345" })).status, 400);
});

test("qo'shish: shifrlangan saqlanadi, takror va ishlamaydigan kalit rad etiladi", async () => {
  const added = await ctx.call("POST", "/api/ai/keys", { provider: "gemini", key: ` ${GOOD} `, label: "Asosiy", models: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] });
  assert.equal(added.status, 201);
  const row = store.db.prepare("SELECT key_enc FROM ai_keys WHERE id = ?").get(added.body.id);
  assert.ok(!row.key_enc.includes("YAXSHI"), "bazada ochiq yozilmaydi");
  assert.equal((await ctx.call("POST", "/api/ai/keys", { provider: "gemini", key: GOOD, models: ["x1"] })).status, 409);
  assert.equal((await ctx.call("POST", "/api/ai/keys", { provider: "gemini", key: "env-kalit-gemini-0000", models: ["x1"] })).status, 409, ".env dagisi ham takror");
  assert.equal((await ctx.call("POST", "/api/ai/keys", { provider: "gemini", key: "AIzaYOMON-kalit-99999", models: ["x1"] })).status, 400);
  assert.equal((await ctx.call("POST", "/api/ai/keys", { provider: "gemini", key: "AIzaYAXSHI-boshqa-1", models: [] })).status, 400);
  const { body, text } = await ctx.call("GET", "/api/ai");
  assert.deepEqual(body.keys[1].models.map((m) => m.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.equal(body.keys[1].keyHint, "…3456");
  assert.ok(!text.includes(GOOD));
  // bot ko'radigan ulanishlar: 1 (.env) + 2 (yangi kalitning ikki modeli)
  assert.equal(store.aiConnections({ secret, env }).length, 3);
});

test("o'zgartirish, saqlangan kalit bilan modellar va sinov, o'chirish", async () => {
  const id = (await ctx.call("GET", "/api/ai")).body.keys.at(-1).id;
  assert.equal((await ctx.call("PATCH", `/api/ai/keys/${id}`, { enabled: false, label: "  Zaxira  " })).status, 200);
  const key = (await ctx.call("GET", "/api/ai")).body.keys.at(-1);
  assert.deepEqual([key.enabled, key.label], [false, "Zaxira"]);
  assert.equal((await ctx.call("PATCH", `/api/ai/keys/${id}`, { models: ["gemini-3.1-flash-lite", "band"] })).status, 200);
  assert.equal((await ctx.call("PATCH", `/api/ai/keys/${id}`, { enabled: "ha" })).status, 400);
  assert.equal((await ctx.call("PATCH", "/api/ai/keys/999", { enabled: true })).status, 404);

  assert.equal((await ctx.call("GET", `/api/ai/keys/${id}/models`)).body.models.length, 2);
  assert.deepEqual(calls.at(-1), ["models", GOOD], "saqlangan kalit ochilib ishlatildi");

  // Model "dam olyapti" va «muammoli» — muvaffaqiyatli sinov dam olishni bekor qiladi (bot 15 s ichida qayta ishlatadi)
  store.saveAiSlot({ id: `${id}:gemini-3.1-flash-lite`, cooldownUntil: Date.now() + 3_600_000, reason: "daily", problem: { since: 1, lastFaultAt: Date.now() } });
  const ok = await ctx.call("POST", `/api/ai/keys/${id}/test`, { model: "gemini-3.1-flash-lite" });
  assert.deepEqual([ok.body.ok, ok.body.ms, ok.body.loads[0].to, ok.body.woke], [true, 1200, "Samarqand", true]);
  let slot = (await ctx.call("GET", "/api/ai")).body.keys.at(-1).models.find((m) => m.model === "gemini-3.1-flash-lite").state;
  assert.deepEqual([slot.cooldownUntil, slot.reason], [null, null]);
  assert.ok(slot.problem, "belgi sinov bilan olinmaydi — faqat qo'lda yoki 24 soatdan keyin");
  const busy = await ctx.call("POST", `/api/ai/keys/${id}/test`, { model: "band" });
  assert.deepEqual([busy.status, busy.body.ok, busy.body.error, busy.body.woke], [200, false, "tushuntirish: 503", false]);
  assert.equal((await ctx.call("POST", `/api/ai/keys/${id}/test`, { model: "qo'shilmagan" })).status, 400);

  // «Belgini olib tashlash»
  assert.equal((await ctx.call("POST", `/api/ai/keys/${id}/reset`, { model: "gemini-3.1-flash-lite" })).status, 200);
  slot = (await ctx.call("GET", "/api/ai")).body.keys.at(-1).models.find((m) => m.model === "gemini-3.1-flash-lite").state;
  assert.equal(slot.problem, null);
  assert.equal((await ctx.call("POST", `/api/ai/keys/${id}/reset`, { model: "qo'shilmagan" })).status, 400);
  assert.equal((await ctx.call("POST", "/api/ai/keys/999/reset", { model: "m" })).status, 404);

  assert.equal((await ctx.call("DELETE", `/api/ai/keys/${id}`)).status, 200);
  assert.equal((await ctx.call("DELETE", `/api/ai/keys/${id}`)).status, 404);
});

test(".env dagi kalit o'chirilgan bo'lsa — sababi ko'rinadi, sinov 400", async () => {
  const s = openStore({ file: ":memory:" });
  s.seedAiKeys([{ provider: "gemini", models: ["m"] }], env);
  const other = await start(s, {});
  assert.match((await other.call("GET", "/api/ai")).body.keys[0].problem, /GEMINI_API_KEY/);
  assert.equal((await other.call("POST", "/api/ai/keys/1/test", { model: "m" })).status, 400);
  other.server.close();
  s.close();
});

test("haqiqiy yordamchilar: matn modellari saralanadi, sinov e'loni bitta so'rov", async () => {
  const fakeProvider = {
    id: "gemini",
    title: "Google Gemini",
    free: true,
    defaultModel: "gemini-flash-lite-latest",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    createClient: (opts) => ({ opts }),
    async listModels(client) {
      assert.equal(client.opts.attempts, 1);
      return ["gemini-2.5-flash", "gemini-3.5-flash-lite", "text-embedding-004", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-lite", "gemma-4-27b-it", "imagen-4.0", "gemini-nano-banana-2.1", "gemini-3.5-transcribe", "gemini-3.1-pro-preview-customtools"];
    },
  };
  const tools = createAiTools({
    providers: { gemini: fakeProvider },
    makeParser: (opts) => ({
      async parse(text) {
        assert.equal(text, SAMPLE_POST);
        assert.equal(opts.apiKey, "k");
        return { ok: true, model: opts.model, loads: [{ fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, cargo: "un" }] };
      },
    }),
  });
  assert.deepEqual(await tools.listModels("gemini", "k"), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemma-4-27b-it"]);
  const result = await tools.test("gemini", "gemini-3.5-flash-lite", "k");
  assert.deepEqual([result.ok, result.loads[0].from, result.loads[0].weightT], [true, "Toshkent", 20]);
  assert.deepEqual(tools.providers, [
    { id: "gemini", title: "Google Gemini", free: true, limitNote: null, defaultModel: "gemini-flash-lite-latest", keyUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AIza…", keyHelp: null },
  ]);
  // Haqiqiy ro'yxat: Gemini bepul, 1pro kunlik limitli, Claude pullik
  const real = Object.fromEntries(createAiTools().providers.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(real), ["gemini", "onepro", "groq", "openrouter", "claude"]);
  assert.deepEqual([real.gemini.free, real.onepro.free, real.groq.free, real.openrouter.free, real.claude.free], [true, null, true, true, false]);
  assert.equal(real.groq.keyPlaceholder, "gsk_…");
  assert.match(real.openrouter.keyHelp, /:free/);
  assert.equal(real.onepro.limitNote, "kuniga 1 mln token");
  assert.equal(real.onepro.defaultModel, "qwen3.8-flash");
});
