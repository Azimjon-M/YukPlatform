// fastLook + embedding aralashmasi uchun modelni o'rgatadi → data/embed-model.json (apps/bot embedLook.js o'qiydi). 2026-11-23.
// Ishlatish (repo ildizidan): node --env-file=.env packages/parser/scripts/train-embed.mjs [o'quv=10000]
//   EMBED_TASK (standart Classification), EMBED_DIM (768)
// Yorliqlar: AI tahlil qilgan e'lonlar (20.11 gacha; train-loadlike.mjs bilan bir xil shovqin tuzatish). Vaqt bo'yicha:
// AI'ning oxirgi 48 soati — sinov (fastLook modeli ham buni ko'rmagan), undan oldingi `o'quv` ta noyob e'lon — o'quv.
// Sinovning birinchi yarmida aralashma og'irligi w va chegara t tanlanadi, ikkinchi yarmida tekshiriladi (o'z-o'zini aldamaslik).
// Vektorlar keshi data/embed-cache-<task>-<dim>.json (matn xeshi → vektor; matnning o'zi yo'q) — qayta o'rgatish API'ga
// faqat yangi matnlar uchun boradi. Bazadan faqat o'qiladi. Kalit: ONEPRO_EMBED_API_KEY.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { fastFacts, fastLook } from "../src/rules/index.js";
import { createEmbedder, embedScore, embedSignature, encodeWeights, logit, needsEmbedding, textHash } from "../src/embed.js";

const ROOT = new URL("../../../", import.meta.url).pathname;
const TRAIN_N = Number(process.argv[2] ?? 10000);
const task = process.env.EMBED_TASK ?? "Classification";
const dimensions = Number(process.env.EMBED_DIM ?? 768);
const db = new DatabaseSync(process.env.YUK_DB ?? `${ROOT}data/yuk.db`, { readOnly: true });

// --- Yorliqli e'lonlar ---
const aiEnd = db.prepare("SELECT MAX(created_at) AS t FROM posts WHERE parsed_by = 'ai' AND direct IS NULL").get().t;
const testFrom = aiEnd - 48 * 3600e3;
const since = testFrom - 10 * 864e5;
const posts = db
  .prepare("SELECT id, text, text_key, error, parsed_by, created_at FROM posts INDEXED BY posts_created WHERE created_at > ? AND parsed_by IN ('ai','rules') AND status = 'done' AND direct IS NULL ORDER BY created_at")
  .all(since);
