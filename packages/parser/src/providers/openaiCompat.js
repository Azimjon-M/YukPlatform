// «OpenAI-mos» API provayderlari: OpenAI'ning /v1/chat/completions shaklidagi har qanday xizmat.
// Hozir bittasi: 1pro.uz (Qwen modeli). Boshqa shunday xizmat qo'shish = pastda yana bitta createOpenAICompatible(...).
//
// Bu yerda SDK yo'q — oddiy fetch (Node 24 da o'zi bor). So'rov shunday ko'rinadi:
//   POST https://1pro.uz/v1/chat/completions
//   Authorization: Bearer <kalit>
//   { model, messages: [{ role: "system", ... }, { role: "user", ... }], response_format: { type: "json_schema", ... } }
// Javob: { choices: [{ message: { content: "<JSON matn>" }, finish_reason }], usage: { prompt_tokens, completion_tokens } }
//
// Muhim farq Gemini'dan: 1pro sxemani MAJBURLAMAYDI (2026-11-06 sinovi: bo'sh maydonlarni tashlab yuboradi),
// shuning uchun javob parse.js da conformPost() bilan sxemaga moslanadi.
import { setTimeout as sleep } from "node:timers/promises";
import { SYSTEM_PROMPT } from "../prompt.js";
import { POST_SCHEMA } from "../schema.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// HTTP xatosi: status (429, 503, ...), serverning xabari va Retry-After (soniya)
export class ApiHttpError extends Error {
  constructor(status, message, { retryAfterSec = null, provider = "AI" } = {}) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.provider = provider;
  }
}

// Toshkent vaqti bilan keyingi yarim tun (UTC+5, yozgi vaqt yo'q)
export function nextTashkentMidnight(time = Date.now()) {
  const offset = 5 * HOUR;
  return Math.floor((time + offset) / DAY) * DAY + DAY - offset;
}

// Javob matnidan JSON: ba'zi modellar ```json ... ``` yoki <think>...</think> qo'shadi
export function extractJson(content) {
  const text = String(content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeUsage(u = {}) {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    // 1pro ba'zan cached_tokens ni prompt_tokens dan katta yozadi — manfiy son chiqmasin
    input: Math.max((u.prompt_tokens ?? 0) - cached, 0),
    output: u.completion_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: 0,
  };
}

// Xato javobi matni: { error: { message } } yoki { message } yoki oddiy matn
async function readError(res, name) {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text);
    message = body?.error?.message ?? body?.message ?? body?.detail ?? (typeof body?.error === "string" ? body.error : message);
  } catch {
    // JSON emas — matnning o'zi
  }
  // Retry-After: soniyalar ("3600"). Sarlavha yo'q bo'lsa get() → null, Number(null) esa 0 — shuning uchun avval tekshiramiz
  const header = res.headers.get("retry-after");
  const seconds = header != null && header.trim() !== "" ? Number(header) : NaN;
  return new ApiHttpError(res.status, String(message || res.statusText), { retryAfterSec: Number.isFinite(seconds) && seconds >= 0 ? seconds : null, provider: name });
}

