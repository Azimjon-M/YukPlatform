// Bitta e'lonni AI orqali JSON'ga aylantiradi.
// Qaysi AI ishlashi .env dagi PARSER_PROVIDER ga bog'liq: gemini (standart, bepul) yoki claude.
import { extractPhones, maskPhones } from "./phones.js";
import { DEFAULT_PROVIDER, getProvider } from "./providers/index.js";

export const DEFAULT_EFFORT = "low"; // qanchalik chuqur o'ylashi — hozircha faqat Claude'da ishlatiladi

export function resolveSettings(options = {}) {
  // || — .env da qiymat bo'sh qoldirilgan bo'lsa ham standart qiymat olinadi
  const provider = getProvider(options.provider || process.env.PARSER_PROVIDER || DEFAULT_PROVIDER);
  return {
    provider,
    model: options.model || process.env.PARSER_MODEL || provider.defaultModel,
    effort: options.effort || process.env.PARSER_EFFORT || DEFAULT_EFFORT,
  };
}

// options.client — testlarda soxta client berish uchun; odatda kerak emas
export function createParser(options = {}) {
  const { provider, model, effort } = resolveSettings(options);
  const client = options.client ?? provider.createClient();

  async function parse(text) {
    const phones = extractPhones(text);
    // AI telefon raqamlarini ko'rmaydi — ular yuqorida regex bilan olingan
    const result = await provider.generate(client, { text: maskPhones(text), model, effort });
    const meta = { model: result.model, usage: result.usage, phones };
    if (!result.ok) return { ok: false, error: result.error, ...meta };

    let data;
    try {
      data = JSON.parse(result.json);
    } catch {
      return { ok: false, error: "AI javobidagi JSON o'qilmadi", ...meta };
    }
    return {
      ok: true,
      postType: data.postType,
      // Telefonlar AI'dan emas, regex'dan olinadi va e'londagi har bir yukka biriktiriladi
      loads: data.loads.map((load) => ({ ...load, phones })),
      ...meta,
    };
  }

  return { provider, model, effort, client, parse };
}
