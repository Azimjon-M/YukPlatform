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

// Botni admin qilib qo'shadigan havolalar (Telegram o'zi kanal/guruh tanlashni so'raydi)
function addLinks(username) {
  return {
    channel: `https://t.me/${username}?startchannel&admin=post_messages`,
    group: `https://t.me/${username}?startgroup&admin=delete_messages`,
  };
}

// Kanalning muhokama guruhi: bot u yerda admin bo'lsa, guruhdagi e'lonlarni ham navbatga oladi
async function checkLinkedGroup(bot, channel, links) {
  const chat = await bot.api.getChat(channel).catch(() => null);
  if (!chat?.linked_chat_id) return;
  const group = await bot.api.getChat(chat.linked_chat_id).catch(() => null);
  const name = group?.username ? `@${group.username}` : `"${group?.title ?? chat.linked_chat_id}"`;
  const member = await bot.api.getChatMember(chat.linked_chat_id, bot.botInfo.id).catch(() => null);
  if (member?.status === "administrator") {
    console.log(`✅ Muhokama guruhi ${name}: bot admin, guruhdagi e'lonlarni ham oladi.`);
  } else if (member) {
    console.log(`ℹ️  Muhokama guruhi ${name}: bot oddiy a'zo. Guruhdagi e'lonlarni olishi uchun admin qiling:`);
    console.log(`    Guruh → Administratorlar → Admin qo'shish → @${bot.botInfo.username} (huquqlar shart emas)`);
  } else {
    console.log(`ℹ️  Muhokama guruhi ${name}: bot qo'shilmagan (ixtiyoriy). Qo'shish: ${links.group}`);
  }
}

async function check(config) {
  const store = openStore();
  const { bot, init } = createBot({ token: config.token, store, config, log });
  await init();
  console.log(`✅ Token ishlayapti: @${bot.botInfo.username} (${bot.botInfo.first_name})`);
  if (!bot.botInfo.can_read_all_group_messages) {
    console.log("ℹ️  Privacy mode yoqilgan: guruhda bot faqat admin bo'lsa hamma xabarni ko'radi.");
  }
  const links = addLinks(bot.botInfo.username);
  if (!config.channel) {
    console.log("⚠️  CHANNEL_ID yozilmagan: yuklar kanalga joylanmaydi (.env ga CHANNEL_ID=@kanal_nomi).");
  } else {
    const member = await bot.api.getChatMember(config.channel, bot.botInfo.id).catch(() => null);
    if (member?.status === "administrator" && member.can_post_messages !== false) {
      console.log(`✅ Kanal ${config.channel}: bot admin, xabar joylay oladi.`);
    } else {
      // Bot profilidagi "Add to group" kanallarni ko'rsatmaydi, taklif havolasi bilan bot qo'shila olmaydi.
      // Shu havolani ochsangiz, Telegram kanal tanlashni so'raydi va botni "Post messages" huquqi bilan admin qiladi.
      console.log(`⚠️  Kanal ${config.channel}: bot admin emas${member ? ` (holati: ${member.status})` : ""}.`);
      console.log(`    Telefoningizda shu havolani oching va ${config.channel} ni tanlang:\n    ${links.channel}`);
    }
    await checkLinkedGroup(bot, config.channel, links);
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
