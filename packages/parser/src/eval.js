// Parser aniqligini o'lchash: AI natijasini qo'lda tekshirilgan "to'g'ri javoblar" (gold) bilan solishtiradi.
//
// Ishlatish (YukPlatform papkasida):
//   npm run parse:eval                                         — natija.jsonl ni gold.jsonl bilan solishtirish
//   npm run parse:eval -- --results eski.jsonl --results yangi.jsonl   — ikki natijani yonma-yon
//
// gold.jsonl: har qatorda { index, textStart, postType, loads: [{ maydon: kutilgan qiymat, ... }] }
// Faqat yozilgan maydonlar tekshiriladi. Fayl data/samples ichida (gitga tushmaydi: haqiqiy e'lonlar).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROUTE_FIELDS = ["fromCity", "fromRegion", "toCity", "toRegion"];

// Eski (1-versiya) natijada bitta "vehicle" maydoni bo'lgan — solishtirish uchun yangi ko'rinishga o'tkazamiz
const LEGACY_VEHICLE = {
  tent: { bodyType: "tent" }, ref: { bodyType: "ref" }, izoterm: { bodyType: "ref" }, ochiq: { bodyType: "ploshatka" },
  konteyner: { bodyType: "ploshatka" }, tral: { bodyType: "tral" }, samosval: { bodyType: "samosval" }, sisterna: { bodyType: "sisterna" },
  kamaz: { truckClass: "mini_fura" }, isuzu: { truckClass: "isuzu" }, gazel: { truckClass: "kichik" }, porter: { truckClass: "kichik" },
  labo: { truckClass: "labo" }, damas: { truckClass: "labo" },
};

export function upgradeLegacyLoad(load) {
  if (!("vehicle" in load) || "bodyType" in load) return load;
  const { vehicle, ...rest } = load;
  return { bodyType: null, truckClass: null, loadingSides: [], partial: false, ...rest, ...(LEGACY_VEHICLE[vehicle] ?? {}) };
}

// Solishtirish uchun: katta-kichik harf, apostrof turlari (ʻ ’ ` '), ortiqcha bo'sh joy farq qilmaydi
export function normalize(value) {
  if (typeof value === "string") return value.toLowerCase().replace(/[ʻʼ’‘`']/g, "'").replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return [...value].map(normalize).sort().join(",");
  return value ?? null;
}

export function sameValue(expected, actual) {
  if (actual === undefined) actual = Array.isArray(expected) ? [] : null;
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= Math.abs(expected) * 0.01;
  }
  return normalize(expected) === normalize(actual);
}

// Har bir kutilgan yukka eng mos (yo'nalishi bo'yicha) natija yukini topadi; har bir natija bir marta ishlatiladi
export function matchLoads(expectedLoads, actualLoads) {
  const used = new Set();
  return expectedLoads.map((expected) => {
    let best = -1;
    let bestScore = -1;
    actualLoads.forEach((actual, j) => {
      if (used.has(j)) return;
      const score = ROUTE_FIELDS.filter((f) => f in expected && sameValue(expected[f], actual[f])).length;
      if (score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best < 0) return null;
    used.add(best);
    return actualLoads[best];
  });
}

export function evaluate(goldPosts, results) {
  const byIndex = new Map(results.map((r) => [r.index, r]));
  const fields = {};
  const count = (field, ok) => {
    fields[field] ??= { ok: 0, total: 0 };
    fields[field].total += 1;
    if (ok) fields[field].ok += 1;
  };
  const mismatches = [];
  const warnings = [];

  for (const gold of goldPosts) {
    const result = byIndex.get(gold.index);
    if (result && gold.textStart && !result.text?.startsWith(gold.textStart)) {
      warnings.push(`#${gold.index}: e'lon matni gold bilan mos emas (elonlar.txt o'zgarganmi?)`);
    }
    const ok = Boolean(result?.ok);
    const actualLoads = ok ? (result.loads ?? []).map(upgradeLegacyLoad) : [];

    count("postType", ok && result.postType === gold.postType);
    if (ok && result.postType !== gold.postType) {
      mismatches.push({ index: gold.index, field: "postType", expected: gold.postType, actual: result.postType });
    }
    count("yuklar soni", ok && actualLoads.length === gold.loads.length);
    if (ok && actualLoads.length !== gold.loads.length) {
      mismatches.push({ index: gold.index, field: "yuklar soni", expected: gold.loads.length, actual: actualLoads.length });
    }

    const matched = matchLoads(gold.loads, actualLoads);
    gold.loads.forEach((expected, i) => {
      const actual = matched[i];
      for (const [field, value] of Object.entries(expected)) {
        const good = actual !== null && sameValue(value, actual[field]);
        count(field, good);
        if (!good) mismatches.push({ index: gold.index, load: i + 1, field, expected: value, actual: actual ? actual[field] : "(yuk topilmadi)" });
      }
    });
  }

  const totals = Object.values(fields).reduce((s, f) => ({ ok: s.ok + f.ok, total: s.total + f.total }), { ok: 0, total: 0 });
  return { fields, totals, mismatches, warnings };
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

const pct = ({ ok, total }) => (total ? `${Math.round((ok / total) * 100)}%`.padStart(4) + ` (${ok}/${total})` : "—");

async function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const { values: args } = parseArgs({
    options: {
      gold: { type: "string", default: path.join(ROOT, "data/samples/gold.jsonl") },
      results: { type: "string", multiple: true },
      details: { type: "boolean", default: false },
    },
  });
  // npm -w buyruqni paket papkasida ishga tushiradi; nisbiy yo'llar foydalanuvchi turgan papkaga nisbatan (INIT_CWD)
  const here = (file) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const files = args.results?.length ? args.results.map(here) : [path.join(ROOT, "data/samples/natija.jsonl")];
  const gold = await readJsonl(here(args.gold));
  const reports = [];
  for (const file of files) reports.push({ file, ...evaluate(gold, await readJsonl(file)) });

  console.log(`Gold: ${gold.length} ta e'lon, ${gold.reduce((n, g) => n + g.loads.length, 0)} ta yuk\n`);
  const fieldNames = [...new Set(reports.flatMap((r) => Object.keys(r.fields)))];
  const header = ["maydon".padEnd(14), ...reports.map((r) => path.basename(r.file).padEnd(18))].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const field of fieldNames) {
    console.log([field.padEnd(14), ...reports.map((r) => (r.fields[field] ? pct(r.fields[field]) : "—").padEnd(18))].join(" | "));
  }
  console.log("-".repeat(header.length));
  console.log([("JAMI").padEnd(14), ...reports.map((r) => pct(r.totals).padEnd(18))].join(" | "));

  for (const r of reports) {
    for (const w of r.warnings) console.log(`Ogohlantirish (${path.basename(r.file)}): ${w}`);
  }
  const last = reports.at(-1);
  const show = args.details ? last.mismatches : last.mismatches.slice(0, 25);
  if (show.length) {
    console.log(`\nXatolar (${path.basename(last.file)}, ${last.mismatches.length} ta${args.details ? "" : ", birinchi 25 tasi; hammasi: --details"}):`);
    for (const m of show) {
      const where = `#${m.index}${m.load ? `.${m.load}` : ""}`;
      console.log(`  ${where.padEnd(6)} ${m.field}: kutilgan ${JSON.stringify(m.expected)}, chiqdi ${JSON.stringify(m.actual)}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
