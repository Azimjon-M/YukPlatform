// Bot buyruqlari soxta Telegram bilan: so'rovlar internetga chiqmaydi, faqat yoziladi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { decodeProfile } from "@yuk/shared";
import { createBot, directText, postFromMessage } from "../src/bot.js";
import { readConfig } from "../src/config.js";
import { MENU } from "../src/menu.js";

const BOT_INFO = { id: 999, is_bot: true, first_name: "Yuk Ekspert", username: "Yuk_Ekspert_agent", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
const USER = { id: 42, is_bot: false, first_name: "Ali" };
const PRIVATE = { id: 42, type: "private", first_name: "Ali" };
const GROUP = { id: -1001234567890, type: "supergroup", title: "Yuk guruh", username: "yuk_guruh" };
const CHANNEL = { id: -1009876543210, type: "channel", title: "Yuk Ekspert", username: "Yuk_Ekspert" };

function setup({ fail, config: extra = {} } = {}) {
  const store = openStore({ file: ":memory:" });
  const config = { channel: "@Yuk_Ekspert", channelId: CHANNEL.id, admins: [], miniappUrl: null, ...extra };
  const { bot, publish, deliver } = createBot({ token: `123456:${"x".repeat(35)}`, store, config, log: () => {}, botInfo: BOT_INFO });
  const calls = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (fail?.(method, payload)) return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    if (method === "sendMessage" || method === "editMessageText") {
      return { ok: true, result: { message_id: ++messageId, date: 0, chat: { id: payload.chat_id }, text: payload.text } };
    }
    return { ok: true, result: true };
  });
  let updateId = 0;
  const send = (update) => bot.handleUpdate({ update_id: ++updateId, ...update });
  const message = (chat, text, extra = {}) => send({ message: { message_id: ++updateId, date: 1_700_000_000, chat, from: USER, text, ...extra } });
  const command = (text) => message(PRIVATE, text, { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] });
  const press = (data) =>
    send({ callback_query: { id: String(++updateId), from: USER, chat_instance: "x", data, message: { message_id: 101, date: 0, chat: PRIVATE, text: "..." } } });
  const webAppData = (data) => message(PRIVATE, undefined, { web_app_data: { data, button_text: MENU.settings } });
  return { store, calls, message, command, press, webAppData, publish, deliver };
}

const texts = (calls, method = "sendMessage") => calls.filter((c) => c.method === method).map((c) => c.payload.text);

test("/start: salom va birinchi savol, haydovchi bazada", async () => {
  const { store, calls, command } = setup();
  await command("/start");
  const sent = texts(calls);
  assert.match(sent[0], /Yuk Ekspert/);
  assert.match(sent[1], /Mashinangiz qaysi turdagi/);
  assert.equal(store.getDriver(42).draft.step, "class");
  assert.equal(store.getDriver(42).name, "Ali");
});

test("tugmalar bilan to'liq ro'yxatdan o'tish va /pauza", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  for (const data of ["w:class:isuzu", "w:body:tent", "w:capacity:5", "w:size:std", "w:sides:t.orqa", "w:sides:ok", "w:from:t.toshkent", "w:from:ok", "w:to:ok", "w:intl:yoq", "w:mode:own"]) {
    await press(data);
  }
  assert.equal(store.getDriver(42).draft.step, "done");
  assert.ok(calls.some((c) => c.method === "answerCallbackQuery"));
  await press("w:done:save");
  const driver = store.getDriver(42);
  assert.equal(driver.active, true);
  assert.equal(driver.draft, null);
  assert.equal(driver.profile.vehicle.capacityKg, 5000);
  assert.match(texts(calls).at(-1), /Saqlandi/);

  await command("/pauza");
  assert.equal(store.getDriver(42).active, false);
  await command("/davom");
  assert.equal(store.getDriver(42).active, true);
  await message(PRIVATE, "salom");
  assert.match(texts(calls).at(-1), /menyudan tanlang/);
});

test("sig'imni matn bilan yozish, noto'g'ri bo'lsa qayta so'raydi", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  await press("w:class:mini_fura");
  await press("w:body:tent");
  await message(PRIVATE, "ko'p");
  assert.match(texts(calls).at(-1), /tushunmadim/);
  await message(PRIVATE, "13,5");
  assert.equal(store.getDriver(42).draft.vehicle.capacityKg, 13500);
  assert.match(texts(calls).at(-1), /o'lchami/);
});

