// «OpenAI-mos» API provayderlari: OpenAI'ning /v1/chat/completions shaklidagi har qanday xizmat.
// Hozir uchta: 1pro.uz (Qwen), Groq va OpenRouter (2026-11-09). Yangisi = pastda yana bitta createOpenAICompatible(...).
//
// Bu yerda SDK yo'q — oddiy fetch (Node 24 da o'zi bor). So'rov shunday ko'rinadi:
//   POST https://1pro.uz/v1/chat/completions
//   Authorization: Bearer <kalit>
//   { model, messages: [{ role: "system", ... }, { role: "user", ... }], response_format: { type: "json_schema", ... } }
// Javob: { choices: [{ message: { content: "<JSON matn>" }, finish_reason }], usage: { prompt_tokens, completion_tokens } }
//
// Muhim farq Gemini'dan: 1pro sxemani MAJBURLAMAYDI (2026-11-06 sinovi: bo'sh maydonlarni tashlab yuboradi),
// shuning uchun javob parse.js da conformPost() bilan sxemaga moslanadi (Groq va OpenRouter javobi ham).
import { setTimeout as sleep } from "node:timers/promises";
import { compactOutputRules, SYSTEM_PROMPT } from "../prompt.js";
import { POST_SCHEMA } from "../schema.js";

const SECOND = 1000;
const UPSTREAM_WAIT_MS = 5 * 60 * SECOND;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Xato javobidan saqlanadigan sarlavhalar — faqat limit sonlari va vaqtlari (kalit yoki shaxsiy narsa yo'q).
// Groq: x-ratelimit-*-requests (kunlik so'rov) va x-ratelimit-*-tokens (daqiqalik token), "2m59.56s" ko'rinishida.
// OpenRouter: x-ratelimit-reset — limit yangilanadigan vaqt (Unix ms).
const RATE_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-tokens",
];

// HTTP xatosi: status (429, 503, ...), serverning xabari, Retry-After (soniya) va limit sarlavhalari
export class ApiHttpError extends Error {
  constructor(status, message, { retryAfterSec = null, provider = "AI", headers = {} } = {}) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.provider = provider;
    this.headers = headers;
  }
}

// Toshkent vaqti bilan keyingi yarim tun (UTC+5, yozgi vaqt yo'q)
export function nextTashkentMidnight(time = Date.now()) {
  const offset = 5 * HOUR;
  return Math.floor((time + offset) / DAY) * DAY + DAY - offset;
}

// UTC bo'yicha keyingi yarim tun (Toshkentda 05:00) — OpenRouter kunlik limiti shu paytda yangilanadi
export function nextUtcMidnight(time = Date.now()) {
  return Math.floor(time / DAY) * DAY + DAY;
}

// "2m59.56s", "7.66s", "1h2m3s", "450ms" (Groq shunday yozadi) → millisekund. Tushunilmasa — null
export function parseDuration(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * SECOND; // faqat son — soniya
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (!parts.length || parts.map((p) => p[0]).join("") !== value) return null;
  const unit = { ms: 1, s: SECOND, m: 60 * SECOND, h: HOUR };
  return Math.round(parts.reduce((sum, [, n, u]) => sum + Number(n) * unit[u], 0));
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

// Xato matni: { error: { message } } yoki { message } yoki oddiy matn.
// OpenRouter boshqa xizmat (model egasi) xatosini "Provider returned error" deb, asl matnini metadata.raw da beradi
function errorMessage(body, fallback) {
  const error = body?.error;
  const message = error?.message ?? body?.message ?? body?.detail ?? (typeof error === "string" ? error : null) ?? fallback;
  const raw = error?.metadata?.raw;
  if (raw && /provider returned error/i.test(message)) return `${message}: ${String(typeof raw === "string" ? raw : JSON.stringify(raw)).slice(0, 200)}`;
  return message;
}

async function readError(res, name) {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    message = errorMessage(JSON.parse(text), message);
  } catch {
    // JSON emas — matnning o'zi
  }
  message = String(message || res.statusText);
  const headers = Object.fromEntries(RATE_HEADERS.flatMap((key) => (res.headers.get(key) != null ? [[key, res.headers.get(key)]] : [])));
  // Retry-After: soniyalar ("3600"). Sarlavha yo'q bo'lsa get() → null, Number(null) esa 0 — shuning uchun avval tekshiramiz.
  // Groq sarlavhadan tashqari matnda ham yozadi: "Please try again in 7.5s"
  const header = headers["retry-after"];
  let seconds = header != null && header.trim() !== "" ? Number(header) : NaN;
  if (!Number.isFinite(seconds)) {
    const inText = message.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i);
    const ms = inText ? parseDuration(inText[1]) : null;
    if (ms != null) seconds = Math.ceil(ms / SECOND);
  }
  return new ApiHttpError(res.status, message, { retryAfterSec: Number.isFinite(seconds) && seconds >= 0 ? seconds : null, provider: name, headers });
}

