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

  createClient() {
    return new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      // 429 (limit) va 5xx (band) xatolarda kutib qayta urinadi: 3s, 6s, 12s (jami 4 urinish)
      httpOptions: { retryOptions: { attempts: 4, initialDelay: 3, maxDelay: 30 } },
    });
  },

  async generate(client, { text, model }) {
    // Takrorlanadigan ko'rsatmani Gemini o'zi keshlaydi (implicit caching), sozlash shart emas
    const response = await client.models.generateContent({
      model,
      contents: text,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: POST_SCHEMA,
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

  // true — davom etishdan foyda yo'q, ish to'xtatiladi.
  // 429 va 503 bu yerga SDK bir necha marta qayta urinib bo'lgandan keyin keladi:
  // 429 — kunlik limit tugagan, 503 — model hozir band. Ikkalasida ham har bir e'lonni kutib o'tirmaymiz.
  isFatal(error) {
    if (!(error instanceof ApiError)) return false;
    if ([401, 403, 404, 429, 503].includes(error.status)) return true;
    return error.status === 400 && /api key|location/i.test(error.message);
  },

  describeError(error) {
    if (!(error instanceof ApiError)) return error.message;
    if (error.status === 429) return "Gemini bepul limiti tugadi (429). Biroz yoki ertagacha kuting, keyin --skip bilan davom eting.";
    if (error.status === 503) return "Model hozir band (503). Keyinroq urinib ko'ring yoki .env da boshqa PARSER_MODEL tanlang (--models).";
    if (error.status === 404) return "Model topilmadi yoki yopilgan (404). Mavjud modellar: npm run parse -- --models";
    if (error.status === 403) return "Ruxsat yo'q (403): GEMINI_API_KEY ni tekshiring.";
    if (error.status === 400 && /api key/i.test(error.message)) return "GEMINI_API_KEY noto'g'ri (400).";
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
