// 1pro embedding mijozi (2026-11-23, «yuk e'loni / e'lon emas» ni embedding bilan aniqlash — embedModel.js).
//   POST https://1pro.uz/v1/embeddings  { model: "embeddinggemma-2-uz", input: [...≤ 64], task, dimensions }
// Hujjat: https://1pro.uz/docs.md («Embeddings», «Ishonchli ulanish», «Xatolar va qayta urinish»). Bu yerda:
//   - ulanish/javob muddati (standart 12 s), 429/5xx/tarmoq xatosida 1 marta qayta urinish (Retry-After ga amal qilinadi),
//     4xx (kalit, so'rov) qayta urinilmaydi;
//   - circuit breaker: ketma-ket 3 nosozlik → 30 s API'ga bormaymiz (har e'lon kutib o'tirmasin), keyin bitta sinov so'rovi;
//   - kesh: bir xil matn ko'p guruhda takrorlanadi — vektor matn xeshi bo'yicha xotirada (LRU);
//   - telefon raqamlari 1pro'ga yuborilmaydi (vektorga ham ta'sir qilmasin) — <tel> bilan almashtiriladi;
//   - xato HECH QACHON tashlanmaydi: embed() → Float32Array[] yoki null (chaqiruvchi eski yo'lda davom etadi).
// Kalit: .env ONEPRO_EMBED_API_KEY (faqat shu modelga ruxsatli kalit). Logga matn ham, kalit ham yozilmaydi.
import { createHash } from "node:crypto";
import fs from "node:fs";

export const EMBED_MODEL = "embeddinggemma-2-uz";
export const EMBED_BATCH = 64;
const MAX_CHARS = 2000; // e'lon uzun bo'lsa ham boshi yetadi (8 192 token chegara — so'rov ~4 MB dan oshmasin)

// Kesish belgilar bo'yicha (emoji o'rtasidan emas): yarim emoji (yolg'iz surrogat) 1pro'da 500 «surrogates not allowed»
export const embedText = (text) =>
  [...String(text ?? "").replace(/\+?\d[\d ()-]{7,}\d/g, "<tel>")]
    .slice(0, MAX_CHARS)
    .join("")
    .toWellFormed() // yolg'iz surrogat → U+FFFD (juft emoji o'z holicha)
    .replace(/\uFFFD/g, "");
export const textHash = (text) => createHash("sha1").update(embedText(text)).digest("hex");
// Saqlangan vektorlar / model yonidagi imzo: model, o'lcham, task almashsa — qayta embedding va qayta o'rgatish kerak
export const embedSignature = ({ model = EMBED_MODEL, dimensions, task }) => `${model}/${dimensions}/${task}`;