// config: { id, title, baseURL, keyEnv, baseUrlEnv, defaultModel, ... } — xizmatga xos sozlamalar
export function createOpenAICompatible(config) {
  const { id, title, baseURL: defaultBaseURL, keyEnv, baseUrlEnv } = config;
  const isDaily = (error) => error?.status === 429 && /kunlik|daily|per[\s_-]?day|bugun/i.test(error.message);

  // Bitta HTTP so'rov, 5xx / tarmoq / daqiqalik 429 da qayta urinadi (3 s, 6 s, 12 s ... 30 s gacha)
  async function request(client, path, init = {}) {
    for (let attempt = 1; ; attempt++) {
      let error;
      try {
        const res = await client.fetch(`${client.baseURL}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${client.apiKey}`, "Content-Type": "application/json", ...init.headers },
          signal: AbortSignal.timeout(client.timeoutMs),
        });
        if (res.ok) return await res.json();
        error = await readError(res, title);
      } catch (cause) {
        if (cause instanceof ApiHttpError) throw cause;
        const timeout = cause?.name === "TimeoutError" || cause?.name === "AbortError";
        // Juda uzoq kutildi — 524 bilan bir xil (pastda). Aloqa yo'q (internet) — network: bot 30 s kutadi,
        // bu modelning aybi hisoblanmaydi (pool.js isNetworkError)
        if (timeout) {
          error = new ApiHttpError(524, `${title} ${client.timeoutMs / 1000} s ichida javob bermadi`, { provider: title });
          error.timeout = true;
        } else {
          error = new ApiHttpError(503, `${title} bilan aloqa yo'q (${cause?.message ?? cause})`, { provider: title });
          error.network = true;
        }
      }
      // 524 — javob 100 s dan uzoq yozildi va Cloudflare (1pro.uz oldidagi) uzib qo'ydi. Xuddi shu so'rovni qaytarish
      // yana 100 s va yana token sarflaydi; parse.js esa bunday xatoda guruhni ikkiga bo'lib yuboradi — qisqaroq javob
      const retryable = (error.status >= 500 && error.status !== 524) || (error.status === 429 && !isDaily(error));
      // Server uzoq kutishni so'rasa (> 30 s) — kutib o'tirmaymiz, chaqiruvchi (bot) boshqa ulanishga o'tadi
      const tooLong = error.retryAfterSec != null && error.retryAfterSec > 30;
      if (!retryable || tooLong || attempt >= client.attempts) throw error;
      const wait = error.retryAfterSec != null ? error.retryAfterSec * 1000 : Math.min(3000 * 2 ** (attempt - 1), 30_000);
      await client.sleep(wait);
    }
  }

  return {
    id,
    title,
    defaultModel: config.defaultModel,
    // O'z serverida ishlaydi (GPU bitta) — ko'p parallel so'rov uni sekinlashtiradi
    defaultConcurrency: config.defaultConcurrency ?? 2,
    // Bitta so'rovdagi e'lonlar soni chegarasi (bot PARSER_BATCH dan kichigini oladi). null — cheklovsiz
    maxBatch: config.maxBatch ?? null,
    free: config.free ?? null, // null — bepul ham, pullik ham emas: kunlik limit bor
    limitNote: config.limitNote ?? null,
    keyEnv: [keyEnv],
    keyHint: config.keyHint,
    keyUrl: config.keyUrl ?? null,
    keyPlaceholder: config.keyPlaceholder ?? "sk-…",
    keyHelp: config.keyHelp ?? null,
    // .env da kalit bo'lsa, boshqaruv markazining «AI» ro'yxatiga o'zi qo'shiladi
    seedFromEnv: true,
    costNote: config.costNote ?? "narx hisoblanmaydi",

    // apiKey — boshqaruv markazida qo'shilgan kalit; berilmasa .env dan. fetch/sleep — testlarda soxtasi beriladi
    createClient({ apiKey, attempts = 4, baseURL, fetch: fetchFn = globalThis.fetch, sleep: sleepFn = sleep, timeoutMs } = {}) {
      return {
        apiKey: apiKey ?? process.env[keyEnv],
        baseURL: (baseURL ?? (baseUrlEnv && process.env[baseUrlEnv]) ?? defaultBaseURL).replace(/\/+$/, ""),
        attempts: Math.max(1, attempts),
        fetch: fetchFn,
        sleep: sleepFn,
        // Cloudflare 100 s da uzadi; undan ko'p kutishning foydasi yo'q
        timeoutMs: timeoutMs ?? 120_000,
        // Javob uzunligi chegarasi: model "aylanib qolsa" kunlik token limitini yeb qo'ymasin
        maxTokens: config.maxTokens ?? 12_000,
      };
    },

    async generate(client, { text, model, system = SYSTEM_PROMPT, schema = POST_SCHEMA }) {
      const data = await request(client, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: text },
          ],
          temperature: 0,
          max_tokens: client.maxTokens,
          response_format: { type: "json_schema", json_schema: { name: "javob", schema, strict: true } },
        }),
      });
      const base = { model: data.model ?? model, usage: normalizeUsage(data.usage) };
      const choice = data.choices?.[0];
      const finish = choice?.finish_reason;
      if (finish === "length") return { ok: false, error: "Javob uzilib qoldi (max_tokens)", ...base };
      if (finish === "content_filter") return { ok: false, error: `${title} e'lonni blokladi (content_filter)`, ...base };
      const content = choice?.message?.content;
      const json = extractJson(Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : content);
      if (!json) return { ok: false, error: `Javobda JSON yo'q (${finish ?? "sababsiz"})`, ...base };
      return { ok: true, json, ...base };
    },

    cost() {
      return null;
    },

    // Daqiqalik limit (429, kunlik emas) — qancha kutish kerak (ms). Kunlik bo'lsa — null
    retryAfterMs(error) {
      if (!(error instanceof ApiHttpError) || error.status !== 429 || isDaily(error)) return null;
      return ((error.retryAfterSec ?? 60) + 1) * 1000;
    },

    isDailyLimit(error) {
      return error instanceof ApiHttpError && isDaily(error);
    },

    // Kunlik limit qachon yangilanadi: Retry-After sarlavhasidan, bo'lmasa Toshkent yarim tuni
    dailyResetAt(error, now = Date.now()) {
      if (error?.retryAfterSec != null) return now + error.retryAfterSec * 1000;
      return nextTashkentMidnight(now);
    },

    // true — e'lonni bittadan qayta yuborishdan foyda yo'q (kalit, limit, server band yoki ishlamayapti)
    isFatal(error) {
      if (!(error instanceof ApiHttpError)) return false;
      if ([401, 402, 403, 404, 429, 502, 503, 504].includes(error.status)) return true;
      return error.status === 400 && /model/i.test(error.message);
    },

    describeError(error) {
      if (!(error instanceof ApiHttpError)) return error?.message ?? String(error);
      if (error.network || error.timeout) return error.message;
      if (isDaily(error)) return `${title}: bugungi limit tugadi (429), Toshkent vaqti bilan 00:00 da yangilanadi.`;
      if (error.status === 429) return `${title}: so'rovlar juda ko'p (429), biroz kutiladi.`;
      if (error.status === 401 || error.status === 403) return `${title}: kalit noto'g'ri yoki ruxsat yo'q (${error.status}).`;
      if (error.status === 402) return `${title}: hisobda mablag' yoki limit qolmagan (402).`;
      if (error.status === 404 || (error.status === 400 && /model/i.test(error.message))) return `${title}: model topilmadi (${error.status}). Mavjud modellar: npm run parse -- --provider ${id} --models`;
      if (error.status === 524) return `${title}: javob 100 s dan uzoq yozildi (524) — e'lonlar kichikroq guruhda qayta yuboriladi.`;
      if (error.status >= 500) return `${title} serveri hozir ishlamayapti (${error.status}). Keyinroq qayta uriniladi.`;
      return `${title} xatosi ${error.status}: ${error.message}`;
    },

    // GET /v1/models — kalitni tekshiradi, limit sarflamaydi. Faqat matn modellari (ovoz, rasm, internet-qidiruvsiz)
    async listModels(client) {
      const data = await request(client, "/models");
      return (data.data ?? [])
        .filter((m) => !m.capabilities || (m.capabilities.includes("text") && !m.capabilities.includes("web_search")))
        .filter((m) => !m.model_type || m.model_type === "llm")
        .map((m) => m.id);
    },
  };
}

