// E'lonlar faylini AI bilan tahlil qiladi va natijani JSONL faylga yozadi.
//
// Ishlatish (YukPlatform papkasida):
//   npm run parse                     — hamma e'lonlarni tahlil qilish
//   npm run parse -- --limit 10       — faqat birinchi 10 tasini (sinash uchun)
//   npm run parse -- --skip 120       — birinchi 120 tasini o'tkazib yuborish (limit tugaganda davom etish)
//   npm run parse -- --dry-run        — AI'siz: e'lonlarni sanaydi va telefonlarni ajratadi (bepul)
//   npm run parse -- --models         — kalitingiz bilan mavjud modellar ro'yxati
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { splitPosts } from "./posts.js";
import { extractPhones } from "./phones.js";
import { createParser, resolveSettings } from "./parse.js";

// ES modullarda __dirname yo'q, papkani import.meta.url dan topamiz
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values: args } = parseArgs({
  options: {
    file: { type: "string", default: path.join(ROOT, "data/samples/elonlar.txt") },
    out: { type: "string", default: path.join(ROOT, "data/samples/natija.jsonl") },
    limit: { type: "string" },
    skip: { type: "string", default: "0" },
    concurrency: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    models: { type: "boolean", default: false },
  },
});

// Bitta e'lon uchun daqiqalik limitni necha marta kutamiz; undan keyin limit kunlik deb hisoblanadi
const MAX_LIMIT_WAITS = 5;

const firstLine = (text) => text.split("\n")[0].slice(0, 60);
const percent = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : "—");

function requireKey(provider) {
  if (provider.keyEnv.some((name) => process.env[name])) return true;
  console.error(`${provider.keyEnv[0]} topilmadi (provayder: ${provider.id}).`);
  console.error(provider.keyHint);
  console.error("AI'siz tekshirish uchun: npm run parse -- --dry-run");
  process.exitCode = 1;
  return false;
}

