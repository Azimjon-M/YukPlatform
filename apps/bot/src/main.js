// Botni ishga tushirish (YukPlatform papkasida):
//   npm run bot          — bot + ishchi (navbatdagi e'lonlarni tahlil qilib yuboradi)
//   npm run bot:check    — faqat tekshirish: token ishlayaptimi, bot kanalda adminmi
//   npm run bot -- --dry-run — navbatdagi e'lonlarni tahlil qilib, Telegram'ga yubormasdan ekranga chiqarish
import { createParser } from "@yuk/parser";
import { openStore } from "@yuk/store";
import { createBot } from "./bot.js";
import { readConfig } from "./config.js";
import { formatLoad } from "./format.js";
import { createWorker } from "./pipeline.js";

const time = () => new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" });
const log = (message) => console.log(`[${time()}] ${message}`);

async function check(config) {
  const store = openStore();
  const { bot, init } = createBot({ token: config.token, store, config, log });
  await init();
  console.log(`✅ Token ishlayapti: @${bot.botInfo.username} (${bot.botInfo.first_name})`);
  if (!bot.botInfo.can_read_all_group_messages) {
    console.log("ℹ️  Privacy mode yoqilgan: guruhda bot faqat admin bo'lsa hamma xabarni ko'radi.");
  }
  if (!config.channel) {
    console.log("⚠️  CHANNEL_ID yozilmagan: yuklar kanalga joylanmaydi (.env ga CHANNEL_ID=@kanal_nomi).");
  } else {
    try {
      const member = await bot.api.getChatMember(config.channel, bot.botInfo.id);
      if (member.status === "administrator" && member.can_post_messages !== false) {
        console.log(`✅ Kanal ${config.channel}: bot admin, xabar joylay oladi.`);
      } else {
        console.log(`⚠️  Kanal ${config.channel}: bot admin emas yoki "Post messages" huquqi yo'q (holati: ${member.status}).`);
      }
    } catch (error) {
      console.log(`⚠️  Kanal ${config.channel} topilmadi yoki bot unga qo'shilmagan: ${error.description ?? error.message}`);
    }
  }
  const s = store.stats();
  console.log(`Baza: ${s.drivers.total} haydovchi, navbatda ${s.posts.new ?? 0} ta e'lon.`);
  store.close();
}

// Sinov: navbatdagi e'lonlarni tahlil qilib, Telegram'ga yubormasdan ekranga chiqaradi va tugaydi
async function dryRun() {
  const store = openStore();
  const parser = createParser();
  const plain = (html) => html.replace(/<\/?b>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const publish = async (load, post) => {
    const { text, url } = formatLoad(load, post);
    console.log(`\n${plain(text)}${url ? `\n🔗 ${url}` : ""}`);
    return null;
  };
  const deliver = async (chatId) => {
    console.log(`   → haydovchi ${chatId}`);
    return true;
  };
  const worker = createWorker({ parser, store, publish, deliver }, { log });
  while ((await worker.runOnce()) > 0);
  const s = store.stats();
  console.log(`\nTayyor. E'lonlar: ${Object.entries(s.posts).map(([k, v]) => `${k} ${v}`).join(", ")}; yangi yuk: ${s.loads24h.total}`);
  store.close();
}

async function main() {
  if (process.argv.includes("--dry-run")) return dryRun();
  const config = readConfig();
  if (process.argv.includes("--check")) return check(config);

  const store = openStore();
  const parser = createParser();
  const { bot, init, publish, deliver } = createBot({ token: config.token, store, config, log });
  await init();
  const worker = createWorker({ parser, store, publish, deliver }, { log });

  const stop = async () => {
    log("To'xtatilyapti...");
    worker.stop();
    await bot.stop();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  log(`Bot ishga tushdi: @${bot.botInfo.username}${config.channel ? `, kanal ${config.channel}` : ""}. To'xtatish: Ctrl+C`);
  worker.start();
  await bot.start({ allowed_updates: ["message", "channel_post", "callback_query"] });
}

main().catch((error) => {
  console.error(`Xato: ${error.description ?? error.message}`);
  process.exit(1);
});
