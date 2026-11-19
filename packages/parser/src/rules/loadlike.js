// «Yuk e'loni / e'lon emas» — o'rgatilgan yengil model (2026-11-19, Azimjon: «E'lon/E'lonEmas ni 90% va undan yuqori
// aniqlikka olib chiq … yengil, tez»; misol: «sabr qilib turish kerak … yuk bo'lsa yozadi shu gruppaga» — yuk haqida gap, lekin
// e'lon emas — andozalar buni ushlamaydi). Logistik regressiya: so'zlar, juft so'zlar va bir nechta belgi (joy bormi, telefon,
// og'irlik…) → 2^16 katakka xeshlanadi, har katakda bitta vazn (loadModel.js — scripts/train-loadlike.mjs yasaydi).
// Xeshlangani uchun faylda so'zlar yo'q (ochiq repoga xavfsiz). Bir e'longa ~0,05 ms.
import { MODEL } from "./loadModel.js";
import { toLatin, wordKey } from "./text.js";

export const BUCKETS = 1 << 16;

// FNV-1a (32 bit) → katak raqami
export function bucketOf(feature) {
  let h = 0x811c9dc5;
  for (let i = 0; i < feature.length; i++) {
    h ^= feature.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & (BUCKETS - 1);
}

const TOKEN_RE = /\[telefon\]|\d+(?:[.,]\d+)?|[\p{L}']+|[?!]/gu;
const MAX_TOKENS = 120;

// Matn (telefonlari [telefon] bilan almashtirilgan) + belgilar → katak raqamlari (takrorsiz)
// flags: { place, from, phone, weight, sure, free, junk, signal, truck } — fastLook hisoblaydi
export function featuresOf(maskedText, flags = {}) {
  const latin = toLatin(String(maskedText ?? "")).normalize("NFKC");
  const tokens = [];
  for (const match of latin.matchAll(TOKEN_RE)) {
    const raw = match[0];
    let token;
    if (raw === "[telefon]") token = "<tel>";
    else if (/^\d/.test(raw)) token = raw.length >= 5 ? "<katta>" : "<son>";
    else if (raw === "?" || raw === "!") token = raw;
    else token = wordKey(raw);
    if (token) tokens.push(token);
    if (tokens.length >= MAX_TOKENS) break;
  }
  const set = new Set();
  for (let i = 0; i < tokens.length; i++) {
    set.add(bucketOf(`u:${tokens[i]}`));
    if (i + 1 < tokens.length) set.add(bucketOf(`b:${tokens[i]}_${tokens[i + 1]}`));
    // So'z boshi (qo'shimchasiz o'xshash shakllar: «olamiz», «olaman», «olamz»)
    if (tokens[i].length >= 6) set.add(bucketOf(`p:${tokens[i].slice(0, 5)}`));
  }
  const words = tokens.filter((t) => t[0] !== "<" && t !== "?" && t !== "!").length;
  set.add(bucketOf(`n:${words <= 3 ? "1-3" : words <= 7 ? "4-7" : words <= 15 ? "8-15" : words <= 40 ? "16-40" : "40+"}`));
  for (const [name, on] of Object.entries(flags)) set.add(bucketOf(`f:${name}=${on ? 1 : 0}`));
  // Juft belgilar: joy + telefon, joy + yuk belgisi
  set.add(bucketOf(`f:place+phone=${flags.place ? 1 : 0}${flags.phone ? 1 : 0}`));
  set.add(bucketOf(`f:from+signal=${flags.from ? 1 : 0}${flags.signal ? 1 : 0}`));
  return [...set];
}

let weights = null;
function loadWeights() {
  if (weights) return weights;
  const bytes = Buffer.from(MODEL.weights, "base64");
  weights = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return weights;
}

// → 0…1: yuk e'loni bo'lish ehtimoli. Model hali o'rgatilmagan (bo'sh) bo'lsa — null
export function loadScore(maskedText, flags) {
  if (!MODEL.weights) return null;
  const w = loadWeights();
  let z = MODEL.bias;
  for (const index of featuresOf(maskedText, flags)) z += w[index] * MODEL.scale;
  return 1 / (1 + Math.exp(-z));
}
export const LOAD_THRESHOLD = MODEL.threshold ?? 0.5;
