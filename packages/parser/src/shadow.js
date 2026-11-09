// Qoidaviy parserni (src/rules) AI natijalariga solishtirish — «sinov rejimi». Hech kimga hech narsa yuborilmaydi.
//
// Ishlatish (YukPlatform papkasida):
//   npm run parse:rules                       — bazadagi (data/yuk.db) AI tahlil qilgan hamma e'lon + gold
//   npm run parse:rules -- --days 3           — faqat oxirgi 3 kun
//   npm run parse:rules -- --examples 20      — farq qilgan e'lonlardan 20 tasini ko'rsatish (telefonlar yashirilgan)
//   npm run parse:rules -- --examples 10 --diff "mashina turi: AI fura"  — faqat shu farqdagi misollar
//   npm run parse:rules -- --max-unknown 1    — «ishonchli» uchun nechta noma'lum so'zga chidash (standart 2)
//   YUK_DB=data/nusxa.db npm run parse:rules  — boshqa baza
//
// Bazadagi AI natijasi to'liq emas: bot faqat YANGI (takror bo'lmagan) va doiradagi yuklarni saqlaydi. Shuning uchun:
//   - e'lon «Boshqa yo'nalish» bilan yopilgan bo'lsa — AI hamma yukini doiradan tashqari degan;
//   - xato matni "boshqa" — AI e'lonni yuk emas degan;
//   - yuklari saqlanmagan bo'lsa — hammasi takror bo'lgan: qoidaning yuki kaliti (dedupe.js) bazada bormi, shu tekshiriladi.
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bodyId, loadKeys, routeInScope, sameArea, truckFamily } from "@yuk/shared";
import { evaluate } from "./eval.js";
import { maskPhones } from "./phones.js";
import { splitPosts } from "./posts.js";
import { parseByRules } from "./rules/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Haydovchini tanlashga ta'sir qiladigan maydonlar (match.js): ular bir xil bo'lsa, yuk o'sha haydovchilarga boradi
const DECISION = {
  "qayerdan (viloyat)": (a, b) => sameArea(a.fromRegion, b.fromRegion) || (!a.fromRegion && !b.fromRegion) || (a.fromRegion === "xorij" && a.fromCountry === b.fromCountry),
  "qayerga (viloyat)": (a, b) => sameArea(a.toRegion, b.toRegion) || (!a.toRegion && !b.toRegion) || (a.toRegion === "xorij" && a.toCountry === b.toCountry),
  "mashina turi": (a, b) => (a.truckClass ? truckFamily(a.truckClass) : null) === (b.truckClass ? truckFamily(b.truckClass) : null),
  kuzov: (a, b) => bodyId(a.bodyType) === bodyId(b.bodyType),
  "og'irlik": (a, b) => (a.weightT ?? null) === (b.weightT ?? null) || Math.abs((a.weightT ?? 0) - (b.weightT ?? 0)) < 0.01,
  hajm: (a, b) => (a.volumeM3 ?? null) === (b.volumeM3 ?? null),
  "yuklash tomoni": (a, b) => [...(a.loadingSides ?? [])].sort().join() === [...(b.loadingSides ?? [])].sort().join(),
};
// Farq qilganda nima farq qildi: "mashina turi: AI fura · qoida —"
const SHOW = {
  "qayerdan (viloyat)": (l) => (l.fromRegion === "xorij" ? l.fromCountry : l.fromRegion),
  "qayerga (viloyat)": (l) => (l.toRegion === "xorij" ? l.toCountry : l.toRegion),
  "mashina turi": (l) => (l.truckClass ? truckFamily(l.truckClass) : null),
  kuzov: (l) => (l.bodyType ? bodyId(l.bodyType) : null),
  "og'irlik": (l) => l.weightT,
  hajm: (l) => l.volumeM3,
  "yuklash tomoni": (l) => (l.loadingSides ?? []).join("/") || null,
};
// Faqat ko'rinish (xabar matni): moslashga ta'sir qilmaydi
const DISPLAY = {
  "shahar (qayerdan)": (a, b) => norm(a.fromCity) === norm(b.fromCity),
  "shahar (qayerga)": (a, b) => norm(a.toCity) === norm(b.toCity),
  narx: (a, b) => (a.price ?? null) === (b.price ?? null),
};
// E'londa mashina sinfi / kuzovi yozilmagan (qoida — bo'sh), AI esa o'zi taxmin qilgan ("Plashatka kerak" → fura,
// "Kamaz kk" → samosval). AI ko'rsatmasi buni taqiqlaydi: aytilmagan maydon bo'sh bo'lishi kerak (moslashda cheklov yo'q)
const GUESS_ROW = "HAMMASI MOS (AI taxminisiz)";
const aiGuessed = (name, ruleLoad) => (name === "mashina turi" && !ruleLoad.truckClass) || (name === "kuzov" && !ruleLoad.bodyType);
const norm = (v) => (v == null ? null : String(v).toLowerCase().replace(/[ʻʼ’‘`']/g, ""));

// Har bir AI yukiga yo'nalishi eng mos qoida yukini topadi
function pairLoads(aiLoads, ruleLoads) {
  const used = new Set();
  return aiLoads.map((ai) => {
    let best = -1;
    let bestScore = -1;
    ruleLoads.forEach((rule, j) => {
      if (used.has(j)) return;
      const score = Number(DECISION["qayerdan (viloyat)"](ai, rule)) + Number(DECISION["qayerga (viloyat)"](ai, rule));
      if (score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best < 0) return null;
    used.add(best);
    return ruleLoads[best];
  });
}

const pct = (part, total) => (total ? `${((part / total) * 100).toFixed(1)}%` : "—");
const row = (label, part, total) => `  ${label.padEnd(34)} ${String(part).padStart(6)}  ${pct(part, total).padStart(6)}`;

// AI 2026-11-07 14:22 dan beri sxema v3 bilan ishlaydi (kamaz, konteyner, skotovoz alohida). Undan oldingi natijalar
// eski qoidada (kamaz → mini_fura) — ular bilan solishtirish soxta farq beradi. --all — hammasi
const SCHEMA_V3_AT = Date.parse("2026-11-07T14:30:00+05:00");

function readDb(file, { days, all }) {
  const db = new DatabaseSync(file, { readOnly: true });
  const since = Math.max(days ? Date.now() - days * 86_400_000 : 0, all ? 0 : SCHEMA_V3_AT);
  // 2026-11-09 dan bot oddiy e'lonlarni qoidaviy parser bilan hal qiladi (posts.parsed_by = 'rules'): ularda AI natijasi yo'q,
  // qoida o'zi bilan solishtirilmasin. Takror kalitlari ham faqat AI yozgan yuklardan
  const hasParsedBy = db.prepare("PRAGMA table_info(posts)").all().some((c) => c.name === "parsed_by");
  const aiOnly = hasParsedBy ? "AND (parsed_by IS NULL OR parsed_by != 'rules')" : "";
  const posts = db
    .prepare(`SELECT id, source, link, text, error FROM posts WHERE status = 'done' AND created_at > ? AND (error IS NULL OR error NOT LIKE 'Eskirgan%') ${aiOnly} ORDER BY id`)
    .all(since);
  const loads = db
    .prepare(`SELECT post_id, key, kind, data FROM loads WHERE created_at > ? AND post_id IN (SELECT id FROM posts WHERE 1 ${aiOnly})`)
    .all(since - 3 * 86_400_000);
  db.close();
  const byPost = new Map();
  const keys = new Set();
  for (const l of loads) {
    keys.add(l.key.replace(/#\d+$/, ""));
    const list = byPost.get(l.post_id) ?? [];
    list.push({ kind: l.kind ?? "yuk", ...JSON.parse(l.data) });
    byPost.set(l.post_id, list);
  }
  return { posts: posts.map((p) => ({ ...p, loads: byPost.get(p.id) ?? [] })), keys };
}

// AI nima degan: boshqa | doiradan tashqari | yuk (yuklari bilan) | mashina | takror (yuklari saqlanmagan)
function aiVerdict(post) {
  if (post.error?.startsWith("Boshqa yo'nalish")) return "scope";
  if (post.error) return post.error === "mashina_bor" ? "mashina" : "boshqa";
  if (!post.loads.length) return "dup";
  return post.loads.some((l) => l.kind === "mashina") ? "mashina" : "yuk";
}

async function compareDb(args) {
  const file = path.resolve(ROOT, process.env.YUK_DB ?? "data/yuk.db");
  const { posts, keys } = readDb(file, { days: Number(args.days) || 0, all: args.all });
  const options = { maxUnknown: Number(args["max-unknown"] ?? 2) };
  const started = performance.now();
  const results = posts.map((post) => ({ post, ai: aiVerdict(post), rule: parseByRules(post.text, options) }));
  const ms = performance.now() - started;

  const stats = { service: {}, drop: {}, send: {} };
  const fields = Object.fromEntries([...Object.keys(DECISION), "HAMMASI MOS", GUESS_ROW, ...Object.keys(DISPLAY)].map((k) => [k, { ok: 0, total: 0 }]));
  const reasons = new Map();
  const unknownWords = new Map();
  const suspectWords = new Map();
  const numberWords = new Map();
  const tally = (map, list) => {
    for (const item of list ?? []) map.set(item, (map.get(item) ?? 0) + 1);
  };
  const diffs = [];
  const fieldDiffs = new Map();
  const count = (bucket, key) => (bucket[key] = (bucket[key] ?? 0) + 1);

  for (const r of results) {
    const { rule, ai } = r;
    if (!rule.confident) {
      for (const reason of rule.reasons) {
        const key = reason.replace(/:.*$/, "").replace(/^\d+ ta /, "N ta ");
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
      tally(unknownWords, rule.unknown);
      tally(suspectWords, rule.suspects);
      tally(numberWords, (rule.numbers ?? []).map((n) => n.replace(/^\d+(?:[.,]\d+)?/, "N")));
      continue;
    }
    if (rule.service) {
      count(stats.service, ai);
      if (ai !== "boshqa") diffs.push({ ...r, why: `xizmat xabari deb topildi, AI: ${ai}` });
      continue;
    }
    const inScope = rule.loads.filter((l) => routeInScope(l));
    if (!inScope.length) {
      count(stats.drop, ai);
      if (ai === "yuk") diffs.push({ ...r, why: "qoida: doiradan tashqari, AI: doiradagi yuk" });
      continue;
    }
    count(stats.send, ai);
    if (ai === "yuk") {
      const aiLoads = r.post.loads.filter((l) => routeInScope(l));
      const paired = pairLoads(aiLoads, inScope);
      let allOk = true;
      const why = [];
      paired.forEach((ruleLoad, i) => {
        const aiLoad = aiLoads[i];
        let loadOk = Boolean(ruleLoad);
        let guessOk = Boolean(ruleLoad);
        for (const [name, same] of Object.entries(DECISION)) {
          const ok = Boolean(ruleLoad) && same(aiLoad, ruleLoad);
          fields[name].total++;
          if (ok) fields[name].ok++;
          else if (ruleLoad) {
            const key = `${name}: AI ${SHOW[name](aiLoad) ?? "—"} · qoida ${SHOW[name](ruleLoad) ?? "—"}`;
            fieldDiffs.set(key, (fieldDiffs.get(key) ?? 0) + 1);
            why.push(key);
          }
          loadOk &&= ok;
          guessOk &&= ok || aiGuessed(name, ruleLoad);
        }
        for (const [name, same] of Object.entries(DISPLAY)) {
          fields[name].total++;
          if (ruleLoad && same(aiLoad, ruleLoad)) fields[name].ok++;
        }
        fields["HAMMASI MOS"].total++;
        if (loadOk) fields["HAMMASI MOS"].ok++;
        fields[GUESS_ROW].total++;
        if (guessOk) fields[GUESS_ROW].ok++;
        allOk &&= loadOk;
      });
      if (!allOk) diffs.push({ ...r, why: why.join("; ") || "yuk juftlanmadi" });
    } else if (ai === "dup") {
      // AI yuklari takror bo'lgani uchun saqlanmagan: qoida yukining kaliti bazada bo'lsa — AI ham xuddi shunday tushungan
      const found = loadKeys(inScope).some((key) => keys.has(key.replace(/#\d+$/, "")));
      count(stats.send, found ? "dup: kaliti bazada bor (mos)" : "dup: kaliti topilmadi");
    } else {
      diffs.push({ ...r, why: `qoida: yuk, AI: ${ai}` });
    }
  }

  const total = results.length;
  const confident = results.filter((r) => r.rule.confident).length;
  console.log(`Baza: ${path.relative(ROOT, file)} — AI tahlil qilgan ${total} ta e'lon${args.days ? ` (oxirgi ${args.days} kun)` : ""}`);
  console.log(`Qoidaviy parser: ${ms.toFixed(0)} ms jami, ${(ms / total).toFixed(2)} ms bitta e'longa\n`);
  console.log(row("Ishonchli (AI'siz hal bo'lardi)", confident, total));
  const section = (title, bucket) => {
    const n = Object.values(bucket).reduce((a, b) => a + b, 0);
    console.log(row(title, n, total));
    for (const [ai, k] of Object.entries(bucket).sort((a, b) => b[1] - a[1])) console.log(`      AI: ${ai.padEnd(30)} ${String(k).padStart(6)}  ${pct(k, n).padStart(6)}`);
  };
  section("  xizmat xabari (boshqa)", stats.service);
  section("  doiradan tashqari yo'nalish", stats.drop);
  section("  doiradagi yuk — haydovchiga", stats.send);
  console.log(row("Ishonchsiz → AI", total - confident, total));

  console.log("\nDoiradagi yuklar, AI ham yuk degan e'lonlar: maydonlar AI bilan bir xilmi");
  for (const [name, f] of Object.entries(fields)) {
    if (name === GUESS_ROW) console.log("  — AI e'londa yo'q sinf/kuzovni o'zi qo'shgan farqlarni hisobga olmasa:");
    if (name === "shahar (qayerdan)") console.log("  — faqat ko'rinish (moslashga ta'sir qilmaydi):");
    console.log(row(name, f.ok, f.total));
  }

  console.log("\nEng ko'p farqlar (AI · qoida). «—» = e'londa aytilmagan, moslashda cheklov yo'q:");
  for (const [key, n] of [...fieldDiffs].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top ?? 25))) console.log(`  ${String(n).padStart(5)}  ${key}`);

  console.log("\nNega ishonchsiz (bitta e'londa bir nechta sabab bo'lishi mumkin):");
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(row(reason, n, total));
  const top = (map, n) => "  " + [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w, k]) => `${w} ${k}`).join(", ");
  console.log("\nEng ko'p uchragan noma'lum so'zlar (lug'atga qo'shish uchun):");
  console.log(top(unknownWords, Number(args.top ?? 60)));
  console.log("\nNoma'lum joyga o'xshagan so'zlar (-dan / -ga):");
  console.log(top(suspectWords, Number(args.top ?? 60)));
  console.log("\nTushunilmagan sonlar (N + keyingi so'z):");
  console.log(top(numberWords, Number(args.top ?? 40)));

  const show = Number(args.examples ?? 0);
  if (show) {
    console.log(`\nFarqlar (${diffs.length} ta, ${show} tasi; telefonlar yashirilgan):`);
    const picked = args.diff ? diffs.filter((d) => d.why.includes(args.diff)) : diffs;
    for (const d of picked.slice(0, show)) {
      console.log(`\n#${d.post.id} ${d.post.source} — ${d.why}`);
      console.log("  " + maskPhones(d.post.text).slice(0, 300).replace(/\n+/g, " ⏎ "));
      const brief = (l) => `${l.fromCity ?? "?"}/${l.fromRegion ?? "?"} → ${l.toCity ?? "?"}/${l.toRegion ?? "?"} | ${l.truckClass ?? "-"} ${l.bodyType ?? "-"} | ${l.weightT ?? "-"} t | ${l.volumeM3 ?? "-"} kub | ${(l.loadingSides ?? []).join("/") || "-"}`;
      for (const l of d.post.loads) console.log(`  AI:    ${brief(l)}`);
      for (const l of d.rule.loads) console.log(`  qoida: ${brief(l)}`);
    }
  }
}

