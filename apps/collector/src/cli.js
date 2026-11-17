// Collector buyruqlari (YukPlatform papkasida):
//   npm run tg:login                               — Telegram'ga kirish (bir marta)
//   npm run tg:dialogs                             — akkaunt a'zo bo'lgan guruh/kanallar
//   npm run tg:search -- yuk "yuk markazi" груз     — ochiq guruh/kanallarni Telegram qidiruvidan topish
//   npm run tg:export -- @guruh1 t.me/guruh2       — oxirgi xabarlarni elonlar.txt ga qo'shish
//        --limit 200       har bir chatdan nechta xabar (standart 100)
//        --min-length 20   bundan qisqa xabarlar tashlanadi
//   npm run tg:logout                              — sessiyani bekor qilish va faylini o'chirish
//        --account ikkinchi  — login/dialogs/logout/search/export qo'shimcha akkaunt bilan (sessions/ikkinchi.session).
//        Yopiq guruhlar uchun (2026-11-13): akkauntni guruhga odam qo'shadi, collector uni o'zi ulaydi (accounts.js)
//   npm run tg:live -- @guruh1 @guruh2             — jonli rejim: yangi e'lonlarni bot navbatiga qo'yish
//        (guruhlar berilmasa — bazadagi "Manbalar" ro'yxati; bo'sh bo'lsa bir marta .env dagi TG_SOURCES dan olinadi)
//        --interval 60 (soniya)  --backfill 20 (boshida oxirgi 20 ta)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXIT_CONFIG, devCollectorProblem } from "@yuk/shared";
import { acquireRunLock, loadSecret, openStore } from "@yuk/store";
import { accountSources, accountTitle, runAccount, superviseAccounts } from "./accounts.js";
import { sourceLabel } from "./live.js";
import { ask } from "./prompt.js";
import { appendPosts, selectNewPosts } from "./samples.js";
import { normalizeSource } from "./sources.js";
import {
  accountName,
  connectSaved,
  createReader,
  fetchTexts,
  listAccounts,
  listChats,
  login,
  logout,
  MAIN_ACCOUNT,
  searchPublicChats,
  sessionFile,
  whoAmI,
} from "./telegram.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "100" },
    "min-length": { type: "string", default: "20" },
    out: { type: "string", default: path.join(ROOT, "data/samples/elonlar.txt") },
    interval: { type: "string", default: "60" },
    backfill: { type: "string", default: "0" },
    account: { type: "string", default: "" },
  },
});
const [command, ...sourceArgs] = positionals;
// npm -w buyruqni paket papkasida ishga tushiradi; nisbiy yo'l foydalanuvchi turgan papkaga nisbatan (INIT_CWD)
args.out = path.resolve(process.env.INIT_CWD ?? process.cwd(), args.out);
// Qaysi akkaunt (bo'sh — asosiy). Nom xato bo'lsa — hech narsaga ulanmasdan to'xtaydi
let account;
try {
  account = accountName(args.account);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const extra = account !== MAIN_ACCOUNT;
const flag = extra ? ` -- --account ${account}` : "";

async function cmdLogin() {
  if (extra) {
    console.log(`Qo'shimcha akkaunt «${account}» bilan kirish (yopiq guruhlar uchun). Kodni va 2FA parolni faqat akkaunt egasi o'zi yozadi.\n`);
  } else {
    console.log("Telegram'ga kirish. Iloji bo'lsa, shaxsiy emas, ALOHIDA raqamdagi akkauntdan foydalaning.\n");
  }
  const client = await login(ask, { account });
  const me = await whoAmI(client);
  await client.disconnect();
  console.log(`\nKirildi: ${accountTitle(me)}`);
  console.log(`Sessiya saqlandi: ${path.relative(ROOT, sessionFile(account))} (gitga tushmaydi, hech kimga bermang)`);
  // Bir akkaunt ikki nom bilan ulansa — ikki joydan bir xil guruhlar o'qiladi; collector buni baribir ishga tushirmaydi
  const store = openStore();
  const same = store.listTgAccounts().find((a) => a.userId === me.userId && a.name !== account && a.status !== "logged_out");
  store.close();
  if (same) {
    console.log(`\n⚠ Bu — «${same.name}» nomi bilan ulangan akkauntning o'zi. Collector uni ikkinchi marta ishlatmaydi.`);
    console.log(`  Kerak bo'lmasa: npm run tg:logout${flag}`);
    return;
  }
  if (extra) {
    console.log("\nKeyingi qadamlar:");
    console.log("  1) Shu akkauntni yopiq guruhga qo'shishsin (guruh a'zosi yoki admini taklif qiladi).");
    console.log("  2) Ishlab turgan collector yangi akkauntni 30 soniya ichida o'zi ulaydi — qayta yoqish shart emas.");
    console.log("  3) Boshqaruv markazi → «Manbalar» → «Yopiq guruh qo'shish»: ro'yxatdan guruhni tanlang.");
  }
}

async function cmdDialogs() {
  const client = await connectSaved(account);
  const chats = await listChats(client);
  await client.disconnect();
  console.log(`${chats.length} ta guruh/kanal:\n`);
  for (const c of chats) {
    const address = c.username ? `@${c.username}` : `id ${c.id}`;
    const members = c.members ? ` | ${c.members} a'zo` : "";
    console.log(`${c.type.padEnd(5)} | ${address} | ${c.title}${members}`);
  }
  console.log(`\nEksport: npm run tg:export -- <manzil yoki id> ...${extra ? ` --account ${account}` : ""}`);
}

async function cmdSearch() {
  const queries = sourceArgs;
  if (queries.length === 0) {
    throw new Error('Nima qidiramiz? Masalan: npm run tg:search -- yuk "yuk markazi" груз');
  }
  const client = await connectSaved(account);
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

  const client = await connectSaved(account);
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

// Asosiy akkaunt guruhlari: buyruqda berilgan bo'lsa — o'shalar; bo'lmasa — bazadagi "Manbalar" (boshqaruv markazidan
// o'zgartiriladi, har aylanishda qayta o'qiladi, qayta ishga tushirish shart emas). Qo'shimcha akkauntga biriktirilgan
// yopiq guruhlarni asosiy o'qimaydi (accounts.js accountSources)
function liveSources(store) {
  if (sourceArgs.length) {
    const fixed = sourceArgs.map(normalizeSource);
    return () => fixed;
  }
  const fromEnv = (process.env.TG_SOURCES ?? "").split(/[,\s]+/).filter(Boolean);
  store.seedSources(fromEnv.map((s) => sourceLabel(normalizeSource(s))));
  return accountSources(store, MAIN_ACCOUNT);
}

// accounts.js uchun Telegram funksiyalari (testlarda soxtasi beriladi)
const TELEGRAM = {
  listAccounts,
  connectSaved,
  whoAmI,
  createReader,
  listChats,
  // Aloqa uzilgan bo'lsa disconnect ham osilib qolishi mumkin — ko'pi bilan 5 s kutamiz
  disconnect: (client) => Promise.race([client.disconnect().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000).unref())]),
};

