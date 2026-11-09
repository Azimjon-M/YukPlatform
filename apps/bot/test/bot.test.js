// Bot buyruqlari soxta Telegram bilan: so'rovlar internetga chiqmaydi, faqat yoziladi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { decodeProfile } from "@yuk/shared";
import { createBot, directText, postFromMessage } from "../src/bot.js";
import { readConfig } from "../src/config.js";
import { MENU, PHONE } from "../src/menu.js";

const BOT_INFO = { id: 999, is_bot: true, first_name: "Yuk Ekspert", username: "Yuk_Ekspert_agent", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
const USER = { id: 42, is_bot: false, first_name: "Ali" };
const PRIVATE = { id: 42, type: "private", first_name: "Ali" };
const GROUP = { id: -1001234567890, type: "supergroup", title: "Yuk guruh", username: "yuk_guruh" };
const CHANNEL = { id: -1009876543210, type: "channel", title: "Yuk Ekspert", username: "Yuk_Ekspert" };

function setup({ fail, config: extra = {}, appUrl, linkToken } = {}) {
  const store = openStore({ file: ":memory:" });
  const config = { channel: "@Yuk_Ekspert", channelId: CHANNEL.id, admins: [], miniappUrl: null, ...extra };
  const { bot, publish, deliver } = createBot({ token: `123456:${"x".repeat(35)}`, store, config, log: () => {}, botInfo: BOT_INFO, appUrl, linkToken });
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

const inlineButtons = (call) => call.payload.reply_markup.inline_keyboard.flat();

test("/start: avval «Siz kimsiz?», keyin haydovchiga birinchi savol", async () => {
  const { store, calls, command, press } = setup();
  await command("/start");
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.match(sent[0].payload.text, /Yuk Ekspert[\s\S]*haydovchiga[\s\S]*yuk beruvchiga/);
  assert.match(sent[1].payload.text, /Siz kimsiz/);
  assert.deepEqual(inlineButtons(sent[1]).map((b) => b.callback_data), ["r:haydovchi", "r:yuk_beruvchi"]);
  assert.equal(store.getDriver(42).role, null);
  assert.equal(store.getDriver(42).name, "Ali");

  await press("r:haydovchi");
  assert.match(texts(calls, "editMessageText").at(-1), /Haydovchiman/);
  assert.equal(store.getDriver(42).role, "haydovchi");
  assert.match(texts(calls).at(-1), /Transportingiz qaysi turdagi/);
  assert.equal(store.getDriver(42).draft.step, "class");
});

test("tugmalar bilan to'liq ro'yxatdan o'tish va /pauza", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  for (const data of ["r:haydovchi", "w:class:isuzu", "w:body:tent", "w:capacity:5", "w:size:std", "w:sides:t.orqa", "w:sides:ok", "w:intl:yoq"]) {
    await press(data);
  }
  assert.equal(store.getDriver(42).draft.step, "done", "yo'nalish va «qaysi yuklar» savollari yo'q");
  assert.ok(calls.some((c) => c.method === "answerCallbackQuery"));
  await press("w:done:save");
  const driver = store.getDriver(42);
  assert.equal(driver.active, true);
  assert.equal(driver.draft, null);
  assert.equal(driver.profile.vehicle.capacityKg, 5000);
  assert.equal(driver.profile.routeAt, null);
  // Yo'nalish hali tanlanmagan — «Saqlandi» dan keyin darrov «Qayerdan?»
  assert.match(texts(calls).at(-2), /Saqlandi[\s\S]*Yo'nalish: tanlanmagan[\s\S]*Endi qayerdan qayerga/);
  assert.match(texts(calls).at(-1), /Qayerdan yuk olasiz/);
  await press("mr:f:*");
  assert.match(texts(calls, "editMessageText").at(-1), /Qayerdan: <b>hamma joy<\/b>[\s\S]*Qayerga borasiz/);
  await press("mr:t:*:*");
  assert.ok(store.getDriver(42).profile.routeAt > 0);
  assert.match(texts(calls, "editMessageText").at(-1), /Yo'nalish: <b>hamma joy → istalgan joy/);
  // Yo'nalish tanlangach — raqam so'raladi (ixtiyoriy, bir marta)
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi/);

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
  await press("r:haydovchi");
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

test("kanalga yuk standart holatda joylanmaydi (CHANNEL_LOADS yo'q)", async () => {
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  const off = setup();
  assert.equal(await off.publish(load, post), null);
  assert.equal(off.calls.filter((c) => c.method === "sendMessage").length, 0);
});

test("kanalga joylash (CHANNEL_LOADS=1) va haydovchiga yuborish; bloklagan haydovchi to'xtatiladi", async () => {
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 20, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  const ok = setup({ config: { channelLoads: true } });
  assert.equal(await ok.publish(load, post), 101);
  const channelCall = ok.calls.find((c) => c.payload.chat_id === "@Yuk_Ekspert");
  assert.equal(channelCall.payload.parse_mode, "HTML");
  const buttons = channelCall.payload.reply_markup.inline_keyboard.flat().map((b) => b.url);
  assert.deepEqual(buttons, ["https://t.me/yuk_guruh/5", "https://t.me/Yuk_Ekspert_agent?start=kanal"]);

  const blocked = setup({ fail: (method, p) => method === "sendMessage" && p.chat_id === 42 });
  blocked.store.saveDriver(42, { profile: { vehicle: {} }, active: true });
  assert.deepEqual(await blocked.deliver(42, load, post), { ok: false, error: "Forbidden: bot was blocked by the user" });
  assert.equal(blocked.store.getDriver(42).active, false);
  assert.deepEqual(await ok.deliver(42, load, post), { ok: true });
});

const MINIAPP = "https://yuk-ekspert.pages.dev/";
// Yo'nalishi tanlangan haydovchi (2026-11-07 gacha yo'nalish formada edi — routeAt yo'q, joylari bor)
const PROFILE = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: null, bodyGuess: false, loadingSides: ["orqa"] },
  fromAreas: ["toshkent"],
  toAreas: [],
  domestic: true,
  international: false,
  routeAt: null,
  mode: "own",
};
// Ro'yxatdan o'tish formasi yo'nalish yubormaydi
const FORM = { ...PROFILE, fromAreas: [] };
const lastMarkup = (calls) => calls.filter((c) => c.method === "sendMessage").at(-1).payload.reply_markup;
const buttons = (markup) => markup.keyboard.flat();

test("pastki menyu: rol tanlangach Mini App tugmasi, savol-javobsiz", async () => {
  const { calls, command, press } = setup({ config: { miniappUrl: MINIAPP } });
  await command("/start");
  // Rol hali yo'q — sozlamalar tugmasi oddiy matn (bosilsa "Siz kimsiz?")
  const first = calls.filter((c) => c.method === "sendMessage")[0].payload.reply_markup;
  assert.equal(buttons(first).find((b) => b.text === MENU.register).web_app, undefined);
  assert.ok(!buttons(first).some((b) => b.text === MENU.role), "rol tanlanmagan — almashtirish tugmasi yo'q");

  calls.length = 0;
  await press("r:haydovchi");
  assert.equal(texts(calls).length, 1);
  assert.match(texts(calls)[0], /Ro'yxatdan o'tish/);
  const markup = lastMarkup(calls);
  assert.equal(markup.is_persistent, undefined); // yig'iladigan: yozish qatoridagi belgi menyuni ochib-yopadi
  assert.equal(markup.resize_keyboard, true);
  const register = buttons(markup).find((b) => b.text === MENU.register);
  assert.equal(register.web_app.url, `${MINIAPP}?v=sozlamalar&r=haydovchi`); // ilova darhol sozlamalar bilan ochiladi
  assert.deepEqual(buttons(markup).map((b) => b.text), [MENU.loads, MENU.register, MENU.pause, MENU.phone, MENU.role, MENU.help]);
});

test("web'dan hisobdan chiqqan (store.signOut): bot yangi odamdek — «Siz kimsiz?», rolni tanlasa sozlamalari tiklanadi", async () => {
  const { store, calls, command, message, press } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  store.signOut(42);

  await message(PRIVATE, MENU.loads); // eski menyudagi «📋 Mos yuklar» — ishlamaydi, avval ro'yxatdan o'tish
  assert.match(texts(calls).at(-1), /Siz kimsiz/);
  calls.length = 0;
  await command("/start");
  const menu = calls.filter((c) => c.method === "sendMessage")[0].payload.reply_markup;
  assert.ok(buttons(menu).some((b) => b.text === MENU.register), "menyuda «Ro'yxatdan o'tish»");
  assert.ok(!buttons(menu).some((b) => b.text === MENU.settings));

  calls.length = 0;
  await press("r:haydovchi");
  assert.match(texts(calls).at(-1), /Oldingi sozlamalaringiz tiklandi/);
  assert.deepEqual(store.getDriver(42).profile, PROFILE);
  assert.equal(store.getDriver(42).active, true);
});

test("pastki menyudagi «🔄 Rolni almashtirish» — /rol bilan bir xil: hozirgi rol va ikki tugma", async () => {
  const { store, calls, message, press } = setup({ config: { miniappUrl: MINIAPP, admins: [42] } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  await message(PRIVATE, MENU.role);
  const sent = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(sent.payload.text, /Hozir siz: <b>🚚 Haydovchi[\s\S]*alohida saqlanadi/);
  assert.deepEqual(inlineButtons(sent).map((b) => b.callback_data), ["r:haydovchi", "r:yuk_beruvchi"]);
  await press("r:yuk_beruvchi");
  assert.equal(store.getDriver(42).role, "yuk_beruvchi");
  // Menyu qatorlari: rol va yordam bir qatorda, admin tugmasi alohida pastda
  const rows = lastMarkup(calls).keyboard.map((row) => row.map((b) => b.text));
  assert.deepEqual(rows, [[MENU.trucks, MENU.register], [MENU.pause, MENU.phone], [MENU.role, MENU.help], [MENU.admin]]);
});

test("Mini App formasi saqlanadi → «Qayerdan? Qayerga?»; yo'nalish keyingi saqlashda ham qoladi", async () => {
  const { store, calls, webAppData, press } = setup({ config: { miniappUrl: MINIAPP } });
  // Rol yo'q va forma ham rol yubormadi — saqlanmaydi
  await webAppData(JSON.stringify({ type: "profile", profile: FORM }));
  assert.match(texts(calls).at(-1), /Saqlanmadi: Avval kim ekaningizni tanlang/);
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: { ...FORM, hacker: 1 } }));
  let driver = store.getDriver(42);
  assert.deepEqual(driver.profile, FORM);
  assert.equal(driver.role, "haydovchi");
  assert.equal(driver.active, true);
  // Oxirgisi — «Qayerdan?» (raqam yo'nalishdan keyin so'raladi), undan oldingisi — «Saqlandi» (asosiy menyu bilan)
  const sent = calls.filter((c) => c.method === "sendMessage");
  const savedMessage = sent.at(-2).payload;
  assert.match(savedMessage.text, /Saqlandi[\s\S]*Isuzu[\s\S]*qayerdan qayerga/);
  const settings = buttons(savedMessage.reply_markup).find((b) => b.text === MENU.settings);
  assert.deepEqual(decodeProfile(new URL(settings.web_app.url).searchParams.get("p")), FORM);
  const from = inlineButtons(sent.at(-1)).map((b) => b.callback_data);
  assert.ok(from.includes("mr:f:toshkent_sh") && from.includes("mr:f:*"));
  assert.ok(!from.includes("mr:last"), "oxirgi yo'nalish hali yo'q");
  assert.ok(!from.some((d) => d.includes("Qozog")), "«Faqat O'zbekiston» — davlat tugmalari yo'q");

  // Samarqand → Toshkent vil.
  await press("mr:f:samarqand");
  const to = calls.filter((c) => c.method === "editMessageText").at(-1);
  assert.match(to.payload.text, /Qayerdan: <b>Samarqand vil\.<\/b>/);
  assert.ok(inlineButtons(to).some((b) => b.callback_data === "mr:t:samarqand:toshkent"));
  assert.ok(inlineButtons(to).some((b) => b.callback_data === "mr:back"));
  await press("mr:t:samarqand:toshkent");
  driver = store.getDriver(42);
  assert.deepEqual([driver.profile.fromAreas, driver.profile.toAreas], [["samarqand"], ["toshkent"]]);
  assert.match(texts(calls).at(-2), /mos yuk chiqmadi/);
  assert.match(texts(calls).at(-1), /ulashasizmi/);

  // Formani yana saqlasa — yo'nalish o'zgarmaydi
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: { ...FORM, vehicle: { ...FORM.vehicle, capacityKg: 4000 } } }));
  driver = store.getDriver(42);
  assert.equal(driver.profile.vehicle.capacityKg, 4000);
  assert.deepEqual(driver.profile.fromAreas, ["samarqand"]);
  assert.match(texts(calls).at(-1), /Saqlandi[\s\S]*Yo'nalish: Samarqand vil\. → Toshkent vil\./);
});