// 1pro.uz — O'zbekistondagi xizmat, Qwen modeli o'z serverida. Limit: kuniga 1 000 000 output token
// (Toshkent vaqti bilan 00:00 da yangilanadi), tugasa 429 "Kunlik limit tugadi" + Retry-After.
// Kontekst 262 144 token. Kalit .env da ONEPRO_API_KEY (boshqa manzil kerak bo'lsa — ONEPRO_BASE_URL).
export const onepro = createOpenAICompatible({
  id: "onepro",
  title: "1pro.uz (Qwen)",
  baseURL: "https://1pro.uz/v1",
  keyEnv: "ONEPRO_API_KEY",
  baseUrlEnv: "ONEPRO_BASE_URL",
  defaultModel: "qwen3.8-flash",
  // Gold sinovi (2026-11-06): 10 ta e'lon javobi 2 400–3 750 token, server sekundiga 38–110 token yozadi →
  // sekin paytda 100 s dan oshib 524 bo'ldi. 6 ta ≈ 2 300 token ≈ 60 s eng sekin paytda ham
  maxBatch: 6,
  limitNote: "kuniga 1 mln token",
  keyHint: "1pro.uz dan olingan kalitni .env ga ONEPRO_API_KEY=... deb yozing.",
  keyPlaceholder: "sk-…",
  keyHelp: "1pro.uz kaliti (sk-…). Limit: kuniga 1 000 000 javob tokeni, Toshkent vaqti bilan 00:00 da yangilanadi. «Tekshirish» limit sarflamaydi.",
});
