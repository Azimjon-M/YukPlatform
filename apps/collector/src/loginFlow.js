// Serverda collector'ni Telegram'ga bir marta kiritish (terminal so'rovini chat orqali bajarish).
// Ishlatish: node --env-file-if-exists=../../.env src/loginFlow.js
// Raqam va kod chat'dagi 🔑 tugmalar orqali keladi: ~/.agi-connector/secrets/TG_PHONE, TG_CODE
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { login, saveSession } from "./telegram.js";

const SECRET = (n) => `${process.env.HOME}/.agi-connector/secrets/${n}`;

async function readSecret(name) {
  return (await readFile(SECRET(name), "utf8")).trim();
}

// Kod Telegram'dan kech keladi, keyin odam uni tugma bilan yuboradi — kutish 20 daqiqa (env bilan o'zgaradi)
async function waitFor(name, timeoutMs = Number(process.env.TG_WAIT_MS) || 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(SECRET(name))) {
    if (Date.now() > deadline) throw new Error(`${name} yuborilmadi (kuting tugadi)`);
    await sleep(2000);
  }
  return readSecret(name);
}

// Kod bir martalik: ishlatilgach fayl o'chiriladi, xato bo'lsa qayta yuborish mumkin bo'lsin
async function consume(name) {
  const value = await readSecret(name);

  await rm(SECRET(name), { force: true });
  return value;
}

const ask = async (question, { hidden = false } = {}) => {
  const name = /raqam/i.test(question) ? "TG_PHONE" : hidden ? "TG_PASSWORD" : "TG_CODE";
  const value = name === "TG_PHONE" ? await waitFor(name) : await waitFor(name);
  console.log(`[${new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" })}] ${question.trim()} ← ${name} (${value.length} belgi)`);
  return consume(name);
};

const client = await login(ask);
const me = await client.getMe();
console.log(`Kirildi: ${me.firstName ?? ""} ${me.username ? `(@${me.username})` : ""} · id ${me.id}`);
await saveSession(client);
await client.disconnect();
console.log("Sessiya saqlandi: apps/collector/telegram.session");
process.exit(0);
