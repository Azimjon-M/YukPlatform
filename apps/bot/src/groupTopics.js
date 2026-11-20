// Guruhdagi bo'limlar (Telegram «Topics»): har yuk mashina turiga mos bo'limga joylanadi (Azimjon, 2026-11-13:
// «@Yuk_Ekspert_chat ni kategoriyalarga bo'l … filtrlagan e'lonlarni mos bo'limga yo'naltir»).
// .env: GROUP_LOADS=@Yuk_Ekspert_chat (bo'sh — o'chiq). Guruhda Topics yoqilgan, bot esa «Manage topics» huquqli admin bo'lishi kerak.
//
// Bo'limlarni bot o'zi ochadi va ularning id'sini bazaga yozadi (settings.group_topics). Bo'lim qo'lda o'chirilsa —
// keyingi yukda qayta ochiladi.
//
// Nega navbat: Telegram bitta guruhga daqiqasiga ~20 xabardan ko'pini qabul qilmaydi. 2026-11-13 o'lchovi: kuniga
// ~6 600 yuk, eng band soatda 613 ta (daqiqasiga 77 tagacha). Shuning uchun yuklar xotiradagi navbatga tushadi va
// har 3.2 s da bittadan yuboriladi (soatiga ~1 100 ta). Navbat haydovchilarga shaxsiy xabarni kutib turmaydi.
// Bot qayta yonsa, navbatdagilar yo'qoladi — bu ataylab.
//
// Asl matn, AI'siz (2026-11-20, Azimjon: «guruhlarimizga ham e'lonlarni tahrirlamasdan (AI siz e'lonni o'zini jo'natish)
// asl e'lonni jo'natamiz … eng tekin foydalanuvchilarga bunday xizmat ko'rsatish mantiqsiz»): guruh e'loni bo'limga
// haydovchilardagi kabi asl matni bilan, AI'ni kutmasdan ketadi (pipeline.js quick → deps.groupRaw → pushRaw). Bo'lim —
// AI'siz tahlil topgan mashina turi (@yuk/parser fastLook trucks). AI tahrirlagan ko'rinish (push) endi faqat yuk
// beruvchining o'z yuki uchun — u AI'siz, formadan keladi.
// Hajm (o'sha kungi o'lchov): «quruq gap» dan tashqari ~29 000 e'lon/kun, eng band soatda ~2 400 — Telegram limiti
// (~1 100/soat) dan ikki barobar ko'p. Uning tanlovi: 1 xabar = 1 e'lon; navbatdan har safar ENG YANGISI olinadi, 10 daqiqadan
// eskirgani tashlanadi (yuk tez olinadi — eskisini kech yuborishdan foyda yo'q).
import { InlineKeyboard } from "grammy";
import { formatLoad, formatRaw } from "./format.js";

// classes — @yuk/shared vehicles.js TRUCK_CLASSES id'lari. Mashina turi yozilmagan yuk «Boshqa yuklar» ga boradi.
// color — Telegram ruxsat bergan 6 rangdan biri (createForumTopic icon_color)
export const GROUP_TOPICS = [
  { id: "fura", name: "🚛 Fura", classes: ["katta_fura", "fura", "mini_fura"], color: 0x6fb9f0 },
  { id: "kamaz", name: "🚚 Kamaz", classes: ["kamaz"], color: 0xffd67e },
  { id: "isuzu", name: "🚐 Isuzu", classes: ["katta_isuzu", "isuzu"], color: 0xcb86db },
  { id: "kichik", name: "📦 Kichik yuk mashinasi", classes: ["kichik"], color: 0x8eee98 },
  { id: "labo", name: "🛻 Labo / Damas", classes: ["labo"], color: 0xff93b2 },
  { id: "yengil_avto", name: "🚗 Yengil mashina", classes: ["yengil_avto"], color: 0xfb6f5f },
  { id: "boshqa", name: "📋 Boshqa yuklar", classes: [], color: 0x6fb9f0 },
];
const FALLBACK = "boshqa";
const SETTING = "group_topics";

// Yuk → bo'lim id'si
export function topicFor(load) {
  return GROUP_TOPICS.find((t) => t.classes.includes(load?.truckClass))?.id ?? FALLBACK;
}

// AI'siz tahlil topgan mashina turlari (fastLook trucks) → bo'lim. Hammasi bitta bo'limga tushsa — o'sha, turi yo'q yoki
// har xil (fura ham, labo ham) — «Boshqa yuklar»
export function topicForTrucks(trucks = []) {
  const ids = new Set(trucks.map((truckClass) => topicFor({ truckClass })));
  return ids.size === 1 ? [...ids][0] : FALLBACK;
}