test("Mini App'dan buzilgan yoki noto'g'ri ma'lumot saqlanmaydi", async () => {
  const { store, calls, webAppData } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi" });
  await webAppData("{buzilgan");
  assert.match(texts(calls).at(-1), /Saqlanmadi/);
  await webAppData(JSON.stringify({ type: "profile", profile: { vehicle: { truckClass: "raketa" } } }));
  assert.match(texts(calls).at(-1), /Saqlanmadi: Transport turini/);
  assert.equal(store.getDriver(42).profile, null);
});

test("📋 Mos yuklar: avval «Qayerdan?», keyin faqat mos keladigani, havola matnda, tugmasiz", async () => {
  const { store, calls, message, press } = setup();
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), /Siz kimsiz/);
  store.saveDriver(42, { role: "haydovchi" });
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), /Avval transportingizni/);

  store.saveDriver(42, { profile: PROFILE, active: true });
  const post = store.addPost({ source: "@yuk_guruh", messageId: 5, link: "https://t.me/yuk_guruh/5", text: "Toshkentdan Samarqandga yuk bor", postedAt: Date.now() });
  store.addLoad({ postId: post.id, key: "a", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand", weightT: 3, phones: ["+998900000001"] } });
  store.addLoad({ postId: post.id, key: "b", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Buxoro", toRegion: "buxoro", weightT: 20, phones: ["+998900000002"] } });
  store.addLoad({ postId: post.id, key: "c", load: { fromCity: "Andijon", fromRegion: "andijon", toCity: "Namangan", toRegion: "namangan", weightT: 2, phones: ["+998900000003"] } });
  // Avval yo'nalish so'raladi: hozirgisi matnda va ✅ bilan, har joydagi mos yuklar soni (Buxoroga 20 tonna Isuzuga sig'maydi)
  calls.length = 0;
  await message(PRIVATE, MENU.loads);
  const ask = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(ask.payload.text, /Qayerdan yuk olasiz[\s\S]*Hozirgi yo'nalish: <b>Toshkent vil\. → istalgan joy/);
  const labels = inlineButtons(ask).map((b) => b.text);
  assert.ok(!inlineButtons(ask).some((b) => b.callback_data === "mr:last"), "«🔁» tugmasi yo'q — har safar «Qayerga?» ham so'raladi");
  assert.match(inlineButtons(ask).find((b) => b.callback_data === "mr:f:toshkent").text, /^✅ Toshkent vil\./);
  assert.equal(labels.filter((t) => t.startsWith("✅")).length, 1);
  assert.ok(labels.includes("Toshkent shahri (1)") && labels.includes("Andijon vil. (1)") && labels.includes("Buxoro vil."));
  assert.ok(labels.includes("🌐 Hamma joydan (2)"));
  // Shu joy qayta tanlansa ham — «Qayerga?» (avval «🔁 Toshkent vil. → istalgan joy» ni bosganda so'ralmasdi).
  // ✅ belgisi «Qayerga?» da — route.test.js da (bu profil 2026-11-07 dan oldingi: routeAt yo'q)
  await press("mr:f:toshkent");
  const toAsk = calls.filter((c) => c.method === "editMessageText").at(-1);
  assert.match(toAsk.payload.text, /Qayerdan: <b>Toshkent vil\.<\/b>[\s\S]*Qayerga borasiz/);
  assert.ok(inlineButtons(toAsk).some((b) => /Istalgan joyga/.test(b.text) && b.callback_data === "mr:t:toshkent:*"));
  assert.equal(store.getDriver(42).profile.routeAt, null, "«Qayerga?» tanlanmaguncha hech narsa saqlanmaydi");
  await press("mr:back");
  // Eski yoki soxta joy — qayta «Qayerdan?»
  await press("mr:f:Rossiya");
  assert.match(texts(calls, "editMessageText").at(-1), /Qayerdan yuk olasiz/);
  // Chatda qolgan eski «🔁» tugmasi — oxirgi yo'nalish bilan ro'yxat
  calls.length = 0;
  await press("mr:last");
  assert.match(texts(calls, "editMessageText").at(-1), /Yo'nalish: <b>Toshkent vil\. → istalgan joy/);
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.equal(sent.length, 2);
  assert.match(sent[0].payload.text, /mos 1 ta yuk/);
  assert.match(sent[1].payload.text, /Samarqand[\s\S]*\+998900000001[\s\S]*href="https:\/\/t\.me\/yuk_guruh\/5"/);
  assert.equal(sent[1].payload.reply_markup.inline_keyboard, undefined);

  // Andijon → istalgan joy: yo'nalish saqlanadi, ro'yxatda Andijon yuki
  calls.length = 0;
  await press("mr:f:andijon");
  await press("mr:t:andijon:*");
  assert.deepEqual(store.getDriver(42).profile.fromAreas, ["andijon"]);
  assert.match(texts(calls).at(-2), /Andijon[\s\S]*\+998900000003/);
  assert.match(texts(calls).at(-1), /ulashasizmi/, "raqam hali so'ralmagan edi — bir marta so'raladi");

  // Yuk beruvchi eski tugmani bossa — «eskirgan», o'z ro'yxati
  store.switchRole(42, "yuk_beruvchi");
  calls.length = 0;
  await press("mr:last");
  assert.match(texts(calls, "editMessageText").at(-1), /eskirgan/);
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
  await press("r:haydovchi");
  await press("w:class:isuzu");
  await message(PRIVATE, MENU.apps);
  assert.match(texts(calls).at(-1), /Android: tez orada/);
  assert.doesNotMatch(texts(calls).at(-1), /@Yuk_Ekspert/, "yuklar kanalga chiqmaydi — kanalni ko'rsatmaymiz");
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

test("config: POST_MAX_AGE_HOURS — standart 3 soat, 0 — cheklovsiz, vergul ham bo'ladi", () => {
  const token = `123456:${"x".repeat(35)}`;
  const age = (value) => readConfig({ BOT_TOKEN: token, POST_MAX_AGE_HOURS: value }).maxPostAgeMs;
  assert.equal(age(undefined), 3 * 3_600_000);
  assert.equal(age(" "), 3 * 3_600_000);
  assert.equal(age("0"), 0);
  assert.equal(age("1,5"), 5_400_000);
  assert.equal(age("6"), 6 * 3_600_000);
  for (const bad of ["abc", "-1", "3 soat"]) assert.throws(() => age(bad), /POST_MAX_AGE_HOURS/, bad);
});

test("config: CHANNEL_LOADS — standart o'chiq, 1 / ha / true yoqadi", () => {
  const token = `123456:${"x".repeat(35)}`;
  const flag = (value) => readConfig({ BOT_TOKEN: token, CHANNEL_ID: "@Yuk_Ekspert", CHANNEL_LOADS: value }).channelLoads;
  assert.equal(flag(undefined), false);
  assert.equal(flag(""), false);
  assert.equal(flag("0"), false);
  assert.equal(flag("yo'q"), false);
  for (const on of ["1", "ha", "true", " ON "]) assert.equal(flag(on), true, on);
});

// Telegram pastki menyu tugmasidan ochilgan Mini App'ga initData bermaydi — bot tugma manziliga shu odamning tokenini qo'yadi
test("Mini App tugmasida kirish tokeni (?t=): o'sha odamniki, har yuk xabari bilan menyu (token almashsa — yangisi)", async () => {
  let week = 1;
  const { store, calls, command, deliver } = setup({ config: { miniappUrl: MINIAPP, admins: [42] }, linkToken: (chatId) => `tok-${chatId}-w${week}` });
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 5, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  const sent = () => calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === 42).at(-1).payload;
  const urlOf = (markup, text) => new URL(buttons(markup).find((b) => b.text === text).web_app.url);

  await command("/start");
  assert.equal(urlOf(sent().reply_markup, MENU.settings).searchParams.get("t"), "tok-42-w1");
  assert.equal(urlOf(sent().reply_markup, MENU.admin).searchParams.get("t"), "tok-42-w1", "«🛠 Boshqaruv» ham kirishi kerak");
  // Har yuk xabari menyu bilan boradi — chatga qaytganda pastki menyu ochiq turadi
  await deliver(42, load, post);
  assert.equal(urlOf(sent().reply_markup, MENU.settings).searchParams.get("t"), "tok-42-w1");
  assert.equal(sent().reply_markup.is_persistent, undefined, "yig'iladigan menyu");

  // Yangi hafta — yangi token: keyingi yuk bilan menyu ham yangilanadi (eskisi baribir yana bir necha hafta ishlaydi)
  week = 2;
  await deliver(42, load, post);
  assert.equal(urlOf(sent().reply_markup, MENU.settings).searchParams.get("t"), "tok-42-w2");

  // Rol tanlanmagan foydalanuvchida Mini App tugmasi yo'q — token ham yo'q
  calls.length = 0;
  await deliver(77, load, post);
  assert.ok(!JSON.stringify(calls).includes("tok-77"));
});

test("tunnel manzili o'zgarsa: keyingi yuk xabaridagi pastki menyu yangi manzil bilan", async () => {
  let url = "https://bir-ikki-uch-tort.trycloudflare.com/";
  const { store, calls, command, deliver } = setup({ appUrl: () => url });
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 5, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  store.saveDriver(42, { profile: PROFILE, active: true });
  const sent = () => calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === 42).at(-1).payload;
  const settingsUrl = (markup) => buttons(markup).find((b) => b.text === MENU.settings)?.web_app?.url ?? null;

  await deliver(42, load, post);
  assert.match(settingsUrl(sent().reply_markup), /^https:\/\/bir-ikki-uch-tort\.trycloudflare\.com\/\?v=sozlamalar/);
  // Manzil o'sha — keyingi yuk ham menyu bilan (yopilgan menyu yana ochiladi)
  await command("/start");
  await deliver(42, load, post);
  assert.match(settingsUrl(sent().reply_markup), /bir-ikki-uch-tort/);

  // Tunnel qayta yoqildi — yangi manzil
  url = "https://besh-olti-yetti-sakkiz.trycloudflare.com/";
  await deliver(42, load, post);
  assert.match(settingsUrl(sent().reply_markup), /besh-olti-yetti-sakkiz/);

  // Tunnel o'chdi — tugma oddiy matnga aylanadi (bosilsa chatda savol-javob)
  url = null;
  await deliver(42, load, post);
  const markup = sent().reply_markup;
  assert.equal(settingsUrl(markup), null);
  assert.ok(buttons(markup).some((b) => b.text === MENU.settings));
});

test("yuk beruvchi: rol → savol-javob → saqlash; menyuda «🚚 Bo'sh mashinalar»", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  await press("r:yuk_beruvchi");
  assert.match(texts(calls).at(-1), /Yukingiz qayerda yuklanadi/);
  for (const data of ["w:from:t.samarqand", "w:from:ok", "w:to:ok", "w:classes:t.fura", "w:classes:ok", "w:bodies:ok", "w:intl:yoq"]) {
    await press(data);
  }
  await press("w:done:save");
  const user = store.getDriver(42);
  assert.equal(user.role, "yuk_beruvchi");
  assert.equal(user.active, true);
  assert.deepEqual(user.profile.truckClasses, ["fura"]);
  const savedMessage = calls.filter((c) => c.method === "sendMessage").at(-2).payload; // oxirgisi — raqam so'rovi
  assert.match(savedMessage.text, /Saqlandi\. Endi mos bo'sh mashinalar[\s\S]*Yuk qayerda: Samarqand/);
  assert.deepEqual(buttons(savedMessage.reply_markup).map((b) => b.text), [MENU.trucks, MENU.settings, MENU.pause, MENU.phone, MENU.role, MENU.help]);

  // 24 soatdagi bo'sh mashinalar: mos keladigani (Samarqand, fura); boshqa viloyat va yuk e'loni — yo'q
  const post = store.addPost({ source: "@yuk_guruh", messageId: 9, link: "https://t.me/yuk_guruh/9", text: "Samarqanddan bo'sh fura bor", postedAt: Date.now() });
  store.addLoad({ postId: post.id, key: "m1", kind: "mashina", load: { fromCity: "Samarqand", fromRegion: "samarqand", truckClass: "fura", bodyType: "tent", weightT: 22, phones: ["+998900000009"] } });
  store.addLoad({ postId: post.id, key: "m2", kind: "mashina", load: { fromCity: "Nukus", fromRegion: "qoraqalpogiston", truckClass: "fura", phones: ["+998900000008"] } });
  store.addLoad({ postId: post.id, key: "y1", load: { fromCity: "Samarqand", fromRegion: "samarqand", toCity: "Toshkent", weightT: 20, phones: ["+998900000007"] } });
  calls.length = 0;
  await message(PRIVATE, MENU.trucks);
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.equal(sent.length, 2);
  assert.match(sent[0].payload.text, /mos 1 ta bo'sh mashina/);
  assert.match(sent[1].payload.text, /Bo'sh mashina: Samarqand → istalgan joyga[\s\S]*22 tonna ko'taradi[\s\S]*\+998900000009/);
  // Eski «📋 Mos yuklar» tugmasi bosilsa ham — hozirgi rol bo'yicha
  calls.length = 0;
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls)[0], /bo'sh mashina/);
});

test("/rol: boshqa rolga o'tsa sozlamalari saqlanadi, qaytsa tiklanadi; o'sha rol — hech narsa o'zgarmaydi", async () => {
  const { store, calls, command, press } = setup();
  store.saveDriver(42, { profile: PROFILE, active: true, phoneAskedAt: 1 }); // rollardan oldingi haydovchi (role ustuni bo'sh)
  await command("/rol");
  assert.match(texts(calls).at(-1), /Hozir siz: <b>🚚 Haydovchi/);
  await press("r:haydovchi");
  assert.match(texts(calls).at(-1), /hech narsa o'zgarmadi/);
  assert.deepEqual(store.getDriver(42).profile, PROFILE);

  // Yuk beruvchi — bu rolda hali sozlama yo'q, savol-javob boshlanadi
  await press("r:yuk_beruvchi");
  let user = store.getDriver(42);
  assert.equal(user.role, "yuk_beruvchi");
  assert.equal(user.profile, null);
  assert.equal(user.draft.step, "from");
  assert.equal(store.activeUsers("haydovchi").length, 0, "endi unga yuk bormaydi");

  // Haydovchiga qaytdi — mashinasi va yo'nalishi qaytadan so'ralmaydi
  await press("r:haydovchi");
  user = store.getDriver(42);
  assert.equal(user.role, "haydovchi");
  assert.deepEqual(user.profile, PROFILE);
  assert.equal(user.draft, null, "yuk beruvchi savol-javobi tashlandi");
  assert.match(texts(calls).at(-1), /Oldingi sozlamalaringiz tiklandi — mos yuklar yana shu yerga keladi/);
  assert.deepEqual(buttons(lastMarkup(calls)).map((b) => b.text), [MENU.loads, MENU.settings, MENU.pause, MENU.phone, MENU.role, MENU.help]);
  assert.deepEqual(store.activeUsers("haydovchi").map((u) => u.chatId), [42], "yuklar yana boradi");
});

test("bo'sh mashina xabari yuk beruvchiga; Mini App rol bilan; admin menyusida «🛠 Boshqaruv»", async () => {
  const { store, calls, deliver, command } = setup({ config: { miniappUrl: MINIAPP, admins: [42] } });
  const empty = { fromAreas: [], toAreas: [], domestic: true, international: false, truckClasses: [], bodyTypes: [] };
  // phoneAskedAt — raqam allaqachon so'ralgan: /start raqam so'ramaydi, oxirgi xabar menyu bilan
  store.saveDriver(42, { role: "yuk_beruvchi", profile: empty, active: true, phoneAskedAt: 1 });
  const truck = { fromCity: "Andijon", fromRegion: "andijon", toCity: "Toshkent", truckClass: "isuzu", bodyType: "tent", phones: ["+998900000005"] };
  assert.deepEqual(await deliver(42, truck, { link: "https://t.me/yuk_guruh/7" }, "mashina"), { ok: true });
  const payload = calls.filter((c) => c.method === "sendMessage").at(-1).payload;
  assert.match(payload.text, /^🚚 <b>Bo'sh mashina: Andijon → Toshkent<\/b>[\s\S]*Isuzu[\s\S]*href="https:\/\/t\.me\/yuk_guruh\/7"/);

  await command("/start");
  const menuButtons = buttons(lastMarkup(calls));
  const settings = new URL(menuButtons.find((b) => b.text === MENU.settings).web_app.url);
  assert.equal(settings.searchParams.get("r"), "yuk_beruvchi");
  assert.deepEqual(decodeProfile(settings.searchParams.get("p"), { role: "yuk_beruvchi" }), empty);
  const admin = new URL(menuButtons.find((b) => b.text === MENU.admin).web_app.url);
  assert.equal(admin.searchParams.get("v"), "admin");

  // Admin emas — tugma yo'q, /holat javob bermaydi
  const plain = setup({ config: { miniappUrl: MINIAPP } });
  plain.store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  await plain.command("/start");
  assert.ok(!buttons(lastMarkup(plain.calls)).some((b) => b.text === MENU.admin));
  const before = plain.calls.length;
  await plain.command("/holat");
  assert.equal(plain.calls.length, before);
  await command("/holat");
  assert.match(texts(calls).at(-1), /Yuk beruvchilar: 1 faol \/ 1/);
});

// --- Telefon raqami (ixtiyoriy) ---
const contact = (fields) => ({ contact: { first_name: "Ali", phone_number: "998901234567", ...fields } });

test("raqam: eski foydalanuvchidan /start da bir marta so'raladi; faqat o'z kontakti saqlanadi", async () => {
  const { store, calls, command, message } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true }); // raqam so'rashdan oldin ro'yxatdan o'tgan
  await command("/start");
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi\?[\s\S]*Ixtiyoriy/);
  const asked = lastMarkup(calls);
  assert.deepEqual(asked.keyboard.flat(), [{ text: PHONE.share, request_contact: true }, { text: PHONE.later }]);
  assert.equal(asked.one_time_keyboard, true);
  assert.ok(store.getDriver(42).phoneAskedAt > 0);

  // Ikkinchi /start — boshqa so'ramaydi
  await command("/start");
  assert.doesNotMatch(texts(calls).at(-1), /ulashasizmi/);

  // Birovning kontakti (ilova menyusidan) va Telegram'siz kontakt — saqlanmaydi
  await message(PRIVATE, undefined, contact({ user_id: 77, first_name: "Vali" }));
  assert.match(texts(calls).at(-1), /boshqa odamning kontakti/);
  await message(PRIVATE, undefined, contact({}));
  assert.equal(store.getDriver(42).phone, null);

  // O'z raqami — saqlanadi, asosiy menyu qaytadi
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  const user = store.getDriver(42);
  assert.equal(user.phone, "+998901234567");
  assert.ok(user.phoneAt > 0);
  assert.match(texts(calls).at(-1), /Raqamingiz saqlandi: \+998 90 123 45 67/);
  assert.equal(buttons(lastMarkup(calls))[0].text, MENU.loads);

  // /raqam — hozirgi raqam va «O'zgartirmaslik»
  await command("/raqam");
  assert.match(texts(calls).at(-1), /Sizning raqamingiz: <b>\+998 90 123 45 67/);
  assert.equal(buttons(lastMarkup(calls))[1].text, PHONE.keep);
  await message(PRIVATE, PHONE.keep);
  assert.match(texts(calls).at(-1), /Raqamingiz o'zgarmadi/);
  assert.equal(store.getDriver(42).phone, "+998901234567");
});

test("/start matni: avval yuk beruvchidan to'g'ridan-to'g'ri, keyin guruhlar; menyuda «Ilovalar» o'rnida raqam tugmasi", async () => {
  const { store, calls, command, message } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", active: true, phoneAskedAt: 1 });
  await command("/start");
  const text = texts(calls).find((t) => /Pastdagi menyu/.test(t));
  assert.match(text, /^🚛 <b>Yuk Ekspert<\/b> — yuk beruvchidan yukni to'g'ridan-to'g'ri olib, haydovchilarga yetkazadi/);
  assert.ok(text.indexOf("to'g'ridan-to'g'ri") < text.indexOf("katta yuk guruhlari"), "avval to'g'ridan-to'g'ri, keyin guruhlar");
  assert.match(text, /📱 Raqam ulashish — raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham/);
  assert.doesNotMatch(text, /qo'ng'iroq qilasiz/);
  assert.doesNotMatch(text, /📱 Ilovalar/);
  assert.match(text, /\/ilovalar/);

  // Raqam yo'q — menyudagi tugma bir bosishda raqamni so'raydi (request_contact)
  const phoneButton = buttons(lastMarkup(calls)).find((b) => b.text === MENU.phone);
  assert.equal(phoneButton.request_contact, true);
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  assert.equal(store.getDriver(42).phone, "+998901234567");

  // Raqam bor — tugma o'sha «📱 Raqam ulashish» (bossa, yangi raqami saqlanadi); eski menyudagi «📱 Raqamim» — /raqam
  assert.equal(buttons(lastMarkup(calls)).find((b) => b.text === MENU.phone)?.request_contact, true);
  assert.ok(!buttons(lastMarkup(calls)).some((b) => b.text === MENU.myPhone));
  await message(PRIVATE, MENU.myPhone);
  assert.match(texts(calls).at(-1), /Sizning raqamingiz: <b>\+998 90 123 45 67/);

  // Ilovalar endi buyruq bilan (eski menyudagi tugma ham ishlayveradi)
  await command("/ilovalar");
  assert.match(texts(calls).at(-1), /Yuk Ekspert ilovalari/);
});

test("/start matni rol tanlanmaganda va yuk beruvchida ham to'g'ridan-to'g'ri yuk bilan boshlanadi", async () => {
  const { store, calls, command } = setup();
  await command("/start");
  assert.match(texts(calls)[0], /^🚛 <b>Yuk Ekspert<\/b> — yuk beruvchidan yukni to'g'ridan-to'g'ri olib[\s\S]*katta yuk guruhlaridagi/);
  calls.length = 0;
  store.saveDriver(42, { role: "yuk_beruvchi", active: true, phoneAskedAt: 1 });
  await command("/start");
  assert.match(texts(calls)[0], /yukingiz vositachisiz, to'g'ridan-to'g'ri mos haydovchilarga boradi[\s\S]*«mashina bo'sh» e'lonlarini saralab/);
});

test("raqam: «Keyinroq» — menyu qaytadi va bot boshqa so'ramaydi", async () => {
  const { store, calls, webAppData, message, command } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE }); // yo'nalishi bor — saqlagach darrov raqam so'raladi
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: FORM }));
  assert.deepEqual(store.getDriver(42).profile.fromAreas, ["toshkent"], "yo'nalish qoldi");
  assert.match(texts(calls).at(-1), /ulashasizmi/);
  await message(PRIVATE, PHONE.later);
  assert.match(texts(calls).at(-1), /Mayli[\s\S]*\/raqam/);
  assert.equal(buttons(lastMarkup(calls))[0].text, MENU.loads);
  // Sozlamalarni yana saqlasa ham, /start bossa ham — so'ramaydi
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: FORM }));
  assert.match(texts(calls).at(-1), /Saqlandi/);
  await command("/start");
  assert.doesNotMatch(texts(calls).at(-1), /ulashasizmi/);
  assert.equal(store.getDriver(42).phone, null);
});

