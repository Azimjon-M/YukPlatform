// «Yuk e'loni / e'lon emas» modelini o'rgatadi va src/rules/loadModel.js ni qayta yozadi (2026-11-19).
// Ishlatish (repo ildizidan): node packages/parser/scripts/train-loadlike.mjs [kunlar=22] [xatolardan nechta ko'rsatilsin=0]
//   TRAIN_CACHE=/yo'l/fayl.json — belgilar keshi (qayta o'rgatishni tezlatadi; faylda matn bor — repoga qo'ymang)
// Manba: bazadagi AI va qoidalar tahlil qilgan e'lonlar (faqat o'qiladi). Yorliq: yuk e'loni (yuk, doiradan tashqari yuk) = 1,
// bo'sh mashina / boshqa / xizmat xabari = 0. AI yorliqlari shovqinli, shuning uchun aniq andozalar bilan tuzatiladi:
// «yuk olamiz», «yuramiz», taksi (FREE_TRUCK / CHATTER) → 0; «mashina» deb yorliqlangan, lekin «fura kerak / yuk bor» li → 1.
// Oxirgi 48 soat — sinov to'plami (o'rgatishga kirmaydi). Natija: aniqlik, yukni yo'qotish va e'lon emasni o'tkazish ulushi.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { fastFacts } from "../src/rules/index.js";
import { BUCKETS, featuresOf } from "../src/rules/loadlike.js";

const days = Number(process.argv[2] ?? 22);
const showErrors = Number(process.argv[3] ?? 0);
const db = new DatabaseSync(process.env.YUK_DB ?? new URL("../../../data/yuk.db", import.meta.url).pathname, { readOnly: true });
const now = Date.now();
const since = now - days * 86400e3;
const testFrom = now - 48 * 3600e3;

function collect() {
  const posts = db
    .prepare("SELECT id, text, text_key, error, parsed_by, created_at FROM posts INDEXED BY posts_created WHERE created_at > ? AND parsed_by IN ('ai','rules') AND status = 'done' AND direct IS NULL")
    .all(since);
  const kinds = new Map();
  for (const l of db.prepare("SELECT l.post_id, l.kind FROM loads l JOIN posts p ON p.id = l.post_id WHERE p.created_at > ?").all(since)) {
    const set = kinds.get(l.post_id) ?? kinds.set(l.post_id, new Set()).get(l.post_id);
    set.add(l.kind);
  }
  const seen = new Set();
  const out = [];
  for (const p of posts) {
    if (seen.has(p.text_key)) continue; // bir xil matn — bitta
    seen.add(p.text_key);
    const k = kinds.get(p.id);
    let type;
    if (k?.has("yuk")) type = "yuk";
    else if (k?.has("mashina")) type = "mashina";
    else if (p.error === "boshqa") type = "boshqa";
    else if (/^Boshqa yo'nalish/.test(p.error ?? "")) type = "tashqi";
    else if (p.parsed_by === "rules" && p.error == null) type = "qoida"; // xizmat xabari YOKI takror yuk (yuk yozuvi yo'q) — pastda ajratiladi
    else continue;
    out.push({ id: p.id, text: p.text, type, by: p.parsed_by, test: p.created_at > testFrom });
  }
  return out;
}

let rows;
const cache = process.env.TRAIN_CACHE;
if (cache && fs.existsSync(cache)) rows = JSON.parse(fs.readFileSync(cache));
else {
  rows = collect();
  console.error(`e'lonlar ${rows.length} — belgilar hisoblanyapti…`);
  let n = 0;
  for (const r of rows) {
    const f = fastFacts(r.text);
    r.flags = f.flags;
    r.masked = f.masked;
    if (++n % 10000 === 0) console.error(n);
  }
  if (cache) fs.writeFileSync(cache, JSON.stringify(rows));
}

// Qoidalar o'qigan, yuk yozuvi yo'q e'lon: xizmat xabari bo'lsa — «boshqa»; aks holda takror yuk (yorlig'i noaniq) — olinmaydi
rows = rows.filter((r) => r.type !== "qoida" || r.flags.service);
for (const r of rows) if (r.type === "qoida") r.type = "boshqa";

// Yorliq (shovqin tuzatilgan)
for (const r of rows) {
  const f = r.flags;
  let y = r.type === "yuk" || r.type === "tashqi" ? 1 : 0;
  if (y === 1 && (f.free || f.junk || f.service)) y = 0;
  if (r.type === "mashina" && f.sure && !f.free && !f.junk) y = 1;
  r.y = y;
  r.x = featuresOf(r.masked, f);
}
const train = rows.filter((r) => !r.test);
const test = rows.filter((r) => r.test);
const count = (list) => `${list.length} (yuk ${list.filter((r) => r.y).length}, emas ${list.filter((r) => !r.y).length})`;
console.log(`o'rgatish ${count(train)} · sinov ${count(test)}`);

// Logistik regressiya, Adagrad, L2. Sinflar teng tortiladi (e'lon emaslar kam)
const w = new Float64Array(BUCKETS);
const g2 = new Float64Array(BUCKETS).fill(1e-8);
let bias = 0;
let gb = 1e-8;
const pos = train.filter((r) => r.y).length;
const weightOf = (y) => (y ? train.length / (2 * pos) : train.length / (2 * (train.length - pos)));
const LR = 0.3;
const L2 = 2e-6;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let epoch = 0; epoch < 12; epoch++) {
  for (let i = train.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [train[i], train[j]] = [train[j], train[i]];
  }
  for (const r of train) {
    let z = bias;
    for (const k of r.x) z += w[k];
    const p = 1 / (1 + Math.exp(-z));
    const grad = (p - r.y) * weightOf(r.y);
    for (const k of r.x) {
      const g = grad + L2 * w[k];
      g2[k] += g * g;
      w[k] -= (LR * g) / Math.sqrt(g2[k]);
    }
    gb += grad * grad;
    bias -= (LR * grad) / Math.sqrt(gb);
  }
}

