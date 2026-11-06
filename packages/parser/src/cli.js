// E'lonlar faylini AI bilan tahlil qiladi va natijani JSONL faylga yozadi.
//
// Ishlatish (YukPlatform papkasida):
//   npm run parse                     — hamma e'lonlarni tahlil qilish
//   npm run parse -- --limit 10       — faqat birinchi 10 tasini (sinash uchun)
//   npm run parse -- --skip 120       — birinchi 120 tasini o'tkazib yuborish (limit tugaganda davom etish)
//   npm run parse -- --only 3,27,38   — faqat shu raqamli e'lonlar; --only gold — gold.jsonl dagilar (limitni tejaydi)
//   npm run parse -- --batch 1        — har e'lon alohida so'rov (standart: PARSER_BATCH yoki 10 ta e'lon bitta so'rovda)
//   npm run parse -- --dry-run        — AI'siz: e'lonlarni sanaydi va telefonlarni ajratadi (bepul)
//   npm run parse -- --models         — kalitingiz bilan mavjud modellar ro'yxati
//   npm run parse -- --provider onepro [--model qwen3.8-flash] — .env dagi PARSER_PROVIDER o'rniga boshqa AI (gemini | onepro | claude)
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { splitPosts } from "./posts.js";
import { extractPhones } from "./phones.js";
import { createParser, resolveSettings } from "./parse.js";
import { DEFAULT_PROVIDER, getProvider } from "./providers/index.js";

// ES modullarda __dirname yo'q, papkani import.meta.url dan topamiz
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values: args } = parseArgs({
  options: {
    file: { type: "string", default: path.join(ROOT, "data/samples/elonlar.txt") },
    out: { type: "string", default: path.join(ROOT, "data/samples/natija.jsonl") },
    limit: { type: "string" },
    skip: { type: "string", default: "0" },
    only: { type: "string" },
    concurrency: { type: "string" },
    batch: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    models: { type: "boolean", default: false },
    provider: { type: "string" },
    model: { type: "string" },
  },
});
// npm -w buyruqni paket papkasida ishga tushiradi; nisbiy yo'llar foydalanuvchi turgan papkaga nisbatan (INIT_CWD)
const here = (file) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
args.file = here(args.file);
args.out = here(args.out);

// Bitta so'rov uchun daqiqalik limitni necha marta kutamiz; undan keyin limit kunlik deb hisoblanadi
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

// --provider berilsa — .env dagi PARSER_PROVIDER o'rniga; PARSER_MODEL boshqa provayderniki bo'lgani uchun
// u holda --model yoki o'sha provayderning standart modeli olinadi
function chosen() {
  const envProvider = process.env.PARSER_PROVIDER || DEFAULT_PROVIDER;
  const other = args.provider && args.provider !== envProvider;
  return { provider: args.provider, model: args.model || (other ? getProvider(args.provider).defaultModel : undefined) };
}

async function main() {
  const { provider } = resolveSettings(chosen());

  if (args.models) {
    if (!requireKey(provider)) return;
    const parser = createParser(chosen());
    const names = await parser.provider.listModels(parser.client);
    console.log(`${provider.id} modellari (${names.length} ta):`);
    for (const name of names) console.log(`  ${name}`);
    console.log("\nTanlash: .env ga PARSER_MODEL=<nomi> deb yozing.");
    return;
  }

  // Har bir e'lon fayldagi tartib raqami bilan: natijada ham shu raqam (index) saqlanadi
  const skip = Number(args.skip);
  const all = splitPosts(await readFile(args.file, "utf8")).map((text, i) => ({ index: i + 1, text }));
  let posts = all.slice(skip);
  if (args.only) {
    const wanted = await onlyIndexes(args.only);
    posts = all.filter((p) => wanted.has(p.index));
  }
  if (args.limit) posts = posts.slice(0, Number(args.limit));

  if (posts.length === 0) {
    console.error(`E'lon topilmadi: ${args.file}${skip ? ` (--skip ${skip} dan keyin)` : ""}`);
    console.error("Faylga e'lonlarni tashlang, har birining orasiga alohida qatorga --- qo'ying.");
    process.exitCode = 1;
    return;
  }

  if (args["dry-run"]) {
    dryRun(posts);
    return;
  }

  if (!requireKey(provider)) return;
  const parser = createParser({ ...chosen(), batchSize: args.batch });
  const concurrency = Number(args.concurrency ?? provider.defaultConcurrency);
  const batchSize = parser.batchSize;
  const effortNote = provider.id === "claude" ? ` | effort: ${parser.effort}` : "";
  console.log(
    `${posts.length} ta e'lon | ${provider.id} | model: ${parser.model}${effortNote} | bir so'rovda: ${batchSize} | bir vaqtda: ${concurrency}\n`,
  );

  const results = new Array(posts.length);
  let next = 0;
  let done = 0;
  let fatal = null;
  let pauseUntil = 0; // daqiqalik limit tugaganda hamma ishchi shu vaqtgacha birga kutadi
  const progress = (text) => process.stdout.write(`\r${text}`.padEnd(60));

  // Bir vaqtda bir nechta so'rov yuboramiz (concurrency), lekin hammasini birdaniga emas.
  // Har bir so'rovda batchSize ta e'lon (oxirgisida kamroq bo'lishi mumkin).
  async function worker() {
    while (next < posts.length && !fatal) {
      const start = next;
      next = Math.min(start + batchSize, posts.length);
      const chunk = posts.slice(start, next);
      const save = (k, result) => (results[start + k] = { index: chunk[k].index, text: chunk[k].text, ...result });
      for (let waits = 0; ; waits++) {
        if (pauseUntil > Date.now()) await sleep(pauseUntil - Date.now());
        if (fatal) return; // bu e'lonlar natijasiz qoladi va keyingi safar qayta yuboriladi
        try {
          (await parser.parseBatch(chunk.map((p) => p.text))).forEach((result, k) => save(k, result));
          break;
        } catch (error) {
          // Daqiqalik limit: kutib, xuddi shu e'lonlarni qayta yuboramiz
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
          chunk.forEach((_, k) => save(k, { ok: false, error: provider.describeError(error) }));
          break;
        }
      }
      done += chunk.length;
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
    if (firstMissing >= 0 && finished.length && !args.only) {
      console.error(`Davom ettirish: npm run parse -- --skip ${posts[firstMissing].index - 1}`);
    }
    process.exitCode = 1;
  }
}

// "--only 3,27,38" yoki "--only gold" (gold.jsonl dagi e'lonlar) → raqamlar to'plami
async function onlyIndexes(value) {
  if (value === "gold") {
    const text = await readFile(path.join(ROOT, "data/samples/gold.jsonl"), "utf8");
    return new Set(text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l).index));
  }
  return new Set(value.split(",").map((s) => Number(s.trim())).filter(Number.isInteger));
}