const kinds = new Map();
for (const l of db.prepare("SELECT l.post_id, l.kind FROM loads l JOIN posts p ON p.id = l.post_id WHERE p.created_at > ?").all(since)) {
  (kinds.get(l.post_id) ?? kinds.set(l.post_id, new Set()).get(l.post_id)).add(l.kind);
}
const seen = new Set();
const rows = [];
for (const p of posts) {
  if (p.created_at > aiEnd || seen.has(p.text_key)) continue;
  seen.add(p.text_key);
  const k = kinds.get(p.id);
  let type;
  if (k?.has("yuk")) type = "yuk";
  else if (k?.has("mashina")) type = "mashina";
  else if (p.error === "boshqa") type = "boshqa";
  else if (/^Boshqa yo'nalish/.test(p.error ?? "")) type = "tashqi";
  else if (p.parsed_by === "rules" && p.error == null) type = "qoida";
  else continue;
  const { flags } = fastFacts(p.text);
  if (type === "qoida") {
    if (!flags.service) continue; // xizmat xabari — e'lon emas; qolgani (takror yuk) yorlig'i noaniq
    type = "boshqa";
  }
  let y = type === "yuk" || type === "tashqi" ? 1 : 0;
  if (y === 1 && (flags.free || flags.junk || flags.service)) y = 0;
  if (type === "mashina" && flags.sure && !flags.free && !flags.junk) y = 1;
  rows.push({ text: p.text, y, at: p.created_at, by: p.parsed_by });
  if (p.created_at > testFrom) rows.at(-1).fast = fastLook(p.text);
}
const test = rows.filter((r) => r.at > testFrom && r.by === "ai");
const train = rows.filter((r) => r.at <= testFrom).slice(-TRAIN_N);
console.log(`o'quv ${train.length} (yuk ${train.filter((r) => r.y).length}) · sinov ${test.length} (yuk ${test.filter((r) => r.y).length})`);

// --- Vektorlar (kesh bilan) ---
const cacheFile = `${ROOT}data/embed-cache-${task}-${dimensions}.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const embedder = createEmbedder({ apiKey: process.env.ONEPRO_EMBED_API_KEY, task, dimensions, timeoutMs: 60_000, breakerFailures: 1000 });
async function vectorsOf(list) {
  const need = [...new Map(list.map((r) => [textHash(r.text), r.text])).entries()].filter(([h]) => !cache[h]);
  for (let i = 0; i < need.length; i += 64) {
    const part = need.slice(i, i + 64);
    let vecs = null;
    for (let attempt = 0; attempt < 8 && !vecs; attempt++) {
      vecs = await embedder.embed(part.map(([, t]) => t));
      if (!vecs) await new Promise((r) => setTimeout(r, Math.min(120_000, 2000 * 2 ** attempt)));
    }
    if (!vecs) throw new Error(`1pro javob bermadi: ${embedder.stats.lastError}`);
    part.forEach(([h], j) => (cache[h] = Array.from(vecs[j], (v) => +v.toFixed(5))));
    if ((i / 64) % 25 === 0) {
      console.error(`vektor ${i + part.length}/${need.length}`);
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return list.map((r) => Float32Array.from(cache[textHash(r.text)]));
}
const trV = await vectorsOf(train);
const teV = await vectorsOf(test);

// --- Logistik regressiya: belgilar standartlashtiriladi, Adam, mini-paket, L2, sinflar teng tortilgan.
// Oddiy gradient normallangan vektorda juda sekin yaqinlashadi (sinovda 85% — Adam bilan 88%). Standartlash oxirida vaznga singdiriladi
function fit(X, Y, { epochs = 40, lr = 0.01, l2 = 1e-4 } = {}) {
  const d = X[0].length;
  const mu = new Float64Array(d);
  const sd = new Float64Array(d);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => Float64Array.from(x, (v, j) => (v - mu[j]) / sd[j]));
  const w = new Float64Array(d);
  const m = new Float64Array(d);
  const v = new Float64Array(d);
  let b = 0, mb = 0, vb = 0, t = 0;
  const pos = Y.filter(Boolean).length;
  const wp = Y.length / (2 * pos);
  const wn = Y.length / (2 * (Y.length - pos));
  const idx = [...Y.keys()];
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let e = 0; e < epochs; e++) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let s = 0; s < idx.length; s += 64) {
      const part = idx.slice(s, s + 64);
      const g = new Float64Array(d);
      let gb = 0;
      for (const i of part) {
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
        const err = (1 / (1 + Math.exp(-z)) - Y[i]) * (Y[i] ? wp : wn);
        for (let j = 0; j < d; j++) g[j] += err * Z[i][j];
        gb += err;
      }
      t++;
      const c1 = 1 - 0.9 ** t;
      const c2 = 1 - 0.999 ** t;
      for (let j = 0; j < d; j++) {
        const gj = g[j] / part.length + l2 * w[j];
        m[j] = 0.9 * m[j] + 0.1 * gj;
        v[j] = 0.999 * v[j] + 0.001 * gj * gj;
        w[j] -= (lr * (m[j] / c1)) / (Math.sqrt(v[j] / c2) + 1e-8);
      }
      const gbb = gb / part.length;
      mb = 0.9 * mb + 0.1 * gbb;
      vb = 0.999 * vb + 0.001 * gbb * gbb;
      b -= (lr * (mb / c1)) / (Math.sqrt(vb / c2) + 1e-8);
    }
  }
  // z = b + Σ w·(x − mu)/sd = (b − Σ w·mu/sd) + Σ (w/sd)·x
  let bias = b;
  const weights = new Float32Array(d);
  for (let j = 0; j < d; j++) {
    weights[j] = w[j] / sd[j];
    bias -= (w[j] * mu[j]) / sd[j];
  }
  return { bias, weights };
}
const { bias, weights } = fit(trV, train.map((r) => r.y));
const model = { kind: "logreg", signature: embedSignature({ dimensions, task }), dimensions, task, bias, weights };

// --- Sinov: yolg'iz embedding va aralashma (faqat fastLook ikkilangan e'lonlarda) ---
const pct = (a, b) => `${((100 * a) / (b || 1)).toFixed(1)}%`;
const items = test.map((r, i) => ({ y: r.y, look: r.fast, p: embedScore(model, teV[i]) }));
function evaluate(list, isLoad) {
  let ok = 0, lost = 0, passed = 0;
  for (const r of list) {
    const yes = isLoad(r);
    if (yes === Boolean(r.y)) ok++;
    else if (r.y) lost++;
    else passed++;
  }
  return { acc: ok / list.length, text: `${pct(ok, list.length)} (yuk yo'qoldi ${lost}, o'tib ketdi ${passed})` };
}
const band = { lo: 0.01, hi: 0.99 };
const fastOnly = (r) => !r.look.chatter;
const mixed = (w, t) => (r) => (needsEmbedding(r.look.score, band) ? (1 - w) * logit(r.look.score) + w * logit(r.p) > t : fastOnly(r));
const half = items.length >> 1;
const A = items.slice(0, half);
const B = items.slice(half);
let best = null;
for (const w of [0.2, 0.3, 0.4, 0.5]) for (const t of [-1, -0.5, 0, 0.5]) {
  const a = evaluate(A, mixed(w, t)).acc;
  if (!best || a > best.a) best = { w, t, a };
}
console.log(`yolg'iz embedding (@0.5): ${evaluate(items, (r) => r.p >= 0.5).text}`);
console.log(`faqat fastLook:            A ${evaluate(A, fastOnly).text} | B ${evaluate(B, fastOnly).text}`);
console.log(`aralashma w=${best.w} t=${best.t}: A ${evaluate(A, mixed(best.w, best.t)).text} | B ${evaluate(B, mixed(best.w, best.t)).text}`);
console.log(`embedding so'raladigan ulush: ${pct(items.filter((r) => needsEmbedding(r.look.score, band)).length, items.length)}`);

const out = {
  ...model,
  weights: encodeWeights(model.weights),
  recommended: { w: best.w, t: best.t, ...band },
  trainedAt: new Date().toISOString(),
  train: train.length,
  test: test.length,
};
fs.writeFileSync(`${ROOT}data/embed-model.json`, JSON.stringify(out));
console.log(`yozildi: data/embed-model.json (${model.signature})`);