// int8 ga siqish
let max = 0;
for (const v of w) max = Math.max(max, Math.abs(v));
const scale = max / 127;
const q = new Int8Array(BUCKETS);
for (let i = 0; i < BUCKETS; i++) q[i] = Math.round(w[i] / scale);
const score = (r) => {
  let z = bias;
  for (const k of r.x) z += q[k] * scale;
  return 1 / (1 + Math.exp(-z));
};

function report(list, threshold, name) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of list) {
    const yes = score(r) >= threshold;
    if (yes && r.y) tp++;
    else if (!yes && !r.y) tn++;
    else if (yes) fp++;
    else fn++;
  }
  const pct = (a, b) => ((100 * a) / (b || 1)).toFixed(1);
  console.log(
    `${name} @${threshold}: aniqlik ${pct(tp + tn, list.length)}% | yuk e'lonidan yo'qotildi ${pct(fn, tp + fn)}% (${fn}) | e'lon emasdan o'tib ketdi ${pct(fp, fp + tn)}% (${fp}) | o'tganlar ichida yuk ${pct(tp, tp + fp)}%`,
  );
}
for (const t of [0.3, 0.4, 0.5, 0.6]) report(test, t, "sinov");
report(train, 0.5, "o'rgatish");
const threshold = Number(process.env.THRESHOLD ?? 0.5);

if (showErrors) {
  const mask = (t) => t.replace(/\s+/g, " ").slice(0, 150);
  const wrong = test.map((r) => ({ r, p: score(r) })).filter(({ r, p }) => p >= threshold !== Boolean(r.y));
  const step = Math.max(1, Math.floor(wrong.length / showErrors));
  for (let i = 0; i < wrong.length; i += step) console.log(`  [${wrong[i].r.type} y=${wrong[i].r.y} p=${wrong[i].p.toFixed(2)}] ${mask(wrong[i].r.masked)}`);
}

if (process.env.DRY !== "1") {
  const text = `// scripts/train-loadlike.mjs yasaydi — qo'lda tahrirlanmaydi. ${new Date().toISOString().slice(0, 10)}: ${train.length} e'londa o'rgatildi.
// weights — 2^16 ta int8 vazn (base64); xeshlangan belgilar (loadlike.js featuresOf), so'zlarning o'zi yo'q
export const MODEL = {
  bias: ${bias.toFixed(5)},
  scale: ${scale.toFixed(7)},
  threshold: ${threshold},
  weights:
    "${Buffer.from(q.buffer).toString("base64")}",
};
`;
  fs.writeFileSync(new URL("../src/rules/loadModel.js", import.meta.url), text);
  console.log("yozildi: src/rules/loadModel.js", Math.round(text.length / 1024), "KB");
}
