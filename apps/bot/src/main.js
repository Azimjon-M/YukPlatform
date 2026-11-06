// Botni ishga tushirish (YukPlatform papkasida):
//   npm run bot          — bot + ishchi (navbatdagi e'lonlarni tahlil qilib yuboradi)
//   npm run bot:check    — faqat tekshirish: token ishlayaptimi, bot kanalda adminmi
//   npm run bot -- --dry-run — navbatdagi e'lonlarni tahlil qilib, Telegram'ga yubormasdan ekranga chiqarish
import { existsSync, statSync } from "node:fs";
import { createParser, createParserPool, envSeedEntries, resolveSettings } from "@yuk/parser";
import { ROUTE_SCOPES, routeScopeFrom } from "@yuk/shared";
import { acquireRunLock, loadSecret, openStore, tunnelUrl } from "@yuk/store";
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

// AI ulanishlari: boshqaruv markazining «AI» bo'limida qo'shilgan kalitlar (bazada shifrlangan) va .env dagi kalitlar
// (GEMINI_API_KEY, ONEPRO_API_KEY — har biri birinchi marta ro'yxatga o'zi qo'shiladi). Ro'yxat har 15 s da qayta o'qiladi — botni qayta ishga tushirish shart emas.
function createAiPool(store) {
  store.seedAiKeys(envSeedEntries(resolveSettings()), process.env);
  const access = { secret: loadSecret(), env: process.env };
  return createParserPool({
    connections: () => store.aiConnections(access),
    onState: (state) => store.saveAiSlot(state),
  });
}

// Mini App va "📱 Ilovalar" tugmasi sozlamalari
function checkApps(config, store) {
  const tunnel = tunnelUrl(store);
  if (config.miniappUrl) console.log(`✅ Mini App: ${config.miniappUrl} — pastki menyudagi «Sozlamalar» tugmasi ochadi.`);
  else if (tunnel) console.log(`✅ Mini App: ${tunnel} (tunnel; manzil o'zgarsa, bot yangisini o'zi oladi).`);
  else console.log("ℹ️  Mini App manzili yo'q: tunnel o'chiq va MINIAPP_URL yozilmagan — sozlamalar chatda savol-javob bilan. Tunnel: npm start yoki npm run tunnel");
  if (!config.apkFile) return;
  if (!existsSync(config.apkFile)) {
    console.log(`⚠️  APK_FILE topilmadi: ${config.apkFile}`);
    return;
  }
  const mb = statSync(config.apkFile).size / 1024 / 1024;
  // Bot Telegram'ga 50 MB gacha fayl yubora oladi
  if (mb > 50) console.log(`⚠️  APK ${mb.toFixed(1)} MB — bot 50 MB dan kattasini yubora olmaydi. ANDROID_URL havolasini ishlating.`);
  else console.log(`✅ APK: ${mb.toFixed(1)} MB, «📱 Ilovalar» tugmasida yuboriladi.`);
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
    console.log(config.channelLoads
      ? `ℹ️  Yuklar kanalga ham joylanadi (.env: CHANNEL_LOADS=1).`
      : `ℹ️  Yuklar kanalga joylanmaydi, faqat haydovchilarga (yoqish: .env ga CHANNEL_LOADS=1).`);
  }
  checkApps(config, store);
  console.log(`✅ Yo'nalishlar: ${ROUTE_SCOPES[config.routeScope].title}.`);
  const ai = createAiPool(store).list();
  if (ai.length) console.log(`✅ AI: ${ai.length} ta ulanish (${ai.map((s) => s.label).join(", ")})`);
  else console.log("⚠️  AI ulanishi yo'q: boshqaruv markazining «AI» bo'limida kalit qo'shing (yoki .env ga GEMINI_API_KEY).");
  const s = store.stats();
  console.log(`Baza: ${s.drivers.total} haydovchi, ${s.shippers.total} yuk beruvchi, navbatda ${s.posts.new ?? 0} ta e'lon.`);
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
  const deliver = async (chatId, load, post, kind) => {
    console.log(`   → ${kind === "mashina" ? "yuk beruvchi" : "haydovchi"} ${chatId}`);
    return true;
  };
  const worker = createWorker({ parser, store, publish, deliver, routeScope: routeScopeFrom() }, { log });
  while ((await worker.runOnce()) > 0);
  const s = store.stats();
  console.log(`\nTayyor. E'lonlar: ${Object.entries(s.posts).map(([k, v]) => `${k} ${v}`).join(", ")}; yangi yuk: ${s.loads24h.total}, bo'sh mashina: ${s.trucks24h.total}`);
  store.close();
}

async function main() {
  if (process.argv.includes("--dry-run")) return dryRun();
  const config = readConfig();
  if (process.argv.includes("--check")) return check(config);

  // Ikkinchi bot nusxasi Telegram'dan "409 Conflict" oladi — oldindan to'xtatamiz
  acquireRunLock("bot");
  const store = openStore();
  const pool = createAiPool(store);
  // Mini App: .env dagi doimiy manzil, bo'lmasa — ishlab turgan tunnel bergani (har so'rovda yangidan o'qiladi)
  const appUrl = () => config.miniappUrl ?? tunnelUrl(store);
  const { bot, init, publish, deliver } = createBot({ token: config.token, store, config, log, appUrl });
  await init();
  const { routeScope, maxPostAgeMs } = config;
  const worker = createWorker({ pool, store, publish, deliver, routeScope }, { log, maxAgeMs: maxPostAgeMs });

  const stop = async () => {
    log("To'xtatilyapti...");
    worker.stop();
    await bot.stop();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Boshqaruv markazi (apps/api) "stop" yuborsa — yumshoq to'xtaydi
  process.on("message", (message) => message === "stop" && stop());

  log(`Bot ishga tushdi: @${bot.botInfo.username}. To'xtatish: Ctrl+C`);
  log(config.channel && config.channelLoads
    ? `Kanal: yuklar ${config.channel} ga ham joylanadi (.env: CHANNEL_LOADS=1)`
    : "Kanal: yuklar joylanmaydi — faqat mos haydovchilarga shaxsiy xabar (yoqish: .env ga CHANNEL_LOADS=1)");
  log(`Yo'nalishlar: ${ROUTE_SCOPES[routeScope].title} (.env: ROUTE_SCOPE=${routeScope})`);
  log(maxPostAgeMs > 0
    ? `Eski e'lonlar: joylanganiga ${maxPostAgeMs / 3_600_000} soatdan oshgani AI'ga bormaydi (.env: POST_MAX_AGE_HOURS)`
    : "Eski e'lonlar: cheklovsiz, hammasi AI'ga boradi (.env: POST_MAX_AGE_HOURS=0)");
  log(config.miniappUrl ? `Mini App: ${config.miniappUrl}` : "Mini App: tunnel manzili (tunnel o'chiq bo'lsa — sozlamalar chatda savol-javob)");
  worker.start();
  await bot.start({ allowed_updates: ["message", "channel_post", "callback_query"] });
}

main().catch((error) => {
  console.error(`Xato: ${error.description ?? error.message}`);
  process.exit(1);
});
