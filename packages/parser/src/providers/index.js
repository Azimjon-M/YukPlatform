// AI provayderlari. Har biri bir xil "shaklga" ega:
//   generate(client, { text, model, effort }) → { ok, json | error, model, usage }
// shuning uchun parse.js va cli.js qaysi AI ishlayotganini bilishi shart emas.
// Yangi provayder qo'shish = shu papkaga yangi fayl + quyidagi ro'yxatga bitta qator.
import { claude } from "./claude.js";
import { gemini } from "./gemini.js";

export const PROVIDERS = { gemini, claude };
export const DEFAULT_PROVIDER = "gemini"; // bepul

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Noma'lum provayder: "${id}". Mavjudlari: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}
