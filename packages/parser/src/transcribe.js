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
