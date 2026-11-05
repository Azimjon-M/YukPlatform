// Gemini (Google) provayderi. aistudio.google.com dagi BEPUL API kalit bilan ishlaydi.
// Eslatma: bepul tarifda Google yuborilgan matnlardan o'z mahsulotlarini yaxshilash uchun
// foydalanishi mumkin. E'lonlar ochiq guruhlardan olingani uchun bu bizga to'g'ri keladi,
// lekin bu yo'l bilan shaxsiy ma'lumot yubormang.
import { ApiError, GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT } from "../prompt.js";
import { POST_SCHEMA } from "../schema.js";

function normalizeUsage(u = {}) {
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    input: (u.promptTokenCount ?? 0) - cached,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheRead: cached,
    cacheWrite: 0,
  };
}

// 429 xatosi ichida Google qaysi limit tugaganini (daqiqalik yoki kunlik) va qancha kutishni yozadi
function quotaInfo(error) {
  const text = String(error?.message ?? "");
  const quotaId = text.match(/"quotaId":\s*"([^"]+)"/)?.[1] ?? "";
  const delay = text.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1];
  return { perDay: /PerDay/i.test(quotaId), delaySec: delay ? Number(delay) : null };
}

export const gemini = {
  id: "gemini",
  // "-latest" taxallusi Google'ning eng yangi Flash-Lite modeliga ishora qiladi (2026-11: gemini-3.5-flash-lite).
  // Flash-Lite tez (~1.5 s) va bepul tarifda barqaror; oddiy "gemini-flash-latest" tez-tez band (503) bo'ladi.
  // Kalitingiz bilan qaysi modellar mavjudligini ko'rish: npm run parse -- --models
  defaultModel: "gemini-flash-lite-latest",
  // Bepul tarifda daqiqasiga so'rovlar soni cheklangan, shuning uchun sekinroq yuboramiz
  defaultConcurrency: 2,
  keyEnv: ["GEMINI_API_KEY"],
  keyHint: "aistudio.google.com → Get API key (bepul), keyin .env ga GEMINI_API_KEY=... deb yozing.",
  costNote: "bepul tarifda $0",

  // apiKey — boshqaruv markazida qo'shilgan kalit; berilmasa .env dagi GEMINI_API_KEY.
  // attempts — 429 (limit) va 5xx (band) xatolarda necha marta urinadi (3s, 6s, 12s kutib).
  // Bot bir nechta kalit bilan ishlaganda kam urinadi: limitga tushgan kalitni kutgandan ko'ra boshqasiga o'tgan tezroq.
  createClient({ apiKey, attempts = 4 } = {}) {
    return new GoogleGenAI({
      apiKey: apiKey ?? process.env.GEMINI_API_KEY,
      httpOptions: { retryOptions: { attempts, initialDelay: 3, maxDelay: 30 } },
    });
  },
  keyUrl: "https://aistudio.google.com/apikey",

  // system/schema — bir nechta e'lonni bitta so'rovda yuborishda (batch) boshqa ko'rsatma va sxema beriladi
  async generate(client, { text, model, system = SYSTEM_PROMPT, schema = POST_SCHEMA }) {
    // Takrorlanadigan ko'rsatmani Gemini o'zi keshlaydi (implicit caching), sozlash shart emas
    const response = await client.models.generateContent({
      model,
      contents: text,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    });
    const base = { model: response.modelVersion ?? model, usage: normalizeUsage(response.usageMetadata) };

    const blocked = response.promptFeedback?.blockReason;
    if (blocked) return { ok: false, error: `Gemini e'lonni blokladi (${blocked})`, ...base };

    const finish = response.candidates?.[0]?.finishReason;
    if (finish === "MAX_TOKENS") return { ok: false, error: "Javob uzilib qoldi (MAX_TOKENS)", ...base };

    const json = response.text;
    if (!json) return { ok: false, error: `Javobda matn yo'q (${finish ?? "sababsiz"})`, ...base };
    return { ok: true, json, ...base };
  },

  cost() {
    return null; // bepul tarifda narx yo'q
  },

  // Daqiqalik limit (429) tugasa — qancha kutib, keyin davom etish kerak (ms). Kunlik bo'lsa — null.
  // Bepul tarifda daqiqasiga so'rovlar soni oz, 2026-11-04 da 16-so'rovda tugadi va bir daqiqada tiklandi.
  retryAfterMs(error) {
    if (!(error instanceof ApiError) || error.status !== 429) return null;
    const { perDay, delaySec } = quotaInfo(error);
    if (perDay) return null;
    return Math.ceil((delaySec ?? 60) + 1) * 1000;
  },

  // Kunlik limit tugadimi (Google uni Tinch okeani vaqti bilan yarim tunda, Toshkentda 13:00 da yangilaydi)
  isDailyLimit(error) {
    return error instanceof ApiError && error.status === 429 && quotaInfo(error).perDay;
  },

  // true — davom etishdan foyda yo'q, ish to'xtatiladi.
  // 429 bu yerga daqiqalik kutishlar ham yordam bermaganda yoki kunlik limit tugaganda keladi,
  // 503 — model hozir band. Ikkalasida ham har bir e'lonni kutib o'tirmaymiz.
  isFatal(error) {
    if (!(error instanceof ApiError)) return false;
    if ([401, 403, 404, 429, 503].includes(error.status)) return true;
    return error.status === 400 && /api key|location/i.test(error.message);
  },

  describeError(error) {
    if (!(error instanceof ApiError)) return error.message;
    if (error.status === 429 && quotaInfo(error).perDay) {
      return "Gemini'ning bugungi bepul limiti tugadi (429), Toshkent vaqti bilan 13:00 da yangilanadi.";
    }
    if (error.status === 429) return "Gemini bepul limiti tugadi (429): daqiqasiga so'rovlar ko'p.";
    if (error.status === 503) return "Model hozir band (503). Keyinroq urinib ko'ring yoki boshqa model tanlang.";
    if (error.status === 404) return "Model topilmadi yoki yopilgan (404). Mavjud modellar: npm run parse -- --models";
    if (error.status === 403) return "Ruxsat yo'q (403): kalitni tekshiring.";
    if (error.status === 400 && /api key/i.test(error.message)) return "Kalit noto'g'ri (400).";
    if (error.status === 400 && /location/i.test(error.message)) return "Gemini API bu mamlakatda ishlamayapti (400).";
    return `Gemini xatosi ${error.status}: ${error.message}`;
  },

  async listModels(client) {
    const names = [];
    for await (const model of await client.models.list()) {
      if (model.supportedActions?.includes("generateContent")) names.push(model.name.replace(/^models\//, ""));
    }
    return names;
  },
};