test("avtomatik pauza tugmalari: «✅ Ha, davom etsin» — davom etadi; «▶️ Davom ettirish» — pauzadan chiqaradi", async () => {
  const { store, calls, press } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true });
  await press("idle:ok");
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").payload.text, "✅ Rahmat!");
  assert.ok(calls.some((c) => c.method === "editMessageReplyMarkup"), "tugma olib tashlanadi");
  assert.match(texts(calls).at(-1), /yuklar kelishda davom etadi/);
  assert.equal(store.getDriver(42).seenVia, "bot", "bosishning o'zi — faollik");

  store.saveDriver(42, { active: false, why: "idle" });
  await press("idle:resume");
  const user = store.getDriver(42);
  assert.deepEqual([user.active, user.pausedBy], [true, null]);
  assert.match(texts(calls).at(-1), /Yuk yuborish yoqildi/);
  assert.deepEqual(
    store.driverDetails(42).events.slice(0, 2).map((e) => [e.type, e.detail]),
    [["resumed", null], ["paused", { by: "idle" }]],
  );
});

test("/ochirish: nima saqlanishi; faqat raqam, bekor qilish, hammasi", async () => {
  const { store, calls, command, press } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phone: "+998901234567", phoneAskedAt: 1 });
  await command("/ochirish");
  let sent = calls.filter((c) => c.method === "sendMessage").at(-1);
  // Rost gapiramiz: o'chirsa ham ma'lumot xizmat yozuvlarida qoladi (Azimjon, 2026-11-09: «Hammasi saqlansin»)
  assert.match(sent.payload.text, /nimani saqlaymiz[\s\S]*\+998 90 123 45 67[\s\S]*tarixi[\s\S]*xizmat yozuvlarida saqlanib qoladi/);
  assert.deepEqual(inlineButtons(sent).map((b) => b.callback_data), ["del:phone", "del:all", "del:no"]);

  await press("del:no");
  assert.match(texts(calls, "editMessageText").at(-1), /Hech narsa o'chirilmadi/);
  assert.equal(store.getDriver(42).phone, "+998901234567");

  await press("del:phone");
  let user = store.getDriver(42);
  assert.deepEqual([user.phone, user.phoneAt, user.phoneAskedAt], [null, null, 1], "raqam o'chdi, bot o'zi qayta so'ramaydi");
  assert.deepEqual(user.profile, PROFILE, "sozlamalar qoladi");
  assert.match(texts(calls).at(-1), /\/raqam/);

  await command("/ochirish");
  sent = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(sent.payload.text, /ulashmagansiz/);
  assert.deepEqual(inlineButtons(sent).map((b) => b.callback_data), ["del:all", "del:no"]);

  await press("del:all");
  user = store.getDriver(42);
  assert.deepEqual([user.role, user.profile, user.deletedVia, user.deletedCount], [null, null, "bot", 1], "qator qoladi, hisob yopildi");
  assert.equal(store.activeUsers("haydovchi").length, 0, "endi unga hech narsa yuborilmaydi");
  assert.match(texts(calls, "editMessageText").at(-1), /Hisobingiz o'chirildi\. Endi sizga hech narsa yuborilmaydi/);
  assert.deepEqual(lastMarkup(calls), { remove_keyboard: true });

  // Qayta /start — qaytdi: «o'chirgan» belgisi olinadi, boshidan («Siz kimsiz?»), necha marta o'chirgani qoladi
  await command("/start");
  user = store.getDriver(42);
  assert.deepEqual([user.deletedAt, user.deletedCount, user.role], [null, 1, null]);
  assert.match(texts(calls).at(-1), /Siz kimsiz/);
  assert.equal(store.driverDetails(42).events.find((e) => e.type === "returned").detail.via, "bot");
});
