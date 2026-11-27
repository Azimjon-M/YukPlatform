// Ovozli xabar / dumaloq videoni matnga o'girish — Gemini (2026-11-16). Collector Telegram Premium o'gira olmaganda
// (akkaunt Premium emas, xato yoki bo'sh javob) shu yerga keladi: fayl inline yuboriladi (ovoz ~20–200 KB, dumaloq
// video 1–8 MB; Gemini inline chegarasi 20 MB). Faqat so'zma-so'z matn — yuk e'lonimi yoki yo'qligini keyin odatdagi
// yo'l (qoidaviy parser / AI) aniqlaydi, shuning uchun ovozli e'lon ham matnli e'lon bilan bir xil tekshiriladi.
import { GoogleGenAI } from "@google/genai";

export const TRANSCRIBE_PROMPT = [
  "Bu — Telegramdagi yuk tashish guruhidan ovozli xabar yoki dumaloq video. Gapirilganini so'zma-so'z yozib ber.",
  "Til o'zbekcha (lotin yoki kirill) yoki ruscha bo'lishi mumkin — qanday gapirilgan bo'lsa, o'sha tilda yoz.",
  "Shahar, viloyat va mahalla nomlarini to'g'ri yoz; raqamlar, tonna va narxni raqam bilan yoz.",
  "Telefon raqamini to'liq yoz: operator kodi alohida aytilsa ham («94 lik, 123 45 67», «toqson to'rt …») — +998 94 123 45 67 ko'rinishida.",
  "Faqat matnni qaytar: izoh, sarlavha, tarjima yoki qo'shtirnoq qo'shma. Nutq bo'lmasa yoki tushunib bo'lmasa — bo'sh javob qaytar.",
].join("\n");

export const MAX_INLINE_BYTES = 19 * 1024 * 1024;

// → { text, model } — text bo'sh bo'lishi mumkin (nutq yo'q). Xato — tashlanadi (chaqiruvchi keyingi ulanishni sinaydi)
export async function transcribeWithGemini({ apiKey, model, data, mime, timeoutMs = 30_000 }) {
  if (!data?.length) throw new Error("Fayl bo'sh");
  if (data.length > MAX_INLINE_BYTES) throw new Error("Fayl juda katta");
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } });
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: Buffer.from(data).toString("base64") } }, { text: TRANSCRIBE_PROMPT }] }],
    config: { temperature: 0 },
  });
  return { text: String(response.text ?? "").trim(), model: response.modelVersion ?? model };
}

// Faqat ovoz/video o'girish uchun sinaladigan modellar (2026-11-20 o'lchovi, 8 ta haqiqiy ovozli xabar): matn tahlili
// ishlatmaydigan modellar — limiti alohida, shuning uchun tahlil kunlik 500 talik limitni yeb qo'yganda ham ishlaydi.
// gemini-3.5-transcribe ~2 s va eng aniq (daqiqasiga ~5 ta so'rov), 3-flash-preview ~3,5 s, 3.6-flash ~5 s, 3.5-flash 5–10 s
// (kunlik limiti kichik). Sinab rad etilgan: Groq Whisper large-v3 / turbo — 0,5 s, lekin o'zbekchani turkcha-ozarbayjoncha
// qilib buzadi (til = uz va maslahat matni bilan ham); 3.7/3.8-flash — 15–28 s; omni/gemma — ovozni olmaydi yoki limit yo'q.
export const TRANSCRIBE_MODELS = ["gemini-3.5-transcribe", "gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.5-flash"];

// Xatodan keyin shu modelni necha ms sinamaslik kerak (collector media.js): limit tugagan modelga har xabarda qayta
// urilmaymiz — vaqt ketadi. Kunlik limit — 30 daqiqada bir tekshiriladi (ba'zan muddatidan oldin ochiladi, rad javobi ~0,3 s),
// daqiqalik — Google aytgan vaqt, band / javob kelmadi — 1 daqiqa, model yo'q / kalit xato / ovozni olmaydi — 6 soat.
export function transcribePauseMs(error) {
  const text = String(error?.message ?? error ?? "");
  const code = Number(error?.status ?? text.match(/"code":\s*(\d+)/)?.[1] ?? text.match(/\b(4\d\d|5\d\d)\b/)?.[1] ?? 0);
  if (code === 429) {
    if (/PerDay/i.test(text)) return 30 * 60_000;
    const sec = Number(text.match(/retryDelay"?:\s*"?([\d.]+)s/)?.[1] ?? text.match(/retry in ([\d.]+)s/i)?.[1] ?? 30);
    return Math.min(Math.max(Math.ceil(sec) + 1, 3), 120) * 1000;
  }
  if ([400, 401, 403, 404].includes(code)) return 6 * 60 * 60_000;
  return 60_000;
}

// Foydalanuvchining o'z ovozli e'loni (ilova chati — apps/api server.js, botdagi «📦 Yuk berish» — apps/bot main.js):
// avval faqat o'girish modellari (TRANSCRIBE_MODELS — tahlil bilan umumiy limiti yo'q), keyin boshqaruv markazidagi Gemini
// ulanishlari; xato bergan model bir muddat dam oladi (transcribePauseMs). connections() — [{ provider, apiKey, model, enabled }].
// → async (data, mime) => matn | null (hammasi band). transcribe — testda soxta
export function createVoiceTranscriber({ connections, log = () => {}, label = "Ovozli e'lon", transcribe = transcribeWithGemini, now = Date.now, maxTries = 4 }) {
  const rest = new Map();
  return async function transcribeVoice(data, mime) {
    const gemini = connections().filter((c) => c.provider === "gemini" && c.enabled !== false && c.apiKey);
    const list = [];
    for (const apiKey of new Set(gemini.map((c) => c.apiKey))) for (const model of TRANSCRIBE_MODELS) list.push({ apiKey, model });
    for (const c of gemini) list.push({ apiKey: c.apiKey, model: c.model });
    const seen = new Set();
    for (const c of list) {
      const key = `${c.apiKey}|${c.model}`;
      if (seen.has(key) || (rest.get(key) ?? 0) > now()) continue;
      seen.add(key);
      try {
        const { text } = await transcribe({ apiKey: c.apiKey, model: c.model, data, mime, timeoutMs: 20_000 });
        return text;
      } catch (error) {
        rest.set(key, now() + transcribePauseMs(error));
        log(`${label}: ${c.model} — ${String(error.message ?? error).slice(0, 160)}`);
      }
      if (seen.size >= maxTries) break;
    }
    return null;
  };
}
