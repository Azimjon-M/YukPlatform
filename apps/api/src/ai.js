// Boshqaruv markazining «AI» bo'limi uchun: kalit bilan modellar ro'yxati va bitta sinov so'rovi.
// Kalitlar bu yerda saqlanmaydi va hech qayerga yozilmaydi — faqat o'sha AI xizmatiga (Google, 1pro.uz, Anthropic) so'rovda ishlatiladi.
import { createParser, PROVIDERS } from "@yuk/parser";

// Sinov e'loni (telefon raqamsiz): AI ishlayotganini va javob vaqtini ko'rsatadi. 1 ta so'rov sarflanadi.
export const SAMPLE_POST = "Toshkentdan Samarqandga 20 tonna un bor. Tent fura kerak, ertaga yuklanadi. Narxi kelishiladi.";

// Gemini ro'yxatida rasm, ovoz, embedding modellari ham bor — e'lon tahlili uchun faqat matn modellari
const TEXT_MODELS = {
  gemini: (name) => /^(gemini|gemma)-/.test(name) && !/(tts|image|embedding|audio|live|vision|computer|robotics|native|banana|transcribe|customtools)/.test(name),
};

// Avval Flash-Lite (tez, bepul limiti katta), keyin Flash, keyin qolganlari; har birida yangi versiya birinchi
const rank = (name) => (/flash-lite/.test(name) ? 0 : /flash/.test(name) ? 1 : 2);
const byUsefulness = (a, b) => rank(a) - rank(b) || b.localeCompare(a, "en", { numeric: true });

export function createAiTools({ providers = PROVIDERS, makeParser = createParser } = {}) {
  return {
    // Ekran uchun provayder ma'lumoti (nomi, bepulmi, kalit qanday ko'rinadi) — har bir provayder faylida yozilgan.
    // free: true — bepul, false — pullik, null — kunlik limitli (limitNote)
    providers: Object.values(providers).map((p) => ({
      id: p.id,
      title: p.title ?? p.id,
      free: p.free ?? null,
      limitNote: p.limitNote ?? null,
      defaultModel: p.defaultModel,
      keyUrl: p.keyUrl ?? null,
      keyPlaceholder: p.keyPlaceholder ?? null,
      keyHelp: p.keyHelp ?? null,
    })),

    has: (id) => Object.hasOwn(providers, id),

    describe: (id, error) => providers[id]?.describeError?.(error) ?? error?.message ?? String(error),

    // Kalit ishlayaptimi + qaysi modellar bor. Bepul limitdan so'rov sarflamaydi (generateContent emas).
    async listModels(id, apiKey) {
      const provider = providers[id];
      const names = await provider.listModels(provider.createClient({ apiKey, attempts: 1 }));
      const usable = TEXT_MODELS[id] ?? (() => true);
      return [...new Set(names.filter(usable))].sort(byUsefulness);
    },

    // Bitta haqiqiy so'rov: sinov e'loni tahlil qilinadi
    async test(id, model, apiKey) {
      const parser = makeParser({ provider: id, model, apiKey, attempts: 1 });
      const started = Date.now();
      const result = await parser.parse(SAMPLE_POST);
      return {
        ok: result.ok,
        ms: Date.now() - started,
        model: result.model ?? model,
        error: result.ok ? null : result.error,
        loads: result.ok
          ? result.loads.map((l) => ({ from: l.fromCity ?? l.fromRegion, to: l.toCity ?? l.toRegion, weightT: l.weightT ?? null, cargo: l.cargo ?? null, truckClass: l.truckClass ?? null, bodyType: l.bodyType ?? null }))
          : [],
      };
    },
  };
}