async function main() {
  const { provider } = resolveSettings();

  if (args.models) {
    if (!requireKey(provider)) return;
    const parser = createParser();
    const names = await parser.provider.listModels(parser.client);
    console.log(`${provider.id} modellari (${names.length} ta):`);
    for (const name of names) console.log(`  ${name}`);
    console.log("\nTanlash: .env ga PARSER_MODEL=<nomi> deb yozing.");
    return;
  }

  const skip = Number(args.skip);
  let posts = splitPosts(await readFile(args.file, "utf8")).slice(skip);
  if (args.limit) posts = posts.slice(0, Number(args.limit));

  if (posts.length === 0) {
    console.error(`E'lon topilmadi: ${args.file}${skip ? ` (--skip ${skip} dan keyin)` : ""}`);
    console.error("Faylga e'lonlarni tashlang, har birining orasiga alohida qatorga --- qo'ying.");
    process.exitCode = 1;
    return;
  }

  if (args["dry-run"]) {
    dryRun(posts, skip);
    return;
  }

  if (!requireKey(provider)) return;
  const parser = createParser();
  const concurrency = Number(args.concurrency ?? provider.defaultConcurrency);
  const effortNote = provider.id === "claude" ? ` | effort: ${parser.effort}` : "";
  console.log(`${posts.length} ta e'lon | ${provider.id} | model: ${parser.model}${effortNote} | bir vaqtda: ${concurrency}\n`);

  const results = new Array(posts.length);
  let next = 0;
  let done = 0;
  let fatal = null;
  let pauseUntil = 0; // daqiqalik limit tugaganda hamma ishchi shu vaqtgacha birga kutadi
  const progress = (text) => process.stdout.write(`\r${text}`.padEnd(60));

  // Bir vaqtda bir nechta so'rov yuboramiz (concurrency), lekin hammasini birdaniga emas
  async function worker() {
    while (next < posts.length && !fatal) {
      const i = next++;
      const base = { index: skip + i + 1, text: posts[i] };
      for (let waits = 0; ; waits++) {
        if (pauseUntil > Date.now()) await sleep(pauseUntil - Date.now());
        if (fatal) return; // bu e'lon natijasiz qoladi va keyingi safar qayta yuboriladi
        try {
          results[i] = { ...base, ...(await parser.parse(posts[i])) };
          break;
        } catch (error) {
          // Daqiqalik limit: kutib, xuddi shu e'lonni qayta yuboramiz
          const wait = provider.retryAfterMs?.(error);
          if (wait != null && waits < MAX_LIMIT_WAITS) {
            if (Date.now() + wait > pauseUntil) {
              pauseUntil = Date.now() + wait;
              progress(`${done}/${posts.length} — daqiqalik limit, ${Math.round(wait / 1000)} s kutilmoqda...`);
            }
            continue;
          }
          if (provider.isFatal(error)) {
            fatal ??= error;
            return;
          }
          results[i] = { ...base, ok: false, error: provider.describeError(error) };
          break;
        }
      }
      done++;
      progress(`${done}/${posts.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n\n");

  // Ish to'xtab qolgan bo'lsa ham tayyor natijalar saqlanadi.
  // --skip bilan davom etilganda fayl ustidan yozilmaydi, oxiriga qo'shiladi.
  const finished = results.filter(Boolean);
  if (finished.length) {
    const lines = finished.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await (skip > 0 ? appendFile : writeFile)(args.out, lines, "utf8");
    printSummary(finished, provider);
    console.log(`\nNatija ${skip > 0 ? "qo'shildi" : "yozildi"}: ${args.out}`);
  }

  if (fatal) {
    const firstMissing = results.findIndex((r) => !r);
    console.error(`\nTo'xtadi: ${provider.describeError(fatal)}`);
    // Davom ettirish maslahati faqat ish qisman bajarilganda foydali (masalan, kunlik limit tugaganda)
    if (firstMissing >= 0 && finished.length) {
      console.error(`Davom ettirish: npm run parse -- --skip ${skip + firstMissing}`);
    }
    process.exitCode = 1;
  }
}

function dryRun(posts, skip) {
  let withPhone = 0;
  posts.forEach((post, i) => {
    const phones = extractPhones(post);
    if (phones.length) withPhone++;
    console.log(`#${skip + i + 1} ${firstLine(post)}`);
    console.log(`    ${phones.length ? phones.join(", ") : "telefon topilmadi"}`);
  });
  console.log(`\n${posts.length} ta e'lon, telefon topilgani: ${withPhone} (${percent(withPhone, posts.length)})`);
  console.log("AI chaqirilmadi (--dry-run).");
}

function printSummary(results, provider) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const loads = ok.flatMap((r) => r.loads);

  const types = {};
  for (const r of ok) types[r.postType] = (types[r.postType] ?? 0) + 1;

  console.log("=== Natija ===");
  console.log(`E'lonlar: ${results.length} | muvaffaqiyatli: ${ok.length} | xato: ${failed.length}`);
  console.log(`Turlari: ${Object.entries(types).map(([type, n]) => `${type} ${n}`).join(", ") || "—"}`);
  console.log(`Yuklar: ${loads.length}`);
  if (loads.length) {
    const filled = (field) => percent(loads.filter((l) => l[field] !== null).length, loads.length);
    console.log(`  qayerdan (viloyat): ${filled("fromRegion")} | qayerga (viloyat): ${filled("toRegion")}`);
    console.log(`  mashina turi: ${filled("vehicle")} | og'irlik: ${filled("weightT")} | narx: ${filled("price")}`);
    console.log(`  telefon bor: ${percent(loads.filter((l) => l.phones.length).length, loads.length)}`);
  }

  console.log("\nNamunalar:");
  for (const r of ok.slice(0, 10)) {
    if (r.loads.length === 0) console.log(`#${r.index} [${r.postType}] ${firstLine(r.text)}`);
    for (const l of r.loads) {
      const from = `${l.fromCity ?? "?"} (${l.fromRegion ?? "?"})`;
      const to = `${l.toCity ?? "?"} (${l.toRegion ?? "?"})`;
      const weight = l.weightT === null ? "?" : `${l.weightT} t`;
      console.log(`#${r.index} [${r.postType}] ${from} → ${to} | ${l.vehicle ?? "?"} | ${weight} | ${l.phones.join(", ") || "tel yo'q"}`);
    }
  }

  if (failed.length) {
    console.log("\nXatolar:");
    for (const r of failed.slice(0, 5)) console.log(`#${r.index}: ${r.error}`);
  }

  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let costKnown = false;
  for (const r of results) {
    if (!r.usage) continue;
    for (const key of Object.keys(total)) total[key] += r.usage[key];
    const c = provider.cost(r.model, r.usage);
    if (c !== null) {
      cost += c;
      costKnown = true;
    }
  }
  console.log(
    `\nTokenlar: kirish ${total.input}, chiqish ${total.output}, keshdan o'qildi ${total.cacheRead}, keshga yozildi ${total.cacheWrite}`,
  );
  console.log(`Taxminiy narx: ${costKnown ? `$${cost.toFixed(4)}` : (provider.costNote ?? "noma'lum")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