// Qo'lda tekshirilgan gold.jsonl: qoida ishonchli degan e'lonlarda aniqligi qanday
async function compareGold() {
  const goldFile = path.join(ROOT, "data/samples/gold.jsonl");
  let gold;
  let posts;
  try {
    gold = (await readFile(goldFile, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    posts = splitPosts(await readFile(path.join(ROOT, "data/samples/elonlar.txt"), "utf8"));
  } catch {
    return;
  }
  const results = gold.map((g) => {
    const text = posts[g.index - 1];
    const r = parseByRules(text);
    return { index: g.index, text, ok: true, confident: r.confident, postType: r.postType, loads: r.loads };
  });
  const sure = results.filter((r) => r.confident);
  const goldSure = gold.filter((g) => sure.some((r) => r.index === g.index));
  console.log(`\nGold (qo'lda tekshirilgan ${gold.length} ta e'lon): qoida ${sure.length} tasini ishonchli dedi`);
  if (!sure.length) return;
  const report = evaluate(goldSure, sure);
  for (const [field, f] of Object.entries(report.fields)) console.log(row(field, f.ok, f.total));
  for (const m of report.mismatches.slice(0, 10)) console.log(`    #${m.index}${m.load ? `.${m.load}` : ""} ${m.field}: kutilgan ${JSON.stringify(m.expected)}, chiqdi ${JSON.stringify(m.actual)}`);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      days: { type: "string" },
      all: { type: "boolean", default: false },
      examples: { type: "string" },
      top: { type: "string" },
      "max-unknown": { type: "string" },
      diff: { type: "string" },
    },
  });
  await compareDb(args);
  await compareGold();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
