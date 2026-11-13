// Collector buyruqlari (YukPlatform papkasida):
//   npm run tg:login                               — Telegram'ga kirish (bir marta)
//   npm run tg:dialogs                             — akkaunt a'zo bo'lgan guruh/kanallar
//   npm run tg:search -- yuk "yuk markazi" груз     — ochiq guruh/kanallarni Telegram qidiruvidan topish
//   npm run tg:export -- @guruh1 t.me/guruh2       — oxirgi xabarlarni elonlar.txt ga qo'shish
//        --limit 200       har bir chatdan nechta xabar (standart 100)
//        --min-length 20   bundan qisqa xabarlar tashlanadi
//   npm run tg:logout                              — sessiyani bekor qilish va faylini o'chirish
//   npm run tg:live -- @guruh1 @guruh2             — jonli rejim: yangi e'lonlarni bot navbatiga qo'yish
//        (guruhlar berilmasa — bazadagi "Manbalar" ro'yxati; bo'sh bo'lsa bir marta .env dagi TG_SOURCES dan olinadi)
//        --interval 60 (soniya)  --backfill 20 (boshida oxirgi 20 ta)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXIT_CONFIG, devCollectorProblem } from "@yuk/shared";
import { acquireRunLock, openStore } from "@yuk/store";
import { runLive, sourceLabel } from "./live.js";
import { ask } from "./prompt.js";
import { appendPosts, selectNewPosts } from "./samples.js";
import { normalizeSource } from "./sources.js";
import { connectSaved, createReader, fetchTexts, listChats, login, logout, searchPublicChats } from "./telegram.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "100" },
    "min-length": { type: "string", default: "20" },
    out: { type: "string", default: path.join(ROOT, "data/samples/elonlar.txt") },
    interval: { type: "string", default: "60" },
    backfill: { type: "string", default: "0" },
  },
});
const [command, ...sourceArgs] = positionals;
// npm -w buyruqni paket papkasida ishga tushiradi; nisbiy yo'l foydalanuvchi turgan papkaga nisbatan (INIT_CWD)
args.out = path.resolve(process.env.INIT_CWD ?? process.cwd(), args.out);

async function cmdLogin() {
  console.log("Telegram'ga kirish. Iloji bo'lsa, shaxsiy emas, ALOHIDA raqamdagi akkauntdan foydalaning.\n");
  const client = await login(ask);
  const me = await client.getMe();
  console.log(`\nKirildi: ${me.firstName ?? ""} ${me.username ? `(@${me.username})` : ""}`);
  console.log("Sessiya saqlandi: apps/collector/telegram.session (gitga tushmaydi, hech kimga bermang)");
  await client.disconnect();
}

async function cmdDialogs() {
  const client = await connectSaved();
  const chats = await listChats(client);
  await client.disconnect();
  console.log(`${chats.length} ta guruh/kanal:\n`);
  for (const c of chats) {
    const address = c.username ? `@${c.username}` : `id ${c.id}`;
    const members = c.members ? ` | ${c.members} a'zo` : "";
    console.log(`${c.type.padEnd(5)} | ${address} | ${c.title}${members}`);
  }
  console.log("\nEksport: npm run tg:export -- <manzil yoki id> ...");
}

async function cmdSearch() {
  const queries = sourceArgs;
  if (queries.length === 0) {
    throw new Error('Nima qidiramiz? Masalan: npm run tg:search -- yuk "yuk markazi" груз');
  }
  const client = await connectSaved();
  const found = new Map(); // manzil → chat (bir nechta so'rovda chiqsa, bir marta)
  try {
    for (const query of queries) {
      const chats = await searchPublicChats(client, query);
      console.log(`"${query}": ${chats.length} ta ochiq chat`);
      for (const chat of chats) found.set(chat.username.toLowerCase(), chat);
    }
  } finally {
    await client.disconnect();
  }
  const sorted = [...found.values()].sort((a, b) => (b.members ?? 0) - (a.members ?? 0));
  console.log(`\nJami ${sorted.length} ta (a'zolar soni bo'yicha):\n`);
  for (const c of sorted) {
    const members = c.members != null ? String(c.members).padStart(7) : "      ?";
    console.log(`${members} | ${c.type.padEnd(5)} | @${c.username} | ${c.title}`);
  }
  console.log("\nEksport: npm run tg:export -- @manzil1 @manzil2 --limit 100");
}