export function createEmbedder({
  apiKey,
  baseUrl = "https://1pro.uz/v1",
  model = EMBED_MODEL,
  dimensions = 768,
  task = "Classification",
  timeoutMs = 12_000,
  cacheSize = 20_000,
  breakerFailures = 3,
  breakerMs = 30_000,
  fetchFn = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const cache = new Map(); // hash → Float32Array (Map tartibi = LRU)
  let failures = 0;
  let openUntil = 0;
  const stats = { requests: 0, failures: 0, cached: 0, skipped: 0, lastError: null };

  const remember = (hash, vector) => {
    cache.delete(hash);
    cache.set(hash, vector);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  };

  async function request(input) {
    for (let attempt = 0; attempt < 2; attempt++) {
      stats.requests++;
      let retryMs = 1000;
      try {
        const res = await fetchFn(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "user-agent": "yuk-platform/1.0" },
          body: JSON.stringify({ model, input, task, dimensions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const body = await res.json();
          const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
          if (data.length !== input.length || data.some((d) => d.embedding?.length !== dimensions)) throw new Error("javob shakli noto'g'ri");
          return data.map((d) => Float32Array.from(d.embedding));
        }
        const error = new Error(`HTTP ${res.status}`);
        if (res.status !== 429 && res.status < 500) throw Object.assign(error, { final: true }); // kalit / so'rov xatosi
        retryMs = Math.min(10_000, 1000 * (Number(res.headers.get("retry-after")) || 1));
        throw error;
      } catch (error) {
        if (error.final || attempt === 1) throw error;
        await sleep(retryMs);
      }
    }
    return null;
  }

  return {
    stats,
    signature: embedSignature({ model, dimensions, task }),
    isOpen: () => now() < openUntil,
    // texts → vektorlar (har matnga bittadan) yoki null (API ishlamadi / breaker ochiq). Hech qachon xato tashlamaydi
    async embed(texts) {
      const out = new Array(texts.length);
      const missing = new Map(); // hash → { text, idx: [] }
      texts.forEach((text, i) => {
        const hash = textHash(text);
        const hit = cache.get(hash);
        if (hit) {
          remember(hash, hit);
          stats.cached++;
          out[i] = hit;
        } else {
          const entry = missing.get(hash) ?? missing.set(hash, { text: embedText(text), idx: [] }).get(hash);
          entry.idx.push(i);
        }
      });
      if (!missing.size) return out;
      if (!apiKey || now() < openUntil) {
        stats.skipped += missing.size;
        return null;
      }
      try {
        const entries = [...missing.entries()];
        for (let i = 0; i < entries.length; i += EMBED_BATCH) {
          const part = entries.slice(i, i + EMBED_BATCH);
          const vectors = await request(part.map(([, e]) => e.text));
          part.forEach(([hash, e], j) => {
            remember(hash, vectors[j]);
            for (const k of e.idx) out[k] = vectors[j];
          });
        }
        failures = 0;
        return out;
      } catch (error) {
        stats.failures++;
        stats.lastError = error.message;
        if (++failures >= breakerFailures) {
          openUntil = now() + breakerMs;
          failures = breakerFailures - 1; // 30 s dan keyingi sinov so'rovi ham o'xshamasa — yana darhol ochiladi
        }
        return null;
      }
    },
  };
}

// --- «Yuk e'loni / e'lon emas»: embedding + fastLook aralashmasi (2026-11-23) ---
// Sinov (11 673 ta AI belgilagan e'lon, fastLook ko'rmagan): yolg'iz embedding fastLook'dan yomon (88–92% / 95,3%), lekin
// fastLook ikkilangan joyda yaxshi. Aralashma: z = (1 − w)·logit(fastLook) + w·logit(embedding) > t → e'lon. Faqat fastLook
// balli (lo, hi) oralig'ida bo'lganda (≈ 13% e'lon) embedding so'raladi; qolganiga fastLook o'zi hal qiladi.
// Model fayli: data/embed-model.json (packages/parser/scripts/train-embed.mjs) — logistik regressiya (standartlash vaznga
// singdirilgan), signature, tavsiya qilingan { w, t, lo, hi }. Sozlama embed_config (bazada) shularni ustidan yozadi.
export const logit = (p) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
};

export function loadEmbedModel(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const buf = Buffer.from(raw.weights, "base64");
    const weights = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (raw.kind !== "logreg" || weights.length !== raw.dimensions) return null;
    return { ...raw, weights };
  } catch {
    return null;
  }
}

export const encodeWeights = (weights) => Buffer.from(Float32Array.from(weights).buffer).toString("base64");

// → p(yuk e'loni) 0..1
export function embedScore(model, vector) {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * vector[i];
  return 1 / (1 + Math.exp(-z));
}

// fastLook balli embedding so'rashga arziydimi (ikkilangan joy)
export const needsEmbedding = (score, { lo, hi }) => Number.isFinite(score) && score > lo && score < hi;

// → true = yuk e'loni
export const mixedIsLoad = (fastScore, p, { w, t }) => (1 - w) * logit(fastScore) + w * logit(p) > t;