// Bo'lim o'chirilgan / topilmadi — Telegram shunday javob beradi
const isTopicGone = (error) => /thread not found|TOPIC_DELETED|TOPIC_CLOSED|topic_id_invalid/i.test(error?.description ?? error?.message ?? "");

// api — grammY bot.api; chat — "@Yuk_Ekspert_chat" yoki -100...;
// botUsername — «🤖 Menga mos yuklar» tugmasi uchun: matn yoki funksiya (bot nomi init()dan keyin ma'lum bo'ladi)
export function createGroupPoster({
  api,
  store,
  chat,
  botUsername = null,
  log = console.log,
  intervalMs = 3200,
  maxQueue = 2000,
  maxAgeMs = 10 * 60_000,
  now = Date.now,
}) {
  const queue = [];
  let timer = null;
  let sending = false;
  let dropped = 0;
  let sent = 0;

  // { chat, topics: { fura: 12, ... } } — boshqa guruhga o'tilsa, eski id'lar ishlatilmaydi
  const readSaved = () => {
    try {
      const saved = JSON.parse(store.getSetting?.(SETTING) ?? "null");
      return saved?.chat === String(chat) ? saved.topics ?? {} : {};
    } catch {
      return {};
    }
  };
  let topics = readSaved();
  const save = () => store.setSetting?.(SETTING, JSON.stringify({ chat: String(chat), topics }));

  async function threadId(id) {
    if (topics[id]) return topics[id];
    const topic = GROUP_TOPICS.find((t) => t.id === id);
    const created = await api.createForumTopic(chat, topic.name, { icon_color: topic.color });
    topics[id] = created.message_thread_id;
    save();
    log(`Guruh ${chat}: «${topic.name}» bo'limi ochildi (#${topics[id]})`);
    return topics[id];
  }

  // Ishga tushganda hamma bo'limni oldindan ochib qo'yamiz — guruh bo'sh bo'lsa ham ro'yxat ko'rinsin
  async function ensureTopics() {
    for (const topic of GROUP_TOPICS) await threadId(topic.id);
  }

  function message(item) {
    const { text, url } = item.raw ? formatRaw(item.post, { phones: item.phones, label: "⚡ Yangi e'lon" }) : formatLoad(item.load, item.post);
    const keyboard = new InlineKeyboard();
    if (url) keyboard.url("📄 Asl e'lon", url);
    const username = typeof botUsername === "function" ? botUsername() : botUsername;
    if (username) keyboard.url("🤖 Menga mos yuklar", `https://t.me/${username}?start=guruh`);
    return { text, keyboard };
  }

  async function send(item) {
    const id = item.raw ? topicForTrucks(item.trucks) : topicFor(item.load);
    const { text, keyboard } = message(item);
    const options = { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard };
    try {
      return await api.sendMessage(chat, text, { ...options, message_thread_id: await threadId(id) });
    } catch (error) {
      if (!isTopicGone(error)) throw error;
      // Bo'limni kimdir o'chirgan — qayta ochib, bir marta yana urinamiz
      delete topics[id];
      save();
      return await api.sendMessage(chat, text, { ...options, message_thread_id: await threadId(id) });
    }
  }

  async function tick() {
    if (sending) return;
    sending = true;
    try {
      while (queue.length && now() - queue[0].at > maxAgeMs) {
        queue.shift();
        dropped++;
      }
      const item = queue.pop(); // eng yangisi
      if (!item) return;
      await send(item);
      sent++;
    } catch (error) {
      log(`Guruhga yuborilmadi: ${error.description ?? error.message}`);
    } finally {
      sending = false;
    }
  }

  function enqueue(item) {
    queue.push({ ...item, at: now() });
    if (queue.length > maxQueue) {
      queue.shift();
      dropped++;
    }
  }

  return {
    // Yuk beruvchining o'z yuki (bot.js publish orqali) — tayyor ko'rinishda. Kutmaydi — darhol qaytadi
    push(load, post) {
      enqueue({ load, post });
    },
    // Guruh e'loni asl matn bilan (pipeline.js quick → deps.groupRaw). look — fastLook natijasi (trucks)
    pushRaw(post, { trucks = [], phones = [] } = {}) {
      enqueue({ raw: true, post, trucks, phones });
    },
    async start() {
      await ensureTopics().catch((error) => log(`Guruh ${chat}: bo'limlar ochilmadi — ${error.description ?? error.message}`));
      timer ??= setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    tick,
    stats: () => ({ queued: queue.length, sent, dropped, topics: { ...topics } }),
  };
}