async function cmdLive() {
  if (extra) throw new Error("Jonli rejim hamma akkauntni o'zi ishlatadi: --account kerak emas (npm run tg:live)");
  // --interval — yangi guruhning (faolligi hali bilinmaydi) oralig'i; 30 s dan tez so'rash — FLOOD_WAIT xavfi.
  // TG_POLL_BUDGET — har akkaunt Telegram'ga daqiqasiga taxminan nechta so'rov yuboradi (standart 20; FLOOD_WAIT ko'p chiqsa kamaytiring)
  const intervalMs = Math.max(30, Number(args.interval)) * 1000;
  const budgetPerMin = Math.min(Math.max(Number(process.env.TG_POLL_BUDGET) || 20, 4), 30);
  const store = openStore();
  // Ikkinchi collector bitta Telegram sessiyasini ikki joyda ochadi — Telegram sessiyani bekor qilishi mumkin
  acquireRunLock("collector");
  const sources = liveSources(store);
  let client;
  try {
    client = await connectSaved();
  } catch (error) {
    // Sessiya yo'q yoki bekor qilingan — qayta yoqish foydasiz: EXIT_CONFIG (boshqaruv markazi qayta-qayta yoqmaydi)
    if (error.code === "SESSION") {
      store.saveTgAccount(MAIN_ACCOUNT, { status: "logged_out", error: error.message });
      error.exitCode = EXIT_CONFIG;
    }
    store.close();
    throw error;
  }
  const me = await whoAmI(client);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && controller.abort());
  const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
  const log = (message) => console.log(`[${time()}] ${message}`);
  const aiAccess = { secret: loadSecret(), env: process.env };
  const live = {
    intervalMs,
    budgetPerMin,
    backfill: Number(args.backfill),
    // Bot aloqasiz e'lonni yubormaydi — foydalanuvchi qo'shgan guruhni tekshirishda ham ular sanalmaydi (REQUIRE_CONTACT=0 — sanaladi)
    requireContact: !/^(0|yo'q|yoq|no|false|off)$/i.test(process.env.REQUIRE_CONTACT?.trim() ?? ""),
    // «🔎 Auto scan» (live.js scanNext): o'zimizning kanal va majburiy a'zolik guruhlari tekshirilmaydi
    // Ovozli xabar / dumaloq video uchun Gemini ulanishlari (media.js) — boshqaruv markazidagi AI kalitlari, har safar yangidan.
    // MEDIA=0 — o'chiq (ovozli xabarlar avvalgidek tashlanadi)
    connections: /^(0|yo'q|yoq|no|false|off)$/i.test(process.env.MEDIA?.trim() ?? "") ? null : () => store.aiConnections(aiAccess),
    scanExclude: [process.env.CHANNEL_ID, ...String(process.env.REQUIRED_CHATS ?? "").split(/[,\s]+/)].map((x) => String(x ?? "").trim()).filter((x) => /^(@\w+|-?\d+)$/.test(x)),
  };

  console.log(
    `Asosiy akkaunt (${accountTitle(me)}): ${sources().length} ta guruh kuzatilyapti — har biri faolligiga qarab (tez yozadigani tez-tez), ` +
      `a'zo bo'linganlari — yangisi bo'lsa darhol; daqiqasiga ~${budgetPerMin} ta so'rov. E'lonlarni bot yuboradi (npm run bot). To'xtatish: Ctrl+C`,
  );
  // Qo'shimcha akkauntlar (sessions/*.session) — o'z halqalarida; terminalda guruhlar berilgan bo'lsa — faqat asosiy
  const owners = new Map([[me.userId, MAIN_ACCOUNT]]);
  const extras = sourceArgs.length
    ? null
    : superviseAccounts({ telegram: TELEGRAM, store, owners, log, signal: controller.signal, live }).catch((error) =>
        log(`Qo'shimcha akkauntlar to'xtadi — ${error.message}`),
      );
  try {
    await runAccount({ name: MAIN_ACCOUNT, client, me, telegram: TELEGRAM, store, sources, log, signal: controller.signal, ...live });
  } finally {
    controller.abort();
    await extras;
    await TELEGRAM.disconnect(client);
    store.close();
  }
}

async function cmdLogout() {
  const client = await connectSaved(account);
  await logout(client, account);
  await client.disconnect();
  console.log(`Sessiya bekor qilindi va ${path.relative(ROOT, sessionFile(account))} o'chirildi.`);
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
  process.exit(error.exitCode ?? 1);
}