function dryRun(posts) {
  let withPhone = 0;
  posts.forEach(({ index, text }) => {
    const phones = extractPhones(text);
    if (phones.length) withPhone++;
    console.log(`#${index} ${firstLine(text)}`);
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
    // Qiymati bor yuklar ulushi: massiv bo'lsa — bo'sh emas, mantiqiy (true/false) bo'lsa — true
    const has = (value) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== false);
    const filled = (field) => percent(loads.filter((l) => has(l[field])).length, loads.length);
    console.log(`  qayerdan: viloyat ${filled("fromRegion")}, shahar ${filled("fromCity")} | qayerga: viloyat ${filled("toRegion")}, shahar ${filled("toCity")}`);
    console.log(`  mashina sinfi: ${filled("truckClass")} | kuzov: ${filled("bodyType")} | yuklash tomoni: ${filled("loadingSides")}`);
    console.log(`  og'irlik: ${filled("weightT")} | kub: ${filled("volumeM3")} | palet: ${filled("pallets")} | dogruz: ${filled("partial")}`);
    console.log(`  narx: ${filled("price")} | to'lov turi: ${filled("payment")} | kelishiladi: ${filled("negotiable")}`);
    console.log(`  telefon bor: ${percent(loads.filter((l) => l.phones.length).length, loads.length)}`);
  }

  console.log("\nNamunalar:");
  for (const r of ok.slice(0, 10)) {
    if (r.loads.length === 0) console.log(`#${r.index} [${r.postType}] ${firstLine(r.text)}`);
    for (const l of r.loads) {
      const from = `${l.fromCity ?? "?"} (${l.fromRegion ?? "?"})`;
      const to = `${l.toCity ?? "?"} (${l.toRegion ?? "?"})`;
      const weight = l.weightT === null ? "?" : `${l.weightT} t`;
      const vehicle = `${l.truckClass ?? "?"}/${l.bodyType ?? "?"}`;
      const price = l.price === null ? "narx ?" : `${l.price} ${l.currency ?? ""}/${l.priceUnit ?? "?"}`;
      console.log(`#${r.index} [${r.postType}] ${from} → ${to} | ${vehicle} | ${weight} | ${price} | ${l.phones.join(", ") || "tel yo'q"}`);
    }
  }

  if (failed.length) {
    console.log("\nXatolar:");
    for (const r of failed.slice(0, 5)) console.log(`#${r.index}: ${r.error}`);
  }

  // Batch: nechta e'lon bitta so'rovda tahlil qilindi, nechtasi javob yaroqsiz bo'lgani uchun bittadan qayta yuborildi
  const batched = results.filter((r) => r.batch);
  const fallback = results.filter((r) => r.fallback);
  if (batched.length || fallback.length) {
    const requests = batched.filter((r) => r.usage).length;
    console.log(`\nBatch: ${batched.length} ta e'lon ${requests} ta so'rovda | bittadan qayta: ${fallback.length} ta`);
    for (const reason of new Set(fallback.map((r) => r.fallback))) console.log(`  sabab: ${reason}`);
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