test("guruhdagi e'lon navbatga tushadi; kanal nusxasi va qisqa xabar tushmaydi", async () => {
  const { store, message } = setup();
  await message(GROUP, "Toshkentdan Samarqandga 20 t tent kerak +998900000001");
  await message(GROUP, "salom");
  await message({ ...GROUP, id: -1005555 }, "🚛 Toshkent → Samarqand ... kanal posti nusxasi", { is_automatic_forward: true, sender_chat: CHANNEL });
  const posts = store.takeNewPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].source, "@yuk_guruh");
  assert.match(posts[0].link, /^https:\/\/t\.me\/yuk_guruh\/\d+$/);
});

test("yopiq guruh havolasi va matnsiz xabar", () => {
  const post = postFromMessage({ id: -1001234, type: "supergroup" }, { message_id: 7, date: 10, caption: "Rasm izohi: Andijondan Buxoroga 10 tonna" });
  assert.equal(post.link, "https://t.me/c/1234/7");
  assert.equal(post.postedAt, 10_000);
  assert.equal(postFromMessage(GROUP, { message_id: 8, date: 10 }), null);
});

test("kanalga joylash va haydovchiga yuborish; bloklagan haydovchi to'xtatiladi", async () => {
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  const ok = setup();
  assert.equal(await ok.publish(load, post), 101);
  const channelCall = ok.calls.find((c) => c.payload.chat_id === "@Yuk_Ekspert");
  assert.equal(channelCall.payload.parse_mode, "HTML");
  const buttons = channelCall.payload.reply_markup.inline_keyboard.flat().map((b) => b.url);
  assert.deepEqual(buttons, ["https://t.me/yuk_guruh/5", "https://t.me/Yuk_Ekspert_agent?start=kanal"]);

  const blocked = setup({ fail: (method, p) => method === "sendMessage" && p.chat_id === 42 });
  blocked.store.saveDriver(42, { profile: { vehicle: {} }, active: true });
  assert.equal(await blocked.deliver(42, load, post), false);
  assert.equal(blocked.store.getDriver(42).active, false);
});

const MINIAPP = "https://yuk-ekspert.pages.dev/";
const PROFILE = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: null, loadingSides: ["orqa"] },
  fromAreas: ["toshkent"],
  toAreas: [],
  domestic: true,
  international: false,
  mode: "own",
};
const lastMarkup = (calls) => calls.filter((c) => c.method === "sendMessage").at(-1).payload.reply_markup;
const buttons = (markup) => markup.keyboard.flat();

test("pastki menyu: /start Mini App tugmasi bilan, savol-javobsiz", async () => {
  const { calls, command } = setup({ config: { miniappUrl: MINIAPP } });
  await command("/start");
  assert.equal(texts(calls).length, 1);
  assert.match(texts(calls)[0], /Ro'yxatdan o'tish/);
  const markup = lastMarkup(calls);
  assert.equal(markup.is_persistent, true);
  assert.equal(markup.resize_keyboard, true);
  const register = buttons(markup).find((b) => b.text === MENU.register);
  assert.equal(register.web_app.url, `${MINIAPP}?v=sozlamalar`); // ilova darhol sozlamalar bilan ochiladi
  assert.deepEqual(buttons(markup).map((b) => b.text), [MENU.loads, MENU.register, MENU.pause, MENU.apps, MENU.help]);
});

test("Mini App formasi saqlanadi; menyudagi manzil yangi sozlamalar bilan", async () => {
  const { store, calls, webAppData } = setup({ config: { miniappUrl: MINIAPP } });
  await webAppData(JSON.stringify({ type: "profile", profile: { ...PROFILE, hacker: 1 } }));
  const driver = store.getDriver(42);
  assert.deepEqual(driver.profile, PROFILE);
  assert.equal(driver.active, true);
  assert.match(texts(calls).at(-1), /Saqlandi[\s\S]*Isuzu/);
  const settings = buttons(lastMarkup(calls)).find((b) => b.text === MENU.settings);
  assert.deepEqual(decodeProfile(new URL(settings.web_app.url).searchParams.get("p")), PROFILE);
});

