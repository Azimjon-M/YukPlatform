// AI provayderlari. Har biri bir xil "shaklga" ega:
//   generate(client, { text, model, effort, system?, schema? }) → { ok, json | error, model, usage }
//   (system/schema berilmasa — bitta e'lon uchun ko'rsatma va sxema; batch'da — BATCH_* lar)
// shuning uchun parse.js va cli.js qaysi AI ishlayotganini bilishi shart emas.
// Yangi provayder qo'shish = shu papkaga yangi fayl + quyidagi ro'yxatga bitta qator.
// OpenAI shaklidagi xizmat (base URL + "sk-..." kalit) bo'lsa — openaiCompat.js dagi createOpenAICompatible.
import { claude } from "./claude.js";
import { gemini } from "./gemini.js";
import { groq, onepro, openrouter } from "./openaiCompat.js";

export const PROVIDERS = { gemini, onepro, groq, openrouter, claude };
export const DEFAULT_PROVIDER = "gemini"; // bepul

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Noma'lum provayder: "${id}". Mavjudlari: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}

// .env dagi kalitlardan qaysilari boshqaruv markazining «AI» ro'yxatiga o'zi qo'shiladi:
// asosiy provayder (PARSER_PROVIDER, PARSER_MODEL) va seedFromEnv belgili provayderlar (bepul yoki limitli).
// Claude bu yerda yo'q: pullik, kalit yozilgani uchungina pul sarflanmasin.
// seedEnabled: false — kalit ro'yxatga O'CHIRILGAN holda qo'shiladi (gold sinovida aniqligi past chiqqan provayder
// haydovchilarga noto'g'ri yuk yubormasin; boshqaruv markazining «AI» sahifasida bir bosishda yoqiladi)
export function envSeedEntries({ provider, model }) {
  const entries = [{ provider: provider.id, models: [model] }];
  for (const p of Object.values(PROVIDERS)) {
    if (!p.seedFromEnv || p.id === provider.id) continue;
    entries.push({ provider: p.id, models: [p.defaultModel], ...(p.seedEnabled === false ? { enabled: false } : {}) });
  }
  return entries;
}
