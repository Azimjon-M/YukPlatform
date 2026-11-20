// Ovozli xabar / dumaloq video → matn → navbat (media.js). Telegram ham, Gemini ham soxta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { addMessage } from "../src/live.js";
import { createMediaQueue } from "../src/media.js";

const NOW = Date.UTC(2026, 10, 16, 9);
const SOURCE = { kind: "username", value: "yuk_guruh" };
const LOAD_TEXT = "Toshkentdan Samarqandga 20 tonna un bor, fura kerak 90 123 45 67";
const voice = (id, extra = {}) => {
  const m = { id, text: "", date: NOW / 1000 - 5, sender: "ali_yuk", media: { kind: "voice", duration: 12, size: 40_000, mime: "audio/ogg" }, ...extra };
  Object.defineProperty(m, "raw", { value: { id }, enumerable: false });
  return m;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup({ premium = true, telegram = async () => LOAD_TEXT, gemini = async () => ({ text: LOAD_TEXT }), connections = [{ provider: "gemini", apiKey: "k", model: "m" }], models, clock } = {}) {
  const store = openStore({ file: ":memory:", now: () => NOW });
  const calls = { telegram: 0, download: 0, gemini: [] };
  const reader = {
    isPremium: async () => premium,
    transcribe: async (...args) => (calls.telegram++, telegram(...args)),
    download: async () => (calls.download++, Buffer.from("ogg")),
  };
  const logs = [];
  reader.media = createMediaQueue({
    reader,
    store,
    connections: () => connections,
    log: (m) => logs.push(m),
    now: clock ?? (() => NOW),
    ...(models ? { models } : {}),
    transcribe: async (args) => (calls.gemini.push(args.model), gemini(args)),
  });
  return { store, reader, calls, logs };
}

test("avval Gemini: matn navbatga media=voice bilan; Telegram chaqirilmaydi", async () => {
  const { store, reader, calls, logs } = setup();
  assert.equal(addMessage(SOURCE, voice(7), store, { via: "live", media: reader.media }), "media");
  await settle();
  const [post] = store.takeNewPosts(5);
  assert.equal(post.text, LOAD_TEXT);
  assert.equal(post.media, "voice");
  assert.equal(post.sender, "ali_yuk");
  assert.equal(post.link, "https://t.me/yuk_guruh/7");
  assert.deepEqual([calls.telegram, calls.download, calls.gemini.length], [0, 1, 1]);
  assert.ok(logs.some((l) => l.includes("🎤 ovozli xabar matnga o'girildi (gemini")));
  // Jonli va so'rab olish bir xabarni ikkinchi marta o'girmaydi
  assert.equal(addMessage(SOURCE, voice(7), store, { via: "poll", media: reader.media }), "short");
  assert.equal(calls.gemini.length, 1);
});

test("Gemini ulanishi xato bersa — keyingisi; hammasi xato yoki ulanish yo'q — Premium bo'lsa Telegram", async () => {
  const a = setup({
    gemini: async ({ model }) => {
      if (model === "band") throw new Error("503");
      return { text: LOAD_TEXT };
    },
    connections: [
      { provider: "onepro", apiKey: "x", model: "qwen" },
      { provider: "gemini", apiKey: "k", model: "band", state: { problem: "x" } },
      { provider: "gemini", apiKey: "k", model: "ishlaydi" },
    ],
  });
  addMessage(SOURCE, voice(2, { media: { kind: "round", duration: 30, size: 900_000, mime: "video/mp4" } }), a.store, { media: a.reader.media });
  await settle();
  assert.deepEqual(a.calls.gemini, ["ishlaydi"], "faqat Gemini; muammoli (📌) ulanish oxirida — kerak bo'lmadi");
  assert.equal(a.store.takeNewPosts(5)[0].media, "round");

  const b = setup({
    gemini: async () => {
      throw new Error("429");
    },
  });
  addMessage(SOURCE, voice(3), b.store, { media: b.reader.media });
  await settle();
  assert.equal(b.calls.telegram, 1);
  assert.equal(b.store.takeNewPosts(5)[0].text, LOAD_TEXT);
  assert.ok(b.logs.some((l) => l.includes("Gemini matnga o'gira olmadi (429) — Telegram'ga")));

  const c = setup({ connections: [] });
  addMessage(SOURCE, voice(4), c.store, { media: c.reader.media });
  await settle();
  assert.deepEqual([c.calls.download, c.calls.telegram], [0, 1], "Gemini yo'q — fayl yuklanmaydi, to'g'ri Telegram");
});

test("gap yo'q (qisqa matn), juda uzun xabar va hammasi xato — navbatga tushmaydi", async () => {
  const short = setup({ telegram: async () => "Alo", gemini: async () => ({ text: "" }) });
  addMessage(SOURCE, voice(1), short.store, { media: short.reader.media });
  await settle();
  assert.equal(short.store.takeNewPosts(5).length, 0);
  assert.equal(short.reader.media.stats().empty, 1);

  const long = setup();
  assert.equal(addMessage(SOURCE, voice(2, { media: { kind: "voice", duration: 600, size: 1e6, mime: "audio/ogg" } }), long.store, { media: long.reader.media }), "short");
  assert.equal(long.calls.telegram, 0);

  // Gemini xato, Premium yo'q — hech narsa
  const broken = setup({
    premium: false,
    gemini: async () => {
      throw new Error("429");
    },
  });
  addMessage(SOURCE, voice(3), broken.store, { media: broken.reader.media });
  await settle();
  assert.equal(broken.store.takeNewPosts(5).length, 0);
  assert.equal(broken.reader.media.stats().empty, 1);

  // Navbat berilmasa (MEDIA=0) — avvalgidek tashlanadi
  assert.equal(addMessage(SOURCE, voice(4), long.store, {}), "short");
});

test("bir odamning ketma-ket ovozli xabarlari — bitta e'lon; «aloqasiz» deb yopilgani qayta tekshiriladi; «93 lik» → +998", async () => {
  const texts = ["Toshkentdan Yangiqo'rg'onga 5 tonna yuk bor, Isuzu kerak", "Nomerimiz 93 lik 123 45 67 akalar."];
  const { store, reader, logs } = setup({ gemini: async () => ({ text: texts.shift() }) });
  const first = voice(10, { senderId: "77", sender: null });
  const second = voice(11, { senderId: "77", sender: null, date: first.date + 40 });
  addMessage(SOURCE, first, store, { media: reader.media });
  addMessage(SOURCE, second, store, { media: reader.media });
  await settle();
  const [post] = store.takeNewPosts(5);
  assert.equal(post.text, "Toshkentdan Yangiqo'rg'onga 5 tonna yuk bor, Isuzu kerak\nNomerimiz +998 93 123 45 67 akalar.");
  assert.equal(post.messageId, 11, "yangi e'lon — davomi xabari raqami bilan (tezkor yo'l ko'radi)");
  assert.ok(logs.some((l) => l.includes("davomi oldingi ovozli xabar bilan birlashtirildi")));

  // Oldingisi allaqachon «aloqasiz» deb yopilgan bo'lsa ham — birlashgani navbatga
  store.finishPost(post.id, "done", "Aloqasiz: telefon raqami ham, lichkasi ham yo'q");
  texts.push("Yana bir gap");
  addMessage(SOURCE, voice(12, { senderId: "77", sender: null, date: first.date + 90 }), store, { media: reader.media });
  await settle();
  const [again] = store.takeNewPosts(5);
  assert.ok(again.text.endsWith("Yana bir gap"));
  assert.equal(again.messageId, 12);

  // Boshqa odam yoki 3 daqiqadan keyin — alohida e'lon
  texts.push("Samarqanddan Buxoroga 10 tonna yuk bor");
  addMessage(SOURCE, voice(13, { senderId: "77", sender: null, date: first.date + 600 }), store, { media: reader.media });
  await settle();
  assert.equal(store.takeNewPosts(5).length, 2);
});

test("kirillcha raqam: «93 лик 123 45 67» → +998 93 123 45 67; «20 лик фура» — raqam emas", async () => {
  const { normalizeSpokenPhones } = await import("../src/media.js");
  assert.equal(normalizeSpokenPhones("Номеримиз 93 лик 123 45 67 акалар"), "Номеримиз +998 93 123 45 67 акалар");
  assert.equal(normalizeSpokenPhones("90 лиги 111 22 33"), "+998 90 111 22 33");
  assert.equal(normalizeSpokenPhones("5 тонна 20 лик фура"), "5 тонна 20 лик фура");
  assert.equal(normalizeSpokenPhones("Кияли 93 ликоп"), "Кияли 93 ликоп");
});

test("avval faqat o'girish uchun modellar; limiti tugagani dam oladi va keyingi xabarda sinalmaydi", async () => {
  let time = NOW;
  const daily = new Error('{"error":{"code":429,"message":"quota","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}');
  const { store, reader, calls, logs } = setup({
    models: ["ovoz-1", "ovoz-2"],
    clock: () => time,
    gemini: async ({ model }) => {
      if (model === "ovoz-1") throw daily;
      return { text: LOAD_TEXT };
    },
  });
  addMessage(SOURCE, voice(1), store, { via: "live", media: reader.media });
  await settle();
  assert.deepEqual(calls.gemini, ["ovoz-1", "ovoz-2"]); // umumiy «m» gacha bormadi
  assert.ok(logs.some((l) => l.includes("(gemini · ovoz-2")));
  addMessage(SOURCE, voice(2, { sender: "vali" }), store, { via: "live", media: reader.media });
  await settle();
  assert.deepEqual(calls.gemini.slice(2), ["ovoz-2"]); // ovoz-1 dam olyapti
  time += 31 * 60_000; // kunlik limit 30 daqiqada bir qayta tekshiriladi
  addMessage(SOURCE, voice(3, { sender: "soli" }), store, { via: "live", media: reader.media });
  await settle();
  assert.deepEqual(calls.gemini.slice(3), ["ovoz-1", "ovoz-2"]);
});

test("hamma Gemini modeli dam olayotganda fayl yuklanmaydi — to'g'ri Telegram'ga", async () => {
  const { store, reader, calls } = setup({ gemini: async () => { throw new Error("503 band"); } });
  addMessage(SOURCE, voice(1), store, { via: "live", media: reader.media });
  await settle();
  addMessage(SOURCE, voice(2, { sender: "vali" }), store, { via: "live", media: reader.media });
  await settle();
  assert.deepEqual([calls.gemini.length, calls.download, calls.telegram], [1, 1, 2]);
});

test("yopiq guruhda username'siz odamning ovozli YUK e'loni — botga ko'rsatiladi (bir marta); suhbat, ochiq guruh, username bo'lsa — yo'q", async () => {
  const CLOSED = { kind: "id", value: "-1001234567890" };
  const CHAT = "Assalomu alaykum, yaxshimisizlar, mashina buzilib qoldi, nima maslahat berasizlar";
  const NOPHONE = "Toshkentdan Samarqandga 20 tonna un bor, fura kerak";
  const texts = { 1: NOPHONE, 2: NOPHONE, 3: CHAT, 4: NOPHONE, 5: NOPHONE, 6: LOAD_TEXT };
  const { store, reader, logs } = setup({ gemini: async () => ({ text: texts[current] }) });
  store.setSetting("bot_username", "Yuk_Ekspert_agent");
  const shown = [];
  reader.showToBot = async (source, id, bot) => (shown.push([source.value, id, bot]), true);
  let current = 0;
  const send = async (source, m) => {
    current = m.id;
    addMessage(source, m, store, { via: "live", media: reader.media });
    await settle();
  };
  await send(CLOSED, voice(1, { sender: null, senderId: "555" }));
  assert.deepEqual(shown, [["-1001234567890", 1, "Yuk_Ekspert_agent"]]);
  assert.equal(store.senderReachable("555"), true);
  assert.ok(logs.some((l) => l.includes("botga ko'rsatildi")));
  await send(CLOSED, voice(2, { sender: null, senderId: "555", date: NOW / 1000 + 600 })); // allaqachon ko'rsatilgan
  await send(CLOSED, voice(3, { sender: null, senderId: "666" })); // suhbat
  await send(SOURCE, voice(4, { sender: null, senderId: "777" })); // ochiq guruh — «📄 Asl e'lon» bor
  await send(CLOSED, voice(5, { sender: "ali_yuk", senderId: "888" })); // username bor — havola o'zi chiqadi
  await send(CLOSED, voice(6, { sender: null, senderId: "999" })); // raqam aytilgan — bog'lanish bor
  assert.equal(shown.length, 1);
});

test("yopiq guruh matnli e'loni: faqat ID — avval botga ko'rsatiladi, keyin navbatga; raqam yoki username bo'lsa — darhol; profil raqami faqat yopiqda", async () => {
  const CLOSED = { kind: "id", value: "-1001234567890" };
  const { store, reader } = setup();
  store.setSetting("bot_username", "Yuk_Ekspert_agent");
  const order = [];
  reader.showToBot = async (source, id) => (order.push(`show:${id}`), true);
  const msg = (id, extra = {}) => {
    const m = { id, text: "Toshkentdan Samarqandga 20 tonna un bor, fura kerak", date: NOW / 1000 - 5, sender: null, senderId: "555", ...extra };
    if (extra.phone) Object.defineProperty(m, "senderPhone", { value: extra.phone, enumerable: false });
    return m;
  };
  assert.equal(addMessage(CLOSED, msg(1), store, { via: "live", media: reader.media }), "media", "navbatga — botga ko'rsatish uchun");
  await settle();
  assert.deepEqual(order, ["show:1"]);
  assert.equal(store.senderReachable("555"), true);
  const [first] = store.takeNewPosts(5);
  assert.equal(first.messageId, 1);
  // Profil raqami bor — darhol, forward'siz; raqam postga yoziladi
  const r2 = addMessage(CLOSED, msg(2, { senderId: "556", phone: "+998901112233", text: "Andijondan Buxoroga 10 tonna yuk bor" }), store, { media: reader.media });
  assert.equal(r2.status, "new");
  assert.equal(store.takeNewPosts(5).find((p) => p.messageId === 2).senderPhone, "+998901112233");
  // Ochiq guruhda profil raqami yozilmaydi
  addMessage(SOURCE, msg(3, { phone: "+998901112233", text: "Namangandan Qarshiga 5 tonna yuk bor" }), store, { media: reader.media });
  assert.equal(store.takeNewPosts(5).find((p) => p.messageId === 3).senderPhone, null);
  assert.deepEqual(order, ["show:1"]);
});
