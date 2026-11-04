// Collector buyruqlari (YukPlatform papkasida):
//   npm run tg:login                               — Telegram'ga kirish (bir marta)
//   npm run tg:dialogs                             — akkaunt a'zo bo'lgan guruh/kanallar
//   npm run tg:export -- @guruh1 t.me/guruh2       — oxirgi xabarlarni elonlar.txt ga qo'shish
//        --limit 200       har bir chatdan nechta xabar (standart 100)
//        --min-length 20   bundan qisqa xabarlar tashlanadi
//   npm run tg:logout                              — sessiyani bekor qilish va faylini o'chirish
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { appendPosts, selectNewPosts } from "./samples.js";
import { normalizeSource } from "./sources.js";
import { connectSaved, fetchTexts, listChats, login, logout } from "./telegram.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "100" },
    "min-length": { type: "string", default: "20" },
    out: { type: "string", default: path.join(ROOT, "data/samples/elonlar.txt") },
  },
});
const [command, ...sourceArgs] = positionals;

// Terminaldan javob so'raydi. hidden: true — yozilgan belgilar ekranda ko'rinmaydi (parol uchun)
async function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => write(text.startsWith(question) ? question : "");
  }
  try {
    return (await rl.question(question)).trim();
  } finally {
    if (hidden) process.stdout.write("\n");
    rl.close();
  }
}

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

async function cmdLogout() {
  const client = await connectSaved();
  await logout(client);
  await client.disconnect();
  console.log("Sessiya bekor qilindi va telegram.session o'chirildi.");
}

const COMMANDS = { login: cmdLogin, dialogs: cmdDialogs, export: cmdExport, logout: cmdLogout };

try {
  const run = COMMANDS[command];
  if (!run) throw new Error(`Noma'lum buyruq: "${command ?? ""}". Mavjudlari: ${Object.keys(COMMANDS).join(", ")}`);
  await run();
  process.exit(0); // GramJS ba'zan fonda ulanishni ochiq qoldiradi
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
