// Claude (Anthropic) provayderi. Pullik: console.anthropic.com da hisob to'ldirilgan bo'lishi kerak.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../prompt.js";
import { POST_SCHEMA } from "../schema.js";

// Bu modellarda xavfsizlik filtri so'rovni rad etsa, API uni o'zi boshqa modelda qayta bajaradi
const SUPPORTS_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/;

// $ / 1 million token — faqat taxminiy narxni ko'rsatish uchun
const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

function normalizeUsage(u = {}) {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

export const claude = {
  id: "claude",
  defaultModel: "claude-opus-5-5",
  defaultConcurrency: 4,
  keyEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  keyHint: "console.anthropic.com → API Keys, keyin .env ga ANTHROPIC_API_KEY=... deb yozing.",

  createClient() {
    // Kalit .env dagi ANTHROPIC_API_KEY dan olinadi. 429 va 5xx xatolarda SDK o'zi qayta urinadi.
    return new Anthropic({ maxRetries: 4 });
  },

  // system/schema — bir nechta e'lonni bitta so'rovda yuborishda (batch) boshqa ko'rsatma va sxema beriladi
  async generate(client, { text, model, effort, system = SYSTEM_PROMPT, schema = POST_SCHEMA }) {
    const request = {
      model,
      max_tokens: 16000,
      output_config: {
        effort,
        format: { type: "json_schema", schema },
      },
      // Ko'rsatma keshlanadi: har bir e'londa qaytadan to'liq narxda o'qilmaydi
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: text }],
    };
    if (SUPPORTS_FALLBACK.test(model)) {
      request.betas = ["server-side-fallback-2026-07-01"];
      request.fallbacks = "default";
    }

    const response = await client.beta.messages.create(request);
    const base = { model: response.model, usage: normalizeUsage(response.usage) };

    if (response.stop_reason === "refusal") {
      return { ok: false, error: `AI rad etdi (${response.stop_details?.category ?? "sababsiz"})`, ...base };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "Javob max_tokens chegarasida uzilib qoldi", ...base };
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block) return { ok: false, error: "Javobda matn yo'q", ...base };
    return { ok: true, json: block.text, ...base };
  },

  cost(model, usage) {
    const price = PRICES[model];
    if (!price) return null;
    // Kesh: yozish ~1.25x, o'qish ~0.1x
    const input = usage.input + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1;
    return (input * price.input + usage.output * price.output) / 1e6;
  },

  // true — davom etishdan foyda yo'q (kalit noto'g'ri, model yo'q), ish to'xtatiladi
  isFatal(error) {
    return (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError ||
      error instanceof Anthropic.NotFoundError
    );
  },

  describeError(error) {
    // Aniqroq xatodan umumiyroq xatoga qarab tekshiramiz
    if (error instanceof Anthropic.AuthenticationError) return "ANTHROPIC_API_KEY noto'g'ri (401).";
    if (error instanceof Anthropic.PermissionDeniedError) return "Ruxsat yo'q (403): hisob yoki kalitni tekshiring.";
    if (error instanceof Anthropic.NotFoundError) return "Model topilmadi (404). Mavjud modellar: npm run parse -- --models";
    if (error instanceof Anthropic.RateLimitError) return "Juda ko'p so'rov (429): --concurrency ni kamaytiring.";
    if (error instanceof Anthropic.BadRequestError) return `So'rov xato (400): ${error.message}`;
    if (error instanceof Anthropic.APIError) return `API xatosi ${error.status ?? ""}: ${error.message}`;
    return error.message;
  },

  async listModels(client) {
    const names = [];
    for await (const model of client.models.list()) names.push(model.id);
    return names;
  },
};