async function cmdExport() {
  if (sourceArgs.length === 0) {
    throw new Error("Qaysi guruhlardan? Masalan: npm run tg:export -- @guruh1 https://t.me/guruh2");
  }
  const sources = sourceArgs.map(normalizeSource); // xato manzil bo'lsa, ulanishdan oldin to'xtaydi
  const limit = Number(args.limit);

  const client = await connectSaved();
  const texts = [];
  try {
    for (const source of sources) {
      try {
        const chat = await fetchTexts(client, source, { limit });
        console.log(`${chat.title}: ${chat.texts.length} ta matnli xabar`);
        texts.push(...chat.texts);
      } catch (error) {
        console.error(`${source.value}: o'qib bo'lmadi — ${error.message}`);
      }
    }
  } finally {
    await client.disconnect();
  }

  const existing = await readFile(args.out, "utf8").catch(() => "");
  const { posts, short, duplicate } = selectNewPosts(texts, existing, { minLength: Number(args["min-length"]) });
  await writeFile(args.out, appendPosts(existing, posts), "utf8");

  console.log(`\nQo'shildi: ${posts.length} ta e'lon | qisqa: ${short} | takror: ${duplicate}`);
  console.log(`Fayl: ${args.out}`);
  console.log("Keyingi qadam: npm run parse -- --dry-run, keyin npm run parse -- --limit 20");
}

// Guruhlar: buyruqda berilgan bo'lsa — o'shalar; bo'lmasa — bazadagi "Manbalar" (boshqaruv markazidan o'zgartiriladi,
// har aylanishda qayta o'qiladi, qayta ishga tushirish shart emas)
function liveSources(store) {
  if (sourceArgs.length) {
    const fixed = sourceArgs.map(normalizeSource);
    return () => fixed;
  }
  const fromEnv = (process.env.TG_SOURCES ?? "").split(/[,\s]+/).filter(Boolean);
  store.seedSources(fromEnv.map((s) => sourceLabel(normalizeSource(s))));
  return () =>
    store
      .listSources()
      .filter((s) => s.enabled)
      .flatMap((s) => {
        try {
          return [normalizeSource(s.name)];
        } catch {
          return [];
        }
      });
}

async function cmdLive() {
  // --interval — yangi guruhning (faolligi hali bilinmaydi) oralig'i; 30 s dan tez so'rash — FLOOD_WAIT xavfi.
  // TG_POLL_BUDGET — Telegram'ga daqiqasiga taxminan nechta so'rov (standart 20; FLOOD_WAIT ko'p chiqsa kamaytiring)
  const intervalMs = Math.max(30, Number(args.interval)) * 1000;
  const budgetPerMin = Math.min(Math.max(Number(process.env.TG_POLL_BUDGET) || 20, 4), 30);
  const store = openStore();
  // Ikkinchi collector bitta Telegram sessiyasini ikki joyda ochadi — Telegram sessiyani bekor qilishi mumkin
  acquireRunLock("collector");
  const sources = liveSources(store);
  const client = await connectSaved();
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && controller.abort());
  const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });

  console.log(
    `${sources().length} ta guruh kuzatilyapti: har biri faolligiga qarab (tez yozadigani tez-tez), a'zo bo'linganlari — yangisi bo'lsa darhol; ` +
      `daqiqasiga ~${budgetPerMin} ta so'rov. E'lonlarni bot yuboradi (npm run bot). To'xtatish: Ctrl+C`,
  );
  try {
    await runLive({
      sources,
      reader: createReader(client),
      store,
      intervalMs,
      budgetPerMin,
      backfill: Number(args.backfill),
      // Bot aloqasiz e'lonni yubormaydi — foydalanuvchi qo'shgan guruhni tekshirishda ham ular sanalmaydi (REQUIRE_CONTACT=0 — sanaladi)
      requireContact: !/^(0|yo'q|yoq|no|false|off)$/i.test(process.env.REQUIRE_CONTACT?.trim() ?? ""),
      log: (message) => console.log(`[${time()}] ${message}`),
      signal: controller.signal,
    });
  } finally {
    // Aloqa uzilgan bo'lsa disconnect ham osilib qolishi mumkin — ko'pi bilan 5 s kutamiz
    await Promise.race([client.disconnect().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
    store.close();
  }
}

async function cmdLogout() {
  const client = await connectSaved();
  await logout(client);
  await client.disconnect();
  console.log("Sessiya bekor qilindi va telegram.session o'chirildi.");
}

const COMMANDS = { login: cmdLogin, dialogs: cmdDialogs, search: cmdSearch, export: cmdExport, live: cmdLive, logout: cmdLogout };

try {
  const run = COMMANDS[command];
  if (!run) throw new Error(`Noma'lum buyruq: "${command ?? ""}". Mavjudlari: ${Object.keys(COMMANDS).join(", ")}`);
  // Dasturlash rejimi (.env YUK_ENV=dev): serverdagi collector ishlatayotgan akkauntga tegmaymiz (@yuk/shared devMode.js).
  // EXIT_CONFIG — boshqaruv markazi qayta-qayta yoqib turmaydi
  const devProblem = devCollectorProblem(command);
  if (devProblem) {
    console.error(devProblem);
    process.exit(EXIT_CONFIG);
  }
  await run();
  process.exit(0); // GramJS ba'zan fonda ulanishni ochiq qoldiradi
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