test("Mini App'dan buzilgan yoki noto'g'ri ma'lumot saqlanmaydi", async () => {
  const { store, calls, webAppData } = setup({ config: { miniappUrl: MINIAPP } });
  await webAppData("{buzilgan");
  assert.match(texts(calls).at(-1), /Saqlanmadi/);
  await webAppData(JSON.stringify({ type: "profile", profile: { vehicle: { truckClass: "raketa" } } }));
  assert.match(texts(calls).at(-1), /Saqlanmadi: Mashina turini/);
  assert.equal(store.getDriver(42).profile, null);
});

test("📋 Mos yuklar: faqat mos keladigani, havola matnda, tugmasiz", async () => {
  const { store, calls, message } = setup();
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), /Avval mashinangiz/);

  store.saveDriver(42, { profile: PROFILE, active: true });
  const post = store.addPost({ source: "@yuk_guruh", messageId: 5, link: "https://t.me/yuk_guruh/5", text: "Toshkentdan Samarqandga yuk bor", postedAt: Date.now() });
  store.addLoad({ postId: post.id, key: "a", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand", weightT: 3, phones: ["+998900000001"] } });
  store.addLoad({ postId: post.id, key: "b", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Buxoro", toRegion: "buxoro", weightT: 20, phones: ["+998900000002"] } });
  calls.length = 0;
  await message(PRIVATE, MENU.loads);
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.equal(sent.length, 2);
  assert.match(sent[0].payload.text, /mos 1 ta yuk/);
  assert.match(sent[1].payload.text, /Samarqand[\s\S]*\+998900000001[\s\S]*href="https:\/\/t\.me\/yuk_guruh\/5"/);
  assert.equal(sent[1].payload.reply_markup.inline_keyboard, undefined);
});

test("⏸ Pauza tugmasi: menyuda ▶️ Davom ettirish chiqadi", async () => {
  const { store, calls, message } = setup();
  store.saveDriver(42, { profile: PROFILE, active: true });
  await message(PRIVATE, MENU.pause);
  assert.equal(store.getDriver(42).active, false);
  assert.ok(buttons(lastMarkup(calls)).some((b) => b.text === MENU.resume));
  await message(PRIVATE, MENU.resume);
  assert.equal(store.getDriver(42).active, true);
  assert.ok(buttons(lastMarkup(calls)).some((b) => b.text === MENU.pause));
});

test("menyu tugmasi savol-javob o'rtasida ham ishlaydi, qoralama qoladi", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  await press("w:class:isuzu");
  await message(PRIVATE, MENU.apps);
  assert.match(texts(calls).at(-1), /Android: tez orada[\s\S]*@Yuk_Ekspert/);
  assert.equal(store.getDriver(42).draft.step, "body");
});

test("📱 Ilovalar: do'kon havolalari", async () => {
  const { calls, message } = setup({ config: { androidUrl: "https://play.google.com/store/apps/details?id=uz.yuk", iosUrl: null } });
  await message(PRIVATE, MENU.apps);
  assert.match(texts(calls).at(-1), /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=uz\.yuk">yuklab olish/);
  assert.match(texts(calls).at(-1), /iPhone: tez orada/);
});

test("haydovchiga yuk: asl e'lon havolasi matn ichida", () => {
  const text = directText({ fromCity: "Toshkent", toCity: "Samarqand" }, { link: "https://t.me/a/1?x=\"1\"" });
  assert.match(text, /<a href="https:\/\/t\.me\/a\/1\?x=&quot;1&quot;">📄 Asl e'lon<\/a>$/);
});

test("config: Mini App faqat https, APK yo'li YukPlatform papkasiga nisbatan", () => {
  const token = `123456:${"x".repeat(35)}`;
  assert.throws(() => readConfig({ BOT_TOKEN: token, MINIAPP_URL: "http://localhost:5173" }), /https/);
  assert.throws(() => readConfig({ BOT_TOKEN: token, APK_FILE: "data/app.zip" }), /\.apk/);
  const config = readConfig({ BOT_TOKEN: token, MINIAPP_URL: "https://yuk-ekspert.pages.dev", APK_FILE: "data/apk/yuk.apk" });
  assert.equal(config.miniappUrl, "https://yuk-ekspert.pages.dev/");
  assert.match(config.apkFile.split("\\").join("/"), /YukPlatform\/data\/apk\/yuk\.apk$/);
});