// 1pro'ning ro'yxati: faqat matn modellari (ovoz, rasm, internet-qidiruvsiz)
const textModel = (m) => (!m.capabilities || (m.capabilities.includes("text") && !m.capabilities.includes("web_search"))) && (!m.model_type || m.model_type === "llm");

// Javob shakli: odatda json_schema (strict). Groq strict rejimda sxemani majburlaydi, 1pro va OpenRouter'dagi
// ba'zi modellar e'tiborsiz qoldiradi — javob baribir conformPost dan o'tadi
const jsonSchemaFormat = (schema) => ({ type: "json_schema", json_schema: { name: "javob", schema, strict: true } });

// config: { id, title, baseURL, keyEnv, baseUrlEnv, defaultModel, ... } — xizmatga xos sozlamalar. Ixtiyoriylari:
//   maxBatch — bir so'rovdagi e'lonlar chegarasi; maxTokens — javob uzunligi chegarasi;
//   outputTokens(posts, model) — max_tokens ni e'lonlar soniga qarab hisoblash (Groq: max_tokens daqiqalik limitga kiradi);
//   compactJson — sxema o'rniga json_object + qisqa format qoidasi, bo'sh maydonlarsiz javob (prompt.js compactOutputRules);
//   allowModel(model) — false bo'lsa so'rov yuborilmaydi (OpenRouter: faqat :free, pullik modelga hech qachon);
//   extraBody(model) — so'rovga qo'shimcha maydonlar (o'ylash darajasi va h.k.);
//   modelFilter(m) — /models ro'yxatidan qaysilari kerak; keyCheckPath — kalitni tekshiradigan manzil
//   (OpenRouter /models kalitsiz ham ochiq, shuning uchun kalit alohida tekshiriladi);
//   dailyResetAt(error, now) — kunlik limit qachon yangilanadi; dailyText — o'sha haqida odamga matn;
//   notFoundHint — 404 bo'lsa nima qilish kerak.
export function createOpenAICompatible(config) {
  const { id, title, baseURL: defaultBaseURL, keyEnv, baseUrlEnv } = config;
  const isDaily = (error) => error?.status === 429 && /kunlik|daily|per[\s_-]?day|bugun/i.test(error.message);
  // 413 — so'rov (ko'rsatma + e'lonlar + javobga ajratilgan joy) daqiqalik token limitiga sig'madi (Groq).
  // Groq ba'zan buni 429 bilan aytadi: "... output tokens per minute (OTPM): Limit 1000, Used 737, Requested 1450" —
  // so'ralgani limitning O'ZIDAN katta bo'lsa, kutish foyda bermaydi (qwen3.8-27b, 2026-11-09: bot cheksiz kutgan bo'lardi).
  // Bu ulanishning aybi emas — guruhni kichikroq qilib qayta yuborish kerak (parse.js)
  const isTooLarge = (error) => {
    if (!(error instanceof ApiHttpError)) return false;
    if (error.status === 413) return true;
    const m = error.status === 429 && error.message.match(/Limit (\d+),(?: Used \d+,)? Requested (\d+)/);
    return Boolean(m) && Number(m[2]) > Number(m[1]);
  };

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
        if (res.ok) {
          const data = await res.json();
          // OpenRouter: model egasi xato qaytarsa, ba'zan HTTP 200 + { error: { code, message } } keladi
          if (data?.error && !data.choices && !data.data) {
            const status = Number(data.error.code);
            throw new ApiHttpError(Number.isInteger(status) && status >= 400 ? status : 502, String(errorMessage(data, "xato")), { provider: title });
          }
          return data;
        }
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
      const retryable = (error.status >= 500 && error.status !== 524) || (error.status === 429 && !isDaily(error) && !isTooLarge(error));
      // Server uzoq kutishni so'rasa (> 30 s) — kutib o'tirmaymiz, chaqiruvchi (bot) boshqa ulanishga o'tadi
      const tooLong = error.retryAfterSec != null && error.retryAfterSec > 30;
      if (!retryable || tooLong || attempt >= client.attempts) throw error;
      const wait = error.retryAfterSec != null ? error.retryAfterSec * 1000 : Math.min(3000 * 2 ** (attempt - 1), 30_000);
      await client.sleep(wait);
    }
  }

  const dailyText = config.dailyText ?? "Toshkent vaqti bilan 00:00 da yangilanadi";

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
    // .env da kalit bo'lsa, boshqaruv markazining «AI» ro'yxatiga o'zi qo'shiladi (seedEnabled: false — o'chirilgan holda)
    seedFromEnv: true,
    seedEnabled: config.seedEnabled ?? true,
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

    // posts — so'rovdagi e'lonlar soni (parse.js beradi): javobga qancha token ajratishni hisoblash uchun
    async generate(client, { text, model, system = SYSTEM_PROMPT, schema = POST_SCHEMA, posts = 1 }) {
      // Pullik modelga hech qachon so'rov ketmasin (OpenRouter: faqat ":free"). 404 → ulanish 6 soat dam oladi («model»)
      if (config.allowModel && !config.allowModel(model)) {
        const error = new ApiHttpError(404, `${title}: "${model}" bepul model emas — faqat bepullari ishlatiladi (model nomi ":free" bilan tugashi kerak)`, { provider: title });
        error.notFree = true;
        throw error;
      }
      const maxTokens = config.outputTokens ? Math.min(client.maxTokens, config.outputTokens(posts, model)) : client.maxTokens;
      // Qisqa rejim: sxema yuborilmaydi (~900 token tejaladi), maydon nomlari ko'rsatma oxirida
      const compact = Boolean(config.compactJson);
      const data = await request(client, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: compact ? system + compactOutputRules({ batch: Boolean(schema?.properties?.posts) }) : system },
            { role: "user", content: text },
          ],
          temperature: 0,
          max_tokens: maxTokens,
          response_format: compact ? { type: "json_object" } : jsonSchemaFormat(schema),
          ...config.extraBody?.(model),
        }),
      });
      const base = { model: data.model ?? model, usage: normalizeUsage(data.usage) };
      const choice = data.choices?.[0];
      const finish = choice?.finish_reason;
      // OpenRouter: model egasi javob o'rtasida xato bersa — finish_reason "error" (model band deb hisoblanadi)
      if (finish === "error" || choice?.error) {
        throw new ApiHttpError(Number(choice?.error?.code) >= 400 ? Number(choice.error.code) : 502, `${title}: ${choice?.error?.message ?? "javob o'rtasida xato"}`, { provider: title });
      }
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

    // Daqiqalik limit (429, kunlik emas) — qancha kutish kerak (ms). Kunlik bo'lsa — null.
    // OpenRouter'ning bepul modeli orqasidagi xizmat band ("temporarily rate-limited upstream", bepul hovuz to'lgan;
    // google/gemma-4-31b-it:free 2026-11-09 da bir necha daqiqa shunday edi) — har daqiqada urinmasdan 5 daqiqa kutamiz
    retryAfterMs(error) {
      if (!(error instanceof ApiHttpError) || error.status !== 429 || isDaily(error) || isTooLarge(error)) return null;
      if (/rate-limited upstream/i.test(error.message)) return Math.max((error.retryAfterSec ?? 0) * 1000, UPSTREAM_WAIT_MS);
      return ((error.retryAfterSec ?? 60) + 1) * 1000;
    },

    isDailyLimit(error) {
      return error instanceof ApiHttpError && isDaily(error);
    },

    isTooLarge,

    // Kunlik limit qachon yangilanadi: provayderning o'z qoidasi, bo'lmasa Retry-After, bo'lmasa Toshkent yarim tuni
    dailyResetAt(error, now = Date.now()) {
      const own = config.dailyResetAt?.(error, now);
      if (own != null) return own;
      if (error?.retryAfterSec != null) return now + error.retryAfterSec * 1000;
      return nextTashkentMidnight(now);
    },

    // true — e'lonni bittadan qayta yuborishdan foyda yo'q (kalit, limit, server band yoki ishlamayapti)
    isFatal(error) {
      if (!(error instanceof ApiHttpError) || isTooLarge(error)) return false;
      if ([401, 402, 403, 404, 429, 502, 503, 504].includes(error.status)) return true;
      return error.status === 400 && /model/i.test(error.message);
    },

    describeError(error) {
      if (!(error instanceof ApiHttpError)) return error?.message ?? String(error);
      if (error.network || error.timeout || error.notFree) return error.message;
      if (isDaily(error)) return `${title}: bugungi limit tugadi (429), ${dailyText}.`;
      if (error.status === 429) return `${title}: so'rovlar juda ko'p (429), biroz kutiladi.`;
      if (error.status === 413) return `${title}: so'rov daqiqalik token limitiga sig'madi (413) — guruh kichraytiriladi, bitta e'lon bo'lsa boshqa AI ga beriladi.`;
      if (error.status === 401 || error.status === 403) return `${title}: kalit noto'g'ri yoki ruxsat yo'q (${error.status}).`;
      if (error.status === 402) return `${title}: hisobda mablag' yoki limit qolmagan (402).`;
      if (error.status === 404 || (error.status === 400 && /model/i.test(error.message))) {
        const hint = config.notFoundHint ? ` ${config.notFoundHint}` : "";
        return `${title}: model topilmadi yoki ishlatib bo'lmaydi (${error.status}): ${error.message.slice(0, 160)}.${hint} Mavjud modellar: npm run parse -- --provider ${id} --models`;
      }
      if (error.status === 524) return `${title}: javob 100 s dan uzoq yozildi (524) — e'lonlar kichikroq guruhda qayta yuboriladi.`;
      if (error.status >= 500) return `${title} serveri hozir ishlamayapti (${error.status}). Keyinroq qayta uriniladi.`;
      return `${title} xatosi ${error.status}: ${error.message}`;
    },

    // GET /v1/models — kalitni tekshiradi, limit sarflamaydi. Faqat e'lon tahliliga yaraydigan matn modellari
    async listModels(client) {
      if (config.keyCheckPath) await request(client, config.keyCheckPath);
      const data = await request(client, "/models");
      return (data.data ?? []).filter(config.modelFilter ?? textModel).map((m) => m.id);
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

// Groq — bepul tarif (console.groq.com/docs/rate-limits, 2026-11-09): e'lonlarga yaraydigan modellar
// openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.8-27b — har biri daqiqasiga 30 so'rov va 8 000 token (TPM),
// kuniga 1 000 so'rov va 200 000 token (TPD); limit HAR MODEL uchun alohida. Kunlik limit "sirpanuvchi" —
// 00:00 kutilmaydi, token asta-sekin qaytadi (429 matnida "Please try again in 10m48s").
// gpt-oss'da keshlangan tokenlar (bir xil ko'rsatma) limitga kirmaydi — ko'rsatmamiz ~5 000 token, shuning uchun muhim.
// So'rov TPM dan katta bo'lsa — 413 (parse.js guruhni bo'ladi). Kalit .env da GROQ_API_KEY (gsk_…).
export const groq = createOpenAICompatible({
  id: "groq",
  title: "Groq",
  baseURL: "https://api.groq.com/openai/v1",
  keyEnv: "GROQ_API_KEY",
  baseUrlEnv: "GROQ_BASE_URL",
  defaultModel: "openai/gpt-oss-120b",
  defaultConcurrency: 1, // daqiqasiga 8 000 token — parallel so'rovlar bir-birini 429 ga tushiradi
  maxBatch: 3,
  compactJson: true,
  // max_tokens ham daqiqalik limitga kiradi (so'rov oldidan: ko'rsatma ~6 100 + e'lonlar + max_tokens ≤ 8 000, aks holda 413).
  // O'lchov (2026-11-09, gpt-oss-20b, qisqa JSON): 9 ta yukli e'lon — 721 token (518 tasi o'ylash). O'ylash ~500–800 + yuk ~25.
  // qwen3.8-27b o'ylamaydi (faqat JSON yozadi), lekin unda daqiqasiga 1 000 chiqish tokeni (OTPM) limiti bor — ko'p so'rab bo'lmaydi
  outputTokens: (posts, model) => (/gpt-oss/.test(model) ? 700 + 250 * posts : Math.min(250 + 200 * posts, 950)),
  maxTokens: 2500,
  // gpt-oss — o'ylaydigan model: "low" — qisqa o'ylaydi (tez, kam token), o'ylash matni javobga qo'shilmaydi
  extraBody: (model) => (/gpt-oss/.test(model) ? { reasoning_effort: "low", include_reasoning: false } : /qwen3/.test(model) ? { reasoning_effort: "none", reasoning_format: "hidden" } : {}),
  // Ovoz (whisper, orpheus), xavfsizlik filtrlari (guard, safeguard) va kichik kontekstli modellar kerak emas.
  // qwen3.8-27b ham yo'q: unda hujjatda yozilmagan daqiqalik limitlar bor — kirish 7 000 token (ITPM), chiqish 1 000 (OTPM);
  // ko'rsatmamiz ~6 300 token, rad etilgan urinish ham hisobga kirgani uchun gold sinovida bitta so'rov ham o'tmadi (2026-11-09)
  modelFilter: (m) => m.active !== false && (m.context_window ?? 0) >= 32_000 && !/whisper|orpheus|guard|tts|compound|qwen3.8-27b/i.test(m.id),
  // Kunlik (sirpanuvchi) limit: Retry-After / "try again in ..." → shuncha; bo'lmasa sarlavhadagi vaqt; bo'lmasa 1 soat
  dailyResetAt(error, now) {
    if (error?.retryAfterSec != null) return now + error.retryAfterSec * 1000;
    const ms = parseDuration(error?.headers?.["x-ratelimit-reset-requests"]);
    return now + (ms ?? HOUR);
  },
  dailyText: "token asta-sekin qaytadi (24 soatlik sirpanuvchi oyna)",
  // Gold sinovi (2026-11-09): gpt-oss-120b — 76% (321/424): shahar nomlari normallashmaydi (Andijan, Oxangar), yuk e'loni
  // «mashina_bor», narxlar tushib qoladi. Shuning uchun .env kaliti O'CHIRILGAN holda qo'shiladi — yoqish Azimjon'ning qarori
  seedEnabled: false,
  free: true,
  limitNote: "har model kuniga 200 ming token",
  keyUrl: "https://console.groq.com/keys",
  keyHint: "console.groq.com/keys dan olingan kalitni .env ga GROQ_API_KEY=gsk_... deb yozing.",
  keyPlaceholder: "gsk_…",
  keyHelp:
    "Groq bepul kaliti (gsk_…). Har bir model alohida limitga ega: daqiqasiga 8 000 token, kuniga 200 000 token — bizning ko'rsatma ~6 000 token bo'lgani uchun bitta so'rovga 2–3 e'lon sig'adi, model kuniga ~80 e'lon tahlil qiladi. Sinovda aniqlik 76% (Gemini 98%) — shuning uchun o'chirilgan holda qo'shiladi. «Tekshirish» limit sarflamaydi.",
});

// OpenRouter — ko'p modelli "vositachi". FAQAT ":free" modellar ishlatiladi (narxi 0), pullik modelga so'rov ketmaydi:
// allowModel so'rovdan oldin tekshiradi, ro'yxatda ham faqat bepullar. Bepul limit (openrouter.ai/docs/api-reference/limits,
// 2026-11-09): daqiqasiga 20 so'rov; kuniga 50 so'rov (hisobga 10 $ dan kam to'langan bo'lsa — bizda shunday),
// HAMMA bepul modellar uchun BITTA umumiy hisob; UTC yarim tunida (Toshkent 05:00) yangilanadi.
// 429 matni "Rate limit exceeded: free-models-per-day" / "...-per-min", sarlavha X-RateLimit-Reset (Unix ms).
// Bepul modellar ko'pincha band: "temporarily rate-limited upstream" (429) — biroz kutib qayta urinadi.
export const openrouter = createOpenAICompatible({
  id: "openrouter",
  title: "OpenRouter (bepul modellar)",
  baseURL: "https://openrouter.ai/api/v1",
  keyEnv: "OPENROUTER_API_KEY",
  baseUrlEnv: "OPENROUTER_BASE_URL",
  defaultModel: "nvidia/nemotron-3.5-super-vl:free",
  defaultConcurrency: 1, // kuniga 50 so'rov — tezlik emas, har so'rovga ko'p e'lon sig'dirish muhim
  maxBatch: 10,
  compactJson: true,
  allowModel: (model) => /:free$/.test(String(model ?? "")),
  // O'ylash o'chiriladi: nemotron-3.5-super "low" da ham 3 ta e'longa 7 100 token o'yladi va 92 s ketdi (2026-11-09).
  // O'ylashi majburiy modellar (reasoning.mandatory) "none" ni rad etadi — ular ro'yxatga kiritilmaydi
  extraBody: () => ({ reasoning: { effort: "none" } }),
  modelFilter: (m) =>
    /:free$/.test(m.id) &&
    Number(m.pricing?.prompt ?? 1) === 0 &&
    Number(m.pricing?.completion ?? 1) === 0 &&
    (m.context_length ?? 0) >= 32_000 &&
    m.reasoning?.mandatory !== true &&
    (m.architecture?.output_modalities ?? ["text"]).includes("text"),
  // /models kalitsiz ham ochiq — kalitni /key tekshiradi (limit sarflamaydi)
  keyCheckPath: "/key",
  dailyResetAt(error, now) {
    const reset = Number(error?.headers?.["x-ratelimit-reset"]);
    return Number.isFinite(reset) && reset > now ? reset : nextUtcMidnight(now);
  },
  dailyText: "Toshkent vaqti bilan 05:00 da (UTC yarim tun) yangilanadi",
  notFoundHint: "Bepul modellar uchun openrouter.ai/settings/privacy da bepul modellarga ruxsat yoqilgan bo'lishi kerak.",
  free: true,
  limitNote: "kuniga 50 so'rov (hamma bepul model birga)",
  keyUrl: "https://openrouter.ai/keys",
  keyHint: "openrouter.ai/keys dan olingan kalitni .env ga OPENROUTER_API_KEY=sk-or-... deb yozing.",
  keyPlaceholder: "sk-or-v1-…",
  keyHelp:
    "OpenRouter kaliti (sk-or-v1-…). Faqat nomi «:free» bilan tugaydigan bepul modellar ishlatiladi — pul yechilmaydi. Limit: daqiqasiga 20, kuniga 50 so'rov (barcha bepul modellar uchun bitta hisob), Toshkent vaqti bilan 05:00 da yangilanadi. «Tekshirish» limit sarflamaydi.",
});
