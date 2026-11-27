// Bot buyruqlari soxta Telegram bilan: so'rovlar internetga chiqmaydi, faqat yoziladi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { applyRoute, decodeProfile } from "@yuk/shared";
import { createBot, directText, postFromMessage } from "../src/bot.js";
import { readConfig } from "../src/config.js";
import { MENU, PHONE } from "../src/menu.js";
import { createSourceWatcher } from "../src/userSources.js";

const BOT_INFO = { id: 999, is_bot: true, first_name: "Yuk Ekspert", username: "Yuk_Ekspert_agent", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
const USER = { id: 42, is_bot: false, first_name: "Ali" };
const PRIVATE = { id: 42, type: "private", first_name: "Ali" };
const GROUP = { id: -1001234567890, type: "supergroup", title: "Yuk guruh", username: "yuk_guruh" };
const CHANNEL = { id: -1009876543210, type: "channel", title: "Yuk Ekspert", username: "Yuk_Ekspert" };

// fail(method, payload) → true (403 «bloklagan») yoki Telegram javobi obyekti (masalan 400) — shu so'rov xato bilan qaytadi
// answer(method, payload) → Telegram javobidagi result (masalan getChatMember uchun { status }) yoki undefined — standart
function setup({ fail, answer, slow, actionHoldMs = 0, config: extra = {}, appUrl, linkToken, callLink, postCallLink, parseLoad, onLoadQueued, mediaDir, catchUpDelayMs, transcribeVoice, downloadFile } = {}) {
  const store = openStore({ file: ":memory:" });
  const config = { channel: "@Yuk_Ekspert", channelId: CHANNEL.id, admins: [], miniappUrl: null, ...extra };
  const { bot, init, publish, deliver, deliverRaw, isBusy, canReceive, directDone, notices, sources, holdReminder, setCatchUp } = createBot({
    actionHoldMs,
    token: `123456:${"x".repeat(35)}`,
    store,
    config,
    log: () => {},
    botInfo: BOT_INFO,
    appUrl,
    linkToken,
    callLink,
    postCallLink,
    parseLoad,
    onLoadQueued,
    mediaDir,
    catchUpDelayMs,
    transcribeVoice,
    downloadFile,
  });
  const calls = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (slow) await slow(method, payload); // Telegram sekin javob bergandek (so'rov «yo'lda»)
    const failed = fail?.(method, payload);
    if (failed) return typeof failed === "object" ? failed : { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    const result = answer?.(method, payload);
    if (result !== undefined) return { ok: true, result };
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
  return { store, calls, send, message, command, press, webAppData, init, publish, deliver, deliverRaw, isBusy, canReceive, directDone, notices, sources, holdReminder, setCatchUp };
}

const ROLE_QUESTION = /^Iltimos, tanlang/;

const texts = (calls, method = "sendMessage") => calls.filter((c) => c.method === method).map((c) => c.payload.text);

const inlineButtons = (call) => call.payload.reply_markup.inline_keyboard.flat();

test("/start: avval «Iltimos, rolingizni tanlang», keyin haydovchiga birinchi savol", async () => {
  const { store, calls, command, press } = setup();
  await command("/start");
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.match(sent[0].payload.text, /Yuk Eksperti[\s\S]*@YukExperti/);
  assert.match(sent[1].payload.text, ROLE_QUESTION);
  assert.deepEqual(inlineButtons(sent[1]).map((b) => b.callback_data), ["r:haydovchi", "r:yuk_beruvchi"]);
  assert.equal(store.getDriver(42).role, null);
  assert.equal(store.getDriver(42).name, "Ali");
  // Rol yo'q — «Menu» tugmasi (buyruqlar) ham yo'q
  const menuCalls = () => calls.filter((c) => /MyCommands$/.test(c.method)).map((c) => [c.method, c.payload.scope?.chat_id ?? null]);
  assert.deepEqual(menuCalls(), []);

  await press("r:haydovchi");
  assert.equal(texts(calls, "editMessageText").at(-1), "🚚 Men haydovchiman — yuk kerak ✅", "belgi oxirida");
  assert.equal(store.getDriver(42).role, "haydovchi");
  // Rol tanlangach (2026-11-19: saralash olib tashlandi) — rejim so'ralmaydi, darhol ⚡ Tezkor, mashinasiz
  assert.ok(texts(calls).some((t) => /✅ <b>Tayyor!<\/b>[\s\S]*Hamma guruhlar[\s\S]*🎛 Filtr/.test(t)));
  assert.deepEqual(store.getDriver(42).profile.feed, { mode: "tezkor", sources: [] });
  assert.equal(store.getDriver(42).profile.vehicle, null);
  assert.equal(store.getDriver(42).active, true);
  assert.deepEqual(menuCalls(), [["setMyCommands", 42]], "rol tanlandi — shu chatga buyruqlar");

  // Hisobini o'chirdi — buyruqlar olib tashlanadi
  await command("/ochirish");
  await press("del:all");
  assert.deepEqual(menuCalls().at(-1), ["deleteMyCommands", 42]);
});

test("tugmalar bilan to'liq ro'yxatdan o'tish (eski saralangan oqimi) va /pauza", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  // 2026-11-19: yangi haydovchi darhol tezkor; mashina ustasi ichkarida qoldi — eski profilsiz haydovchi uchun shu yerda
  store.saveDriver(42, { role: "haydovchi", profile: null, active: false });
  await message(PRIVATE, MENU.register); // appUrl yo'q — chatda savol-javob (filtr 2026-11-27 dan ilovada)
  for (const data of ["w:class:isuzu", "w:class:ok", "w:body:tent", "w:capacity:5", "w:size:std", "w:sides:t.orqa", "w:sides:ok", "w:intl:yoq"]) {
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
  // Tartib (Azimjon, 2026-11-10): «Saqlandi» → raqam (ixtiyoriy, bir marta) → javobdan keyin «Qayerdan?»
  assert.equal(texts(calls).at(-2), "✅ Saqlandi.", "sozlamalar ro'yxatisiz — raqam savoli ekrandan chiqib ketmasin");
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi\?<\/b>\n✅ Sizni doim taniymiz/);
  assert.deepEqual(lastMarkup(calls).keyboard.flat().map((b) => b.text), [PHONE.share, PHONE.later]);
  await message(PRIVATE, PHONE.later);
  assert.match(texts(calls).at(-2), /Mayli[\s\S]*«📱 Raqam ulashish»[\s\S]*Endi qayerdan qayerga/);
  assert.equal(buttons(calls.filter((c) => c.method === "sendMessage").at(-2).payload.reply_markup)[0].text, MENU.loads, "menyu qaytdi");
  assert.match(texts(calls).at(-1), /Qayerdan yuk olasiz/);
  // «Hamma joydan» endi ko'rsatilmaydi, lekin chatda qolgan eski tugmasi ishlayveradi
  await press("mr:f:*");
  assert.match(texts(calls, "editMessageText").at(-1), /Qayerga yuk olib bormoqchisiz/);
  await press("mr:t:*:*");
  assert.ok(store.getDriver(42).profile.routeAt > 0);
  assert.match(texts(calls, "editMessageText").at(-1), /Yo'nalish: <b>hamma joy → istalgan joy/);
  // Raqam allaqachon so'ralgan — yo'nalishdan keyin qayta so'ralmaydi
  assert.doesNotMatch(texts(calls).at(-1), /ulashasizmi/);

  await command("/pauza");
  assert.equal(store.getDriver(42).active, false);
  await command("/davom");
  assert.equal(store.getDriver(42).active, true);
  await message(PRIVATE, "salom");
  assert.match(texts(calls).at(-1), /tugmalardan birini bosing/);
});

test("sig'imni matn bilan yozish, noto'g'ri bo'lsa qayta so'raydi", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  await press("r:haydovchi");
  store.saveDriver(42, { role: "haydovchi", profile: null, active: false });
  await message(PRIVATE, MENU.register);
  await press("w:class:mini_fura");
  await press("w:class:ok");
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

test("guruh xabarini yozgan odam: username saqlanadi; kanal nomidan, bot yoki username'siz — yo'q", () => {
  const text = "Andijondan Buxoroga 10 tonna yuk bor";
  const base = { message_id: 9, date: 10, text };
  assert.equal(postFromMessage(GROUP, { ...base, from: { id: 5, is_bot: false, username: "ish_beruvchi" } }).sender, "ish_beruvchi");
  assert.equal(postFromMessage(GROUP, { ...base, from: { id: 5, is_bot: false } }).sender, null);
  assert.equal(postFromMessage(GROUP, { ...base, from: { id: 6, is_bot: true, username: "GroupAnonymousBot" } }).sender, null);
  assert.equal(postFromMessage(GROUP, { ...base, from: { id: 5, username: "ali_99" }, sender_chat: { id: -100, type: "channel" } }).sender, null);
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
const SORTED = { mode: "saralangan", sources: [] };
const lastMarkup = (calls) => calls.filter((c) => c.method === "sendMessage").at(-1).payload.reply_markup;
const buttons = (markup) => markup.keyboard.flat();

test("haydovchi «✍️ Shu chatga yozish»: matn → AI → preview → tasdiqlash → saqlash", async () => {
  const parseLoad = async () => ({ postType: "mashina_bor", loads: [{ truckClass: "fura", bodyType: "tent", weightT: 20 }] });
  const { store, calls, press, message } = setup({ config: { miniappUrl: MINIAPP }, parseLoad });

  // 2026-11-19: yangi haydovchi darhol tezkor — bu (eski saralangan) oqim faqat profilsiz haydovchida qolgan
  store.saveDriver(42, { role: "haydovchi", profile: null, active: false });

  // Tugma bosildi — namuna chiqadi, profil hali yo'q
  calls.length = 0;
  await message(PRIVATE, MENU.writeHere);
  assert.match(texts(calls).at(-1), /Mashinangiz haqida yozing/);
  assert.equal(store.getDriver(42).profile, null);

  // Mashinasini yozdi — preview (inline [✅ rt:ok] [web_app] [❌ rt:no]); tasdiqlanmaguncha saqlanmaydi
  calls.length = 0;
  await message(PRIVATE, "Fura, tent, 20 tonna");
  assert.match(texts(calls).at(-1), /tushunganim/);
  const kb = calls.filter((c) => c.method === "sendMessage").at(-1).payload.reply_markup.inline_keyboard.flat();
  assert.deepEqual(kb.map((b) => b.callback_data ?? "web_app"), ["rt:ok", "web_app", "rt:no"]);
  assert.equal(store.getDriver(42).profile, null);

  // Tasdiqladi — profil saqlanadi, odatdagi oqim (raqam so'raladi)
  calls.length = 0;
  await press("rt:ok");
  const { profile, role } = store.getDriver(42);
  assert.equal(role, "haydovchi");
  assert.deepEqual([profile.vehicle.truckClass, profile.vehicle.bodyType, profile.vehicle.capacityKg], ["fura", "tent", 20000]);
  assert.ok(texts(calls).includes("✅ Saqlandi."));
});

test("haydovchi matni tushunarsiz — xato, keyin aniqroq yozsa preview; AI band — «birozdan keyin»", async () => {
  let reply = null;
  const { store, calls, press, message } = setup({ config: { miniappUrl: MINIAPP }, parseLoad: async () => reply });

  store.saveDriver(42, { role: "haydovchi", profile: null, active: false }); // eski saralangan oqimi (2026-11-19)
  await message(PRIVATE, MENU.writeHere);

  // Tushunmadi (truckClass yo'q) — xato, profil saqlanmaydi, lekin rejim saqlanadi (qaytadan yozsa bo'ladi)
  reply = { postType: "boshqa", loads: [] };
  calls.length = 0;
  await message(PRIVATE, "salom qalaysiz");
  assert.match(texts(calls).at(-1), /tushunmadim/);
  assert.equal(store.getDriver(42).profile, null);

  // AI band (null) — «birozdan keyin»
  reply = null;
  calls.length = 0;
  await message(PRIVATE, "Isuzu 5 tonna");
  assert.match(texts(calls).at(-1), /band|birozdan keyin/i);

  // Endi aniqroq — preview chiqadi
  reply = { postType: "mashina_bor", loads: [{ truckClass: "isuzu", bodyType: "ref", weightT: 5 }] };
  calls.length = 0;
  await message(PRIVATE, "Isuzu, ref, 5 tonna");
  assert.match(texts(calls).at(-1), /tushunganim/);
});

test("pastki menyu: rol tanlanmaguncha yo'q, rol tanlangach Mini App tugmasi, savol-javobsiz", async () => {
  const { store, calls, command, press, message } = setup({ config: { miniappUrl: MINIAPP } });
  await command("/start");
  // Rol hali yo'q — pastki menyu chiqmaydi (eski menyu bo'lsa — olinadi), faqat rol tugmalari
  const [intro, question] = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(intro.payload.reply_markup, { remove_keyboard: true });
  assert.equal(question.payload.reply_markup.keyboard, undefined);

  // Rol tanlanmagan odam eski menyu tugmasini bossa, buyruq yoki matn yozsa — yana /start ekrani, menyu chiqmaydi
  for (const send of [() => message(PRIVATE, MENU.register), () => message(PRIVATE, MENU.help), () => message(PRIVATE, MENU.pause), () => command("/rol"), () => command("/yordam"), () => message(PRIVATE, "salom")]) {
    calls.length = 0;
    await send();
    const sent = calls.filter((c) => c.method === "sendMessage");
    assert.match(sent.at(-1).payload.text, ROLE_QUESTION);
    assert.ok(sent.every((c) => !c.payload.reply_markup?.keyboard), "pastki menyu yo'q");
  }

  calls.length = 0;
  await press("r:haydovchi");
  // 2026-11-19: rejim so'ralmaydi — darhol ⚡ Tezkor (keyin raqam savoli)
  assert.match(texts(calls)[0], /^✅ <b>Tayyor!<\/b>/, "alohida «Haydovchisiz» xabari yo'q");
  // Eski (profilsiz) saralangan oqimi — ichkarida qoldi
  store.saveDriver(42, { role: "haydovchi", profile: null, active: false });
  calls.length = 0;
  await message(PRIVATE, MENU.register);
  assert.equal(texts(calls).length, 1);
  assert.match(texts(calls)[0], /forma ochiladi/);
  const markup = lastMarkup(calls);
  assert.equal(markup.is_persistent, undefined); // yig'iladigan: yozish qatoridagi belgi menyuni ochib-yopadi
  assert.equal(markup.resize_keyboard, true);
  const register = buttons(markup).find((b) => b.text === MENU.register);
  assert.equal(register.web_app.url, `${MINIAPP}?v=sozlamalar&r=haydovchi`); // ilova darhol sozlamalar bilan ochiladi
  // Ro'yxatdan o'tmaguncha — forma + «✍️ Shu chatga yozish», so'ng rol/yordam (Mos yuklar, pauza, raqam — formadan keyin)
  assert.deepEqual(markup.keyboard.map((row) => row.map((b) => b.text)), [[MENU.register], [MENU.writeHere], [MENU.role, MENU.help]]);
});

test("web'dan hisobdan chiqqan (store.signOut): bot yangi odamdek — rol so'raladi, rolni tanlasa sozlamalari tiklanadi", async () => {
  const { store, calls, command, message, press } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  store.signOut(42);

  await message(PRIVATE, MENU.loads); // eski menyudagi «📋 Mos yuklar» — ishlamaydi, eski menyu olinadi, avval rol
  assert.match(texts(calls).at(-1), ROLE_QUESTION);
  assert.ok(calls.some((c) => c.method === "sendMessage" && c.payload.reply_markup?.remove_keyboard), "eski menyu olib tashlandi");
  calls.length = 0;
  await command("/start");
  assert.deepEqual(calls.filter((c) => c.method === "sendMessage")[0].payload.reply_markup, { remove_keyboard: true }, "rol yo'q — menyu yo'q");

  calls.length = 0;
  await press("r:haydovchi");
  assert.match(texts(calls).at(-1), /Oldingi sozlamalaringiz tiklandi/);
  assert.ok(buttons(lastMarkup(calls)).some((b) => b.text === MENU.settings), "rol tanlangach menyu chiqdi");
  assert.deepEqual(store.getDriver(42).profile, PROFILE);
  assert.equal(store.getDriver(42).active, true);
});

test("pastki menyudagi «🔄 Rolni almashtirish» — /rol bilan bir xil: hozirgi rol va ikki tugma", async () => {
  const { store, calls, message, press } = setup({ config: { miniappUrl: MINIAPP, admins: [42] } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });
  await message(PRIVATE, MENU.role);
  // Azimjon, 2026-11-12 (aniqlik): rol TANLANGAN hisobda pastki menyu qoladi — «🔄 Rolni almashtirish» so'rovi
  // inline tugmalar bilan yuboriladi va remove_keyboard BO'LMAYDI (menyu faqat rol tanlanmagan hisobda yo'q)
  const roleMsg = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.deepEqual(inlineButtons(roleMsg).map((b) => b.callback_data), ["r:haydovchi", "r:yuk_beruvchi"]);
  assert.ok(!roleMsg.payload.reply_markup?.remove_keyboard, "rol so'rovi pastki menyuni o'chirmaydi");
  assert.match(roleMsg.payload.text, /Hozir siz: <b>🚚 Haydovchi[\s\S]*yo'qolmaydi/);
  await press("r:yuk_beruvchi");
  assert.equal(store.getDriver(42).role, "yuk_beruvchi");
  const rows = () => lastMarkup(calls).keyboard.map((row) => row.map((b) => b.text));
  // Yuk beruvchi sifatida hali ro'yxatdan o'tmagan, lekin TO'LIQ menyu oladi (admin bo'lsa ham): «🚚 Ro'yxatdan o'tish»
  // endi yuk beruvchida yo'q — tugma «⚙️ Sozlamalar», u IXTIYORIY. Azimjon, 2026-11-12: «Bizga yuk beruvchi uchun
  // Ro'yxatdan o'tish kerak emas!» + «⏸ Pauza/"davom etish" va "➕ Guruh qo'shish" faqat haydovchi roli uchun!» —
  // yuk beruvchi tartibi: [📦 Yuk berish] / [🚚 Bo'sh mashinalar + 🔄 Rolni almashtirish] /
  // [📱 Raqam ulashish + ❓ Yordam] / [⚙️ Sozlamalar] / [🛠 Boshqaruv] — Pauza yo'q
  assert.deepEqual(rows(), [[MENU.giveLoad], [MENU.role, MENU.help], [MENU.settings], [MENU.admin]]); // 2026-11-27: «🚚 Bo'sh mashinalar» va «📱 Raqam ulashish» yo'q
  assert.ok(!buttons(lastMarkup(calls)).some((b) => b.text === MENU.register), "yuk beruvchida «🚚 Ro'yxatdan o'tish» tugmasi yo'q");
  // Haydovchiga qaytdi — sozlamalari tiklandi, to'liq menyu. Tartib (Azimjon, 2026-11-10): mos yuklar, pauza, rol, raqam,
  // yordam, sozlamalar; admin tugmasi alohida pastda
  await press("r:haydovchi");
  assert.deepEqual(rows(), [[MENU.loads, MENU.pause], [MENU.role, MENU.phone], [MENU.help, MENU.settings], [MENU.feed], [MENU.admin]]);
});

// Azimjon, 2026-11-12: «Botda Yuk beruvchi rolida muammo bor: men ushbu rejimda pastki menyuda pauza/"davom etish"
// va "➕ Guruh qo'shish" ni ko'rdim va ushbu sozlama faqat haydovchi roli uchun!» — qoida: «⏸ Pauza / ▶️ Davom
// ettirish» va «➕ Guruh qo'shish» FAQAT haydovchi menyuda. Handlerlar o'chirilmagan (eski menyuda bosilsa ishlaydi).
test("«⏸ Pauza / ▶️ Davom ettirish» va «➕ Guruh qo'shish» FAQAT haydovchi menyuda (yuk beruvchida yo'q)", async () => {
  const { store, calls, message } = setup();
  // Haydovchi: raqami bor — menyuda pauza VA «➕ Guruh qo'shish» bor
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phone: "+998901234567", phoneAskedAt: 1 });
  await message(PRIVATE, MENU.help);
  let texts_ = buttons(lastMarkup(calls)).map((b) => b.text);
  assert.ok(texts_.includes(MENU.pause), "haydovchida «⏸ Pauza» bor");
  assert.ok(texts_.includes(MENU.addGroup), "haydovchida raqam bor — «➕ Guruh qo'shish» bor");
  // Pauzaga tushdi — tugma «▶️ Davom ettirish» bo'lib qoladi (faqat haydovchida)
  await message(PRIVATE, MENU.pause);
  assert.equal(store.getDriver(42).active, false);
  texts_ = buttons(lastMarkup(calls)).map((b) => b.text);
  assert.ok(texts_.includes(MENU.resume), "haydovchi pauzada — «▶️ Davom ettirish» bor");
  assert.ok(!texts_.includes(MENU.pause), "pauzada «⏸ Pauza» tugmasi yo'q");
  await message(PRIVATE, MENU.resume);

  // Yuk beruvchi: ro'yxatga kirgan (profil+raqam bilan) bo'lsa ham — pauza/resume/addGroup YO'Q
  store.saveDriver(42, { role: "yuk_beruvchi", profile: { fromAreas: ["toshkent"], truckClasses: [] }, active: true, phone: "+998901234567", phoneAskedAt: 1 });
  await message(PRIVATE, MENU.help);
  texts_ = buttons(lastMarkup(calls)).map((b) => b.text);
  assert.deepEqual(texts_, [MENU.giveLoad, MENU.role, MENU.help, MENU.settings]);
  assert.ok(!texts_.includes(MENU.pause) && !texts_.includes(MENU.resume), "yuk beruvchida pauza tugmasi yo'q");
  assert.ok(!texts_.includes(MENU.addGroup), "yuk beruvchida «➕ Guruh qo'shish» yo'q");
  // Handler o'chirilmagan: yuk beruvchi eski menyudan «⏸ Pauza» ni yuborsa — baribir ishlaydi (FAQAT tugma ko'rsatilmaydi)
  await message(PRIVATE, MENU.pause);
  assert.equal(store.getDriver(42).active, false, "eski menyudagi «⏸ Pauza» bosilsa ishlaydi");
  assert.ok(!buttons(lastMarkup(calls)).some((b) => b.text === MENU.resume), "yangi menyuda «▶️ Davom ettirish» ham yo'q");
  await message(PRIVATE, MENU.resume);
  assert.equal(store.getDriver(42).active, true);
});

test("Mini App formasi saqlanadi → «Qayerdan? Qayerga?»; yo'nalish keyingi saqlashda ham qoladi", async () => {
  const { store, calls, webAppData, press, message } = setup({ config: { miniappUrl: MINIAPP } });
  // Rol yo'q va forma ham rol yubormadi — saqlanmaydi
  await webAppData(JSON.stringify({ type: "profile", profile: FORM }));
  assert.match(texts(calls).at(-1), /Saqlanmadi: Avval kim ekaningizni tanlang/);
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: { ...FORM, hacker: 1 } }));
  let driver = store.getDriver(42);
  assert.deepEqual(driver.profile, { ...FORM, feed: SORTED }, "forma rejim yubormadi — standart «Saralangan»");
  assert.equal(driver.role, "haydovchi");
  assert.equal(driver.active, true);
  // «Saqlandi» → raqam so'raladi (forma to'ldirilgach, yo'nalishdan oldin)
  assert.equal(texts(calls).at(-2), "✅ Saqlandi.");
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi/);
  // Raqamini ulashdi → «Raqamingiz saqlandi! ✅» (faqat shu, asosiy menyu bilan) → «Qayerdan?»
  await message(PRIVATE, undefined, { contact: { first_name: "Ali", phone_number: "998901234567", user_id: 42 } });
  assert.equal(store.getDriver(42).phone, "+998901234567");
  const sent = calls.filter((c) => c.method === "sendMessage");
  const savedMessage = sent.at(-2).payload;
  assert.equal(savedMessage.text, "Raqamingiz saqlandi! ✅");
  const settings = buttons(savedMessage.reply_markup).find((b) => b.text === MENU.settings);
  assert.deepEqual(decodeProfile(new URL(settings.web_app.url).searchParams.get("p")), { ...FORM, feed: SORTED });
  const from = inlineButtons(sent.at(-1)).map((b) => b.callback_data);
  assert.ok(from.includes("mr:f:toshkent_sh") && !from.includes("mr:f:*"), "«Hamma joydan» yo'q");
  // «🗺 Xaritadan tanlash» — web xaritasi (inline Mini App: kirish o'zi, initData; token va profil manzilda yo'q)
  const map = new URL(inlineButtons(sent.at(-1)).find((b) => b.text === "🗺 Xaritadan tanlash").web_app.url);
  assert.equal(map.origin + map.pathname, MINIAPP);
  assert.deepEqual([map.searchParams.get("v"), map.searchParams.get("r"), map.searchParams.get("t"), map.searchParams.get("p"), map.searchParams.get("f")], ["yonalish", "haydovchi", null, null, null]);
  assert.ok(!from.includes("mr:last"), "oxirgi yo'nalish hali yo'q");
  assert.ok(!from.some((d) => d?.includes("Qozog")), "«Faqat O'zbekiston» — davlat tugmalari yo'q");

  // Samarqand → Toshkent vil.
  await press("mr:f:samarqand");
  const to = calls.filter((c) => c.method === "editMessageText").at(-1);
  assert.match(to.payload.text, /Qayerga yuk olib bormoqchisiz/);
  assert.ok(inlineButtons(to).some((b) => b.callback_data === "mr:t:samarqand:toshkent"));
  assert.ok(inlineButtons(to).some((b) => b.callback_data === "mr:back"));
  const toMap = new URL(inlineButtons(to).find((b) => b.text === "🗺 Xaritadan tanlash").web_app.url);
  assert.equal(toMap.searchParams.get("f"), "samarqand", "«Qayerga?» dan ochilgan xarita «Qayerdan» ni biladi");
  await press("mr:t:samarqand:toshkent");
  driver = store.getDriver(42);
  assert.deepEqual([driver.profile.fromAreas, driver.profile.toAreas], [["samarqand"], ["toshkent"]]);
  assert.match(texts(calls).at(-1), /mos yuk chiqmadi/, "raqam bor — qayta so'ralmaydi");

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

test("📋 Mos yuklar: avval «Qayerdan?», keyin faqat mos keladigani, asl e'lon tugmada", async () => {
  const { store, calls, message, press } = setup();
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), ROLE_QUESTION);
  store.saveDriver(42, { role: "haydovchi" });
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), /Avval transportingizni/);

  store.saveDriver(42, { profile: PROFILE, active: true });
  const post = store.addPost({ source: "@yuk_guruh", messageId: 5, link: "https://t.me/yuk_guruh/5", text: "Toshkentdan Samarqandga yuk bor", postedAt: Date.now() });
  store.addLoad({ postId: post.id, key: "a", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand", weightT: 3, phones: ["+998900000001"] } });
  store.addLoad({ postId: post.id, key: "b", load: { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Buxoro", toRegion: "buxoro", weightT: 20, phones: ["+998900000002"] } });
  store.addLoad({ postId: post.id, key: "c", load: { fromCity: "Andijon", fromRegion: "andijon", toCity: "Namangan", toRegion: "namangan", weightT: 2, phones: ["+998900000003"] } });
  // Avval yo'nalish so'raladi: hozirgisi matnda va ✅ bilan; tugmalarda «Joy →», yuklar soni yo'q
  calls.length = 0;
  await message(PRIVATE, MENU.loads);
  const ask = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(ask.payload.text, /Qayerdan yuk olasiz[\s\S]*Hozirgi yo'nalish: <b>Toshkent vil\. → istalgan joy/);
  const labels = inlineButtons(ask).map((b) => b.text);
  assert.ok(!inlineButtons(ask).some((b) => b.callback_data === "mr:last"), "«🔁» tugmasi yo'q — har safar «Qayerga?» ham so'raladi");
  assert.match(inlineButtons(ask).find((b) => b.callback_data === "mr:f:toshkent").text, /^✅ Toshkent vil\./);
  assert.equal(labels.filter((t) => t.startsWith("✅")).length, 1);
  assert.ok(labels.includes("Toshkent shahri →") && labels.includes("Andijon vil. →") && labels.includes("Buxoro vil. →"));
  assert.ok(!labels.some((t) => /Hamma joy/.test(t)), "«Hamma joydan» yo'q");
  assert.ok(!labels.includes("🗺 Xaritadan tanlash"), "https manzil yo'q — xarita tugmasi ham yo'q");
  // Shu joy qayta tanlansa ham — «Qayerga?» (avval «🔁 Toshkent vil. → istalgan joy» ni bosganda so'ralmasdi).
  // ✅ belgisi «Qayerga?» da — route.test.js da (bu profil 2026-11-07 dan oldingi: routeAt yo'q)
  await press("mr:f:toshkent");
  const toAsk = calls.filter((c) => c.method === "editMessageText").at(-1);
  assert.equal(toAsk.payload.text, "📍 <b>Qayerga yuk olib bormoqchisiz?</b> 🏁");
  assert.ok(inlineButtons(toAsk).some((b) => b.text === "→ 🌐 Istalgan joyga" && b.callback_data === "mr:t:toshkent:*"));
  assert.ok(inlineButtons(toAsk).some((b) => b.text === "→ Samarqand vil." && b.callback_data === "mr:t:toshkent:samarqand"));
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
  assert.match(sent[1].payload.text, /Samarqand[\s\S]*\+998900000001[\s\S]*📢 E'lon qilingan 🕒 /);
  assert.ok(!sent[1].payload.text.includes("href"), "asl e'lon — matnda emas, tugmada");
  // Tunnel (https manzil) yo'q — «📞 Telefon qilish» ham yo'q, faqat asl e'lon
  assert.deepEqual(inlineButtons(sent[1]).map((b) => [b.text, b.url]), [["📄 Asl e'lon", "https://t.me/yuk_guruh/5"]]);

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
  store.saveDriver(42, { role: "haydovchi", profile: null, active: false });
  await message(PRIVATE, MENU.register);
  await press("w:class:isuzu");
  await press("w:class:ok");
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

// [matn, manzil] — «📄 Asl e'lon» oddiy havola (url), «📞» — Mini App (web_app: Telegram «Havolani ochish?» deb so'ramaydi)
const rowsOf = (payload) => payload.reply_markup.inline_keyboard.map((row) => row.map((b) => [b.text, b.url ?? `web_app:${b.web_app?.url}`]));

// Azimjon, 2026-11-09: guruh nomi va «📄 Asl e'lon» havolasi matnda kerak emas — xabar ostida 2 ta tugma
test("yuk xabari: «📢 E'lon qilingan 🕒 vaqt», ostida «📄 Asl e'lon» va «📞 Telefon qilish» (raqam havolada yo'q)", async () => {
  const made = [];
  const callLink = (link) => (made.push(link), `L${link.loadId}-${link.phone}-${link.chatId}`);
  const { store, calls, deliver } = setup({ appUrl: () => "https://yukekspert.example.ts.net/", callLink });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true });
  const load = { fromCity: "Toshkent", fromPlace: "Jomiy", toCity: "Andijon", bodyType: "ploshatka", when: "srochno", phones: ["+998509090133"] };
  const post = { source: "@TutGruz", link: "https://t.me/TutGruz/19445753", postedAt: Date.UTC(2026, 10, 9, 7, 5) };
  const sent = () => calls.filter((c) => c.method === "sendMessage").at(-1).payload;

  assert.deepEqual(await deliver(42, load, post, "yuk", 7), { ok: true });
  assert.match(sent().text, /^🚛 <b>Toshkent \(Jomiy\) → Andijon<\/b>\n🚚 plashatka\n💰 narx yozilmagan\n📅 srochno\n📞 \+998509090133\n📢 E'lon qilingan 🕒 09\.11\.2026 12:05$/);
  assert.ok(!sent().text.includes("@TutGruz") && !sent().text.includes("href"));
  assert.deepEqual(rowsOf(sent()), [
    [
      ["📄 Asl e'lon", "https://t.me/TutGruz/19445753"],
      ["📞 Telefon qilish", "web_app:https://yukekspert.example.ts.net/pub/call?c=L7-0-42"],
    ],
  ]);
  assert.deepEqual(made, [{ loadId: 7, phone: 0, chatId: 42 }]);
  assert.ok(!rowsOf(sent()).flat(2).some((v) => String(v).includes("509090133")), "raqam manzilda yo'q — faqat imzolangan token");

  // Bir nechta raqam — har biri o'z tugmasida (raqami bilan)
  await deliver(42, { ...load, phones: ["+998509090133", "+998901112233"] }, post, "yuk", 8);
  assert.deepEqual(rowsOf(sent()), [
    [["📄 Asl e'lon", "https://t.me/TutGruz/19445753"]],
    [["📞 +998 50 909 01 33", "web_app:https://yukekspert.example.ts.net/pub/call?c=L8-0-42"]],
    [["📞 +998 90 111 22 33", "web_app:https://yukekspert.example.ts.net/pub/call?c=L8-1-42"]],
  ]);

  // Havola ham, raqam ham yo'q — tugmasiz, o'rniga pastki menyu
  await deliver(42, { ...load, phones: [] }, { postedAt: post.postedAt }, "yuk", 9);
  assert.equal(sent().reply_markup.inline_keyboard, undefined);
  assert.ok(buttons(sent().reply_markup).some((b) => b.text === MENU.settings));
  assert.match(sent().text, /telefon yozilmagan/);
});

test("«📞 Telefon qilish» faqat https manzil va yuk id bo'lsa; Telegram tugmani rad etsa — yuk baribir tugmasiz boradi", async () => {
  const load = { fromCity: "Toshkent", toCity: "Andijon", phones: ["+998509090133"] };
  const post = { link: "https://t.me/TutGruz/1", postedAt: Date.now() };
  const texts = (s) => rowsOf(s.calls.filter((c) => c.method === "sendMessage").at(-1).payload).flat().map(([text]) => text);
  const http = setup({ appUrl: () => "http://localhost:3001/", callLink: () => "tok" });
  await http.deliver(42, load, post, "yuk", 7);
  assert.deepEqual(texts(http), ["📄 Asl e'lon"], "http — Telegram qabul qilmaydi");
  const noId = setup({ appUrl: () => "https://x.example/", callLink: () => "tok" });
  await noId.deliver(42, load, post);
  assert.deepEqual(texts(noId), ["📄 Asl e'lon"], "yuk id'si yo'q — qaysi raqamligini sahifa bilmaydi");

  const rejected = setup({
    appUrl: () => "https://x.example/",
    callLink: () => "tok",
    fail: (method, p) => method === "sendMessage" && p.reply_markup?.inline_keyboard && { ok: false, error_code: 400, description: "Bad Request: BUTTON_URL_INVALID" },
  });
  rejected.store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true });
  assert.deepEqual(await rejected.deliver(42, load, post, "yuk", 7), { ok: true });
  const sends = rejected.calls.filter((c) => c.method === "sendMessage");
  assert.equal(sends.length, 2);
  assert.ok(buttons(sends[1].payload.reply_markup).some((b) => b.text === MENU.settings), "ikkinchisi — pastki menyu bilan");
});

test("directText: faqat matn (havola tugmada)", () => {
  const text = directText({ fromCity: "Toshkent", toCity: "Samarqand" }, { link: "https://t.me/a/1" });
  assert.ok(!text.includes("href"));
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
test("Mini App tugmasida kirish tokeni (?t=): o'sha odamniki, hafta almashsa — botning keyingi javobida yangisi", async () => {
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
  // Yuk xabarida inline tugmalar bo'lsa, pastki menyu kelmaydi (bitta xabarga — bittasi); tugmasiz yuk — menyu bilan
  await deliver(42, load, post);
  assert.ok(sent().reply_markup.inline_keyboard, "«📄 Asl e'lon» tugmasi");
  await deliver(42, { ...load, phones: [] }, { postedAt: post.postedAt });
  assert.equal(urlOf(sent().reply_markup, MENU.settings).searchParams.get("t"), "tok-42-w1");
  assert.equal(sent().reply_markup.is_persistent, undefined, "yig'iladigan menyu");

  // Yangi hafta — yangi token botning keyingi javobida (eskisi baribir yana bir necha hafta ishlaydi)
  week = 2;
  await command("/start");
  assert.equal(urlOf(sent().reply_markup, MENU.settings).searchParams.get("t"), "tok-42-w2");

  // Rol tanlanmagan foydalanuvchida Mini App tugmasi yo'q — token ham yo'q
  calls.length = 0;
  await deliver(77, load, post);
  assert.ok(!JSON.stringify(calls).includes("tok-77"));
});

test("tunnel manzili o'zgarsa: «📞 Telefon qilish» va pastki menyu yangi manzil bilan", async () => {
  let url = "https://bir-ikki-uch-tort.trycloudflare.com/";
  const { store, calls, command, deliver } = setup({ appUrl: () => url, callLink: () => "tok" });
  const load = { fromCity: "Toshkent", toCity: "Samarqand", weightT: 5, phones: ["+998900000001"] };
  const post = { source: "@yuk_guruh", link: "https://t.me/yuk_guruh/5", postedAt: Date.now() };
  store.saveDriver(42, { profile: PROFILE, active: true, phoneAskedAt: 1 });
  const sent = () => calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === 42).at(-1).payload;
  const settingsUrl = (markup) => buttons(markup).find((b) => b.text === MENU.settings)?.web_app?.url ?? null;
  const callUrl = () => sent().reply_markup.inline_keyboard.flat().find((b) => b.text === "📞 Telefon qilish")?.web_app?.url ?? null;

  await command("/start");
  assert.match(settingsUrl(sent().reply_markup), /^https:\/\/bir-ikki-uch-tort\.trycloudflare\.com\/\?v=sozlamalar/);
  await deliver(42, load, post, "yuk", 1);
  assert.equal(callUrl(), "https://bir-ikki-uch-tort.trycloudflare.com/pub/call?c=tok");

  // Tunnel qayta yoqildi — keyingi yuk yangi manzil bilan, menyu — botning keyingi javobida
  url = "https://besh-olti-yetti-sakkiz.trycloudflare.com/";
  await deliver(42, load, post, "yuk", 1);
  assert.match(callUrl(), /besh-olti-yetti-sakkiz/);
  await command("/start");
  assert.match(settingsUrl(sent().reply_markup), /besh-olti-yetti-sakkiz/);

  // Tunnel o'chdi — «📞» tugmasi yo'q (matndagi raqam qoladi), menyudagi sozlamalar oddiy matn tugma (chatda savol-javob)
  url = null;
  await deliver(42, load, post, "yuk", 1);
  assert.equal(callUrl(), null);
  await command("/start");
  const markup = sent().reply_markup;
  assert.equal(settingsUrl(markup), null);
  assert.ok(buttons(markup).some((b) => b.text === MENU.settings));
});

test("yuk beruvchi: rol → «Yuk berish» namunasi (matn yoki ovoz); «🚚 Bo'sh mashinalar» yo'q (2026-11-27), sozlash shart emas", async () => {
  const { store, calls, command, press, message } = setup();
  await command("/start");
  await press("r:yuk_beruvchi");
  const introMsg = texts(calls).at(-1);
  assert.match(introMsg, /^📦 <b>Yukingizni shu chatga yozib yuboring yoki 🎤 ovozli xabar qilib ayting<\/b>/);
  assert.match(introMsg, /📍 Qayerdan → qayerga: <i>Andijondan Toshkentga<\/i>[\s\S]*📞 Telefon[\s\S]*Masalan:\n<b>Andijondan Toshkentga/);
  assert.ok(!/forma/i.test(introMsg), "formaga yo'naltirish yo'q");
  assert.equal(store.getDriver(42).draft, null);
  const shipperMenuTexts = () => buttons(lastMarkup(calls)).map((b) => b.text);
  assert.deepEqual(shipperMenuTexts(), [MENU.giveLoad, MENU.role, MENU.help, MENU.settings]);
  // Eski menyudagi «🚚 Bo'sh mashinalar» — ro'yxat emas, yuk berish yo'li
  await message(PRIVATE, MENU.trucks);
  assert.match(texts(calls).at(-1), /Bo'sh mashinalar bo'limi endi yo'q[\s\S]*ovozli xabar/);
  // «⚙️ Sozlamalar» (ilovasiz) — savol-javob ochilmaydi
  await message(PRIVATE, MENU.settings);
  assert.match(texts(calls).at(-1), /sozlash shart emas/);
  assert.equal(store.getDriver(42).draft, null);
});

test("/rol: boshqa rolga o'tsa sozlamalari saqlanadi, qaytsa tiklanadi; o'sha rol — hech narsa o'zgarmaydi", async () => {
  const { store, calls, command, press, message } = setup();
  store.saveDriver(42, { profile: PROFILE, active: true, phoneAskedAt: 1 }); // rollardan oldingi haydovchi (role ustuni bo'sh)
  await command("/rol");
  // Azimjon, 2026-11-12 (aniqlik): rol tanlangan hisobda /rol so'rovi paytida ham pastki menyu qoladi —
  // xabar inline rol tugmalari bilan yuboriladi, remove_keyboard BO'LMAYDI. Eski testda faqat matn tekshirilardi
  const roleMsg = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.ok(!roleMsg.payload.reply_markup?.remove_keyboard, "/rol pastki menyuni o'chirmaydi");
  assert.deepEqual(inlineButtons(roleMsg).map((b) => b.callback_data), ["r:haydovchi", "r:yuk_beruvchi"]);
  assert.match(roleMsg.payload.text, /Hozir siz: <b>🚚 Haydovchi/);
  // Inline tugmalar bosilmay boshqa narsa yozilsa — menyu qaytadi (keyingi javob menu(driver) bilan) (Azimjon, 2026-11-12)
  await message(PRIVATE, "salom");
  assert.deepEqual(buttons(lastMarkup(calls)).map((b) => b.text), [MENU.loads, MENU.pause, MENU.role, MENU.phone, MENU.help, MENU.settings, MENU.feed]);
  await press("r:haydovchi");
  assert.match(texts(calls).at(-1), /hech narsa o'zgarmadi/);
  assert.deepEqual(store.getDriver(42).profile, PROFILE);

  // Yuk beruvchi — bu rolda hali sozlama yo'q; savol-javob boshlanmaydi (yuk berish uchun shart emas)
  await press("r:yuk_beruvchi");
  let user = store.getDriver(42);
  assert.equal(user.role, "yuk_beruvchi");
  assert.equal(user.profile, null);
  assert.equal(user.draft, null);
  assert.equal(store.activeUsers("haydovchi").length, 0, "endi unga yuk bormaydi");

  // Haydovchiga qaytdi — mashinasi va yo'nalishi qaytadan so'ralmaydi
  await press("r:haydovchi");
  user = store.getDriver(42);
  assert.equal(user.role, "haydovchi");
  assert.deepEqual(user.profile, PROFILE);
  assert.equal(user.draft, null, "yuk beruvchi savol-javobi tashlandi");
  assert.match(texts(calls).at(-1), /Oldingi sozlamalaringiz tiklandi — mos yuklar yana shu yerga keladi/);
  assert.deepEqual(buttons(lastMarkup(calls)).map((b) => b.text), [MENU.loads, MENU.pause, MENU.role, MENU.phone, MENU.help, MENU.settings, MENU.feed]);
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
  assert.match(payload.text, /^🚚 <b>Bo'sh mashina: Andijon → Toshkent<\/b>[\s\S]*Isuzu/);
  assert.deepEqual(rowsOf(payload), [[["📄 Asl e'lon", "https://t.me/yuk_guruh/7"]]]);

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
  assert.equal(
    texts(calls).at(-1),
    "📱 <b>Telefon raqamingizni ulashasizmi?</b>\n" +
      "✅ Sizni doim taniymiz — sozlamalar yo'qolmaydi\n" +
      "✅ O'z guruhingizni qo'sha olasiz\n" +
      "🔒 Raqamingiz hech kimga ko'rsatilmaydi\n\n" +
      "👇 Pastdagi «📱 Raqam ulashish» tugmasini bosing. Xohlamasangiz — «⏭ Keyinroq».",
    "afzalliklar ro'yxati (2026-11-13) + «Guruh qo'shish» faqat raqam ulashganlarga",
  );
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
  assert.equal(texts(calls).at(-1), "Raqamingiz saqlandi! ✅");
  assert.equal(buttons(lastMarkup(calls))[0].text, MENU.loads);

  // /raqam — hozirgi raqam va «O'zgartirmaslik»
  await command("/raqam");
  assert.match(texts(calls).at(-1), /Sizning raqamingiz: <b>\+998 90 123 45 67[\s\S]*«🔄 Raqamni almashtirish», o'chirish uchun «🗑 Raqamni o'chirish»/);
  // Azimjon (2026-11-10): almashtirish ham, o'chirish ham
  assert.deepEqual(lastMarkup(calls).keyboard, [[{ text: PHONE.change, request_contact: true }], [{ text: PHONE.remove }, { text: PHONE.keep }]]);
  await message(PRIVATE, PHONE.keep);
  assert.match(texts(calls).at(-1), /Raqamingiz o'zgarmadi/);
  assert.equal(store.getDriver(42).phone, "+998901234567");

  // «🗑 Raqamni o'chirish» — raqam o'chadi, «so'ralgan» vaqti qoladi; menyuda yana «📱 Raqam ulashish»
  await command("/raqam");
  await message(PRIVATE, PHONE.remove);
  assert.equal(store.getDriver(42).phone, null);
  assert.ok(store.getDriver(42).phoneAskedAt > 0);
  assert.match(texts(calls).at(-1), /^✅ Raqamingiz o'chirildi\.\nXohlasangiz, keyin yana ulashasiz — pastdagi «📱 Raqam ulashish» yoki \/raqam\.$/);
  assert.ok(buttons(lastMarkup(calls)).some((b) => b.text === MENU.phone && !b.request_contact));
  await message(PRIVATE, PHONE.remove);
  assert.equal(texts(calls).at(-1), "Sizda saqlangan raqam yo'q.");
  // Raqami yo'q — /raqam oddiy savol: [📱 Raqam ulashish] / [⏭ Keyinroq]
  await command("/raqam");
  assert.deepEqual(lastMarkup(calls).keyboard.flat().map((b) => b.text), [PHONE.share, PHONE.later]);
});

test("/start matni: bot haqida Azimjon matni, keyin menyu; menyuda «Ilovalar» o'rnida raqam tugmasi", async () => {
  const { store, calls, command, message } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", active: true, phoneAskedAt: 1 });
  await command("/start");
  // Hali ro'yxatdan o'tmagan — menyuda ham, matnda ham faqat 3 tugma; boshida — bot haqida Azimjon matni (2026-11-10)
  const early = texts(calls).find((t) => /Pastdagi tugmalar/.test(t));
  assert.equal(
    early,
    "Assalomu alaykum!\n\n" +
      "<b>Pastdagi tugmalar</b> (siz: 🚚 Haydovchi):\n" +
      "🚚 Ro'yxatdan o'tish — sizga qanday e'lonlar yo'naltirishimiz haqida\n" +
      "🔄 Rolni almashtirish — haydovchi yoki yuk egasi\n\n" +
      "Tugmalar yo'qolsa — /start ni bosing.\n" +
      "❓ Tushunmasangiz — @YukExperti ga yozing, yordam beradi.",
  );
  // Keyingi xabar (2026-11-19): rejim so'ralmaydi — darhol ⚡ Tezkor saqlanadi va to'liq menyu
  assert.match(texts(calls).at(-1), /✅ <b>Tayyor!<\/b>/);
  assert.equal(store.getDriver(42).profile.feed.mode, "tezkor");
  const menuOf = calls.filter((c) => c.method === "sendMessage" && c.payload.reply_markup?.keyboard).at(-1).payload.reply_markup;
  assert.equal(menuOf.keyboard[0][0].text, MENU.feed);

  // Ro'yxatdan o'tgach — to'liq menyu va to'liq ro'yxat
  store.saveDriver(42, { profile: PROFILE });
  calls.length = 0;
  await command("/start");
  const text = texts(calls).find((t) => /Pastdagi tugmalar/.test(t));
  assert.match(text, /^Assalomu alaykum!\n\n<b>Pastdagi tugmalar<\/b>/);
  assert.doesNotMatch(text, /vositachisiz|Bundan tashqari/, "2026-11-10 gacha bo'lgan matn yo'q");
  assert.match(text, /📱 Raqam ulashish — sizni doim taniymiz/);
  assert.doesNotMatch(text, /qo'ng'iroq qilasiz/);
  assert.doesNotMatch(text, /📱 Ilovalar/);
  assert.match(text, /\/start/);

  // Raqam yo'q — menyudagi tugma oddiy: bosilsa avval afzalliklar, keyin request_contact tugmasi (2026-11-13)
  const phoneButton = buttons(lastMarkup(calls)).find((b) => b.text === MENU.phone);
  assert.ok(!phoneButton.request_contact);
  await message(PRIVATE, MENU.phone);
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi\?<\/b>\n✅ Sizni doim taniymiz/);
  assert.deepEqual(lastMarkup(calls).keyboard.flat(), [{ text: PHONE.share, request_contact: true }, { text: PHONE.later }]);
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  assert.equal(store.getDriver(42).phone, "+998901234567");

  // Raqam bor — o'sha joyda «➕ Guruh qo'shish» (Azimjon, 2026-11-10); raqamni almashtirish — /raqam.
  // Eski menyudagi «📱 Raqamim» ham /raqam
  assert.deepEqual(lastMarkup(calls).keyboard[1].map((b) => b.text), [MENU.role, MENU.addGroup]);
  assert.ok(!buttons(lastMarkup(calls)).some((b) => b.text === MENU.phone || b.text === MENU.myPhone));
  calls.length = 0;
  await command("/start");
  const withPhone = texts(calls).find((t) => /Pastdagi tugmalar/.test(t));
  assert.match(withPhone, /\n➕ Guruh qo'shish — o'z yuk guruhingiz yoki kanalingizni qo'shing — undagi e'lonlar ham shu yerga keladi\.\n/);
  assert.doesNotMatch(withPhone, /📱 Raqam ulashish/);
  await message(PRIVATE, MENU.myPhone);
  assert.match(texts(calls).at(-1), /Sizning raqamingiz: <b>\+998 90 123 45 67/);

  // Ilovalar endi buyruq bilan (eski menyudagi tugma ham ishlayveradi)
  await command("/ilovalar");
  assert.match(texts(calls).at(-1), /Yuk Ekspert ilovalari/);
});

test("/start matni rol tanlanmaganda (Azimjon matni) va yuk beruvchida ham to'g'ridan-to'g'ri yuk bilan boshlanadi", async () => {
  const { store, calls, command } = setup();
  await command("/start");
  assert.equal(
    texts(calls)[0],
    "Assalomu alaykum!\n\n" +
      "🚛 <b>Yuk Eksperti</b> — guruhlardagi yuk e'lonlarini shu yerga, darhol yuboradi. Yuk egasi esa yukini to'g'ridan-to'g'ri haydovchiga beradi.\n\n" +
      "❓ Tushunmasangiz — @YukExperti ga yozing, yordam beradi.",
  );
  assert.equal(texts(calls)[1], "Iltimos, tanlang 👇");
  calls.length = 0;
  store.saveDriver(42, { role: "yuk_beruvchi", active: true, phoneAskedAt: 1 });
  await command("/start");
  // Yuk beruvchida ham — o'sha bot haqidagi matn (rolga qarab alohida matn 2026-11-10 dan yo'q)
  assert.match(texts(calls)[0], /^Assalomu alaykum!\n\n<b>Pastdagi tugmalar<\/b> \(siz: 📦 Yuk beruvchi\)/);
});

test("bot tavsifi («Bu bot nima qila oladi?») — Azimjon matni, Telegram chekidan (512) qisqa; o'zgarmagan bo'lsa qayta yuborilmaydi", async () => {
  let saved = null;
  const { calls, init } = setup({ answer: (method) => (method === "getMyDescription" ? { description: saved ?? "eski" } : undefined) });
  await init();
  const description = calls.find((c) => c.method === "setMyDescription").payload.description;
  assert.equal(
    description,
    "🚛 Yuk Eksperti — guruhlardagi yuk e'lonlarini shu yerga, darhol yuboradi. Yuk egasi esa yukini to'g'ridan-to'g'ri haydovchiga beradi.\n\n" +
      "📢 Kanal: @Yuk_Ekspert\n💬 Guruh: @Yuk_Ekspert_chat\n\n" +
      "Boshlash uchun /start ni bosing!",
  );
  assert.ok(description.length <= 512);
  assert.ok(!calls.some((c) => c.method === "setMyCommands"), "buyruqlar hamma uchun qo'yilmaydi (commands.js — faqat rol tanlaganlarga)");
  saved = description;
  calls.length = 0;
  await init();
  assert.ok(!calls.some((c) => c.method === "setMyDescription"));
});

test("raqam: «Keyinroq» — menyu qaytadi va bot boshqa so'ramaydi", async () => {
  const { store, calls, webAppData, message, command } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE }); // yo'nalishi bor — saqlagach darrov raqam so'raladi
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: FORM }));
  assert.deepEqual(store.getDriver(42).profile.fromAreas, ["toshkent"], "yo'nalish qoldi");
  assert.match(texts(calls).at(-1), /ulashasizmi/);
  await message(PRIVATE, PHONE.later);
  assert.match(texts(calls).at(-1), /Mayli[\s\S]*«📱 Raqam ulashish»/);
  assert.doesNotMatch(texts(calls).at(-1), /qayerdan qayerga/, "yo'nalishi bor — «Qayerdan?» so'ralmaydi");
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
  assert.match(texts(calls).at(-1), /Yoqildi — botga yuklar yana keladi/);
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

  // Qayta /start — qaytdi: «o'chirgan» belgisi olinadi, boshidan (rol tanlash), necha marta o'chirgani qoladi
  await command("/start");
  user = store.getDriver(42);
  assert.deepEqual([user.deletedAt, user.deletedCount, user.role], [null, 1, null]);
  assert.match(texts(calls).at(-1), ROLE_QUESTION);
  assert.equal(store.driverDetails(42).events.find((e) => e.type === "returned").detail.via, "bot");
});

// --- Kanal va guruhga a'zolik (members.js) ---
const REQUIRED = { requiredChats: ["@Yuk_Ekspert", "@Yuk_Ekspert_chat"] };
// joined — "chat:user" yozuvlari; testda init() chaqirilmaydi, shuning uchun so'rov chat nomi bilan keladi
const memberAnswer = (joined) => (method, payload) =>
  method === "getChatMember"
    ? { status: joined.has(`${payload.chat_id}:${payload.user_id}`) ? "member" : "left", user: { id: payload.user_id, is_bot: false, first_name: "X" } }
    : undefined;
const memberUpdate = (chat, userId, from, to) => {
  const user = { id: userId, is_bot: false, first_name: "Vali" };
  return { chat_member: { chat, from: user, date: 0, old_chat_member: { status: from, user }, new_chat_member: { status: to, user } } };
};

test("a'zolik: a'zo bo'lmaguncha bot ishlamaydi — «a'zo bo'ling», tugmalar va «✅ A'zo bo'ldim»", async () => {
  const joined = new Set();
  const { store, calls, command, press, message } = setup({ config: REQUIRED, answer: memberAnswer(joined) });
  await command("/start");
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.equal(sent.length, 1, "/start ning o'zi bajarilmaydi");
  assert.match(sent[0].payload.text, /Botdan foydalanish uchun kanal va guruhimizga a'zo bo'ling/);
  assert.deepEqual(inlineButtons(sent[0]).map((b) => b.url ?? b.callback_data), ["https://t.me/Yuk_Ekspert", "https://t.me/Yuk_Ekspert_chat", "sub:check"]);
  const user = store.getDriver(42);
  assert.equal(user.name, "Ali", "yangi odam bazaga yoziladi (boshqaruv markazida ko'rinadi)");
  assert.deepEqual([user.subOk, user.subMissing], [false, ["@Yuk_Ekspert", "@Yuk_Ekspert_chat"]]);

  await message(PRIVATE, MENU.help);
  assert.match(texts(calls).at(-1), /a'zo bo'ling/, "menyu tugmasi ham to'siqdan o'tmaydi");

  // Faqat kanalga a'zo bo'ldi — «Hali a'zo emassiz» oynasi, ro'yxatda kanal ✅
  joined.add("@Yuk_Ekspert:42");
  await press("sub:check");
  const alert = calls.filter((c) => c.method === "answerCallbackQuery").at(-1).payload;
  assert.equal(alert.show_alert, true);
  assert.match(alert.text, /Hali a'zo emassiz: @Yuk_Ekspert_chat/);
  assert.match(texts(calls, "editMessageText").at(-1), /guruhimizga a'zo bo'ling[\s\S]*✅ <b>@Yuk_Ekspert<\/b>/);

  joined.add("@Yuk_Ekspert_chat:42");
  await press("sub:check");
  assert.match(texts(calls, "editMessageText").at(-1), /Rahmat/);
  assert.match(texts(calls).at(-1), ROLE_QUESTION, "a'zo bo'lgach — /start ekrani");
  assert.equal(store.getDriver(42).subOk, true);
  assert.deepEqual(
    store.driverDetails(42).events.filter((e) => e.type.startsWith("sub_")).map((e) => [e.type, e.detail?.missing ?? null]),
    [["sub_joined", null], ["sub_left", ["@Yuk_Ekspert_chat"]], ["sub_left", ["@Yuk_Ekspert", "@Yuk_Ekspert_chat"]]],
  );

  // A'zo — keyingi xabarlar odatdagidek, Telegram'ga qayta so'rov ketmaydi (10 daqiqa eslab qolinadi)
  const asked = calls.filter((c) => c.method === "getChatMember").length;
  await press("r:haydovchi");
  assert.equal(store.getDriver(42).role, "haydovchi");
  assert.equal(calls.filter((c) => c.method === "getChatMember").length, asked);
});

test("a'zolik: /ochirish va adminlar tekshirilmaydi; REQUIRED_CHATS bo'lmasa — hammaga", async () => {
  const outsider = setup({ config: REQUIRED, answer: memberAnswer(new Set()) });
  await outsider.command("/ochirish");
  assert.match(texts(outsider.calls).at(-1), /Siz haqingizda nimani saqlaymiz/);

  const admin = setup({ config: { ...REQUIRED, admins: [42] }, answer: memberAnswer(new Set()) });
  await admin.command("/start");
  assert.match(texts(admin.calls).at(-1), ROLE_QUESTION);
  assert.equal(await admin.canReceive({ chatId: 42 }), true);
  assert.ok(!admin.calls.some((c) => c.method === "getChatMember"));

  const open = setup({ answer: memberAnswer(new Set()) });
  await open.command("/start");
  assert.match(texts(open.calls).at(-1), ROLE_QUESTION);
  assert.equal(await open.canReceive({ chatId: 42 }), true);
});

test("a'zolik: yuk a'zo bo'lmaganga bormaydi — eslatma kuniga bir marta; kanalga qo'shilsa — darrov, chiqsa — xabar", async () => {
  const joined = new Set();
  const { store, calls, send, canReceive } = setup({ config: REQUIRED, answer: memberAnswer(joined) });
  const profile = { vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 20000 }, fromAreas: [], toAreas: [], routeAt: 1 };
  store.saveDriver(7, { name: "Vali", role: "haydovchi", profile, active: true });

  assert.equal(await canReceive(store.getDriver(7)), false);
  assert.match(texts(calls).at(-1), /Sizga mos yangi yuk chiqdi, lekin yuborilmadi/);
  assert.ok(store.getDriver(7).subRemindedAt > 0);
  assert.equal(await canReceive(store.getDriver(7)), false);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 1, "eslatma — kuniga bir marta");

  // Ikkalasiga qo'shildi: Telegram chat_member yangilanishini yuboradi → eslab qolingan «a'zo emas» o'chadi
  joined.add("@Yuk_Ekspert:7");
  joined.add("@Yuk_Ekspert_chat:7");
  await send(memberUpdate(CHANNEL, 7, "left", "member"));
  assert.equal(await canReceive(store.getDriver(7)), true);
  assert.equal(store.getDriver(7).subOk, true);

  // Boshqa haydovchi kanaldan chiqdi — darrov xabar (yuk kelishini kutmasdan)
  store.saveDriver(8, { name: "G'ani", role: "haydovchi", profile, active: true });
  joined.add("@Yuk_Ekspert:8");
  joined.add("@Yuk_Ekspert_chat:8");
  assert.equal(await canReceive(store.getDriver(8)), true);
  joined.delete("@Yuk_Ekspert:8");
  await send(memberUpdate(CHANNEL, 8, "member", "left"));
  const last = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.equal(last.payload.chat_id, 8);
  assert.match(last.payload.text, /Siz @Yuk_Ekspertdan chiqdingiz — yuklar endi yuborilmaydi/);
  assert.equal(store.getDriver(8).subOk, false);

  // Botdan foydalanmagan odam kanalga qo'shilsa — hech narsa yozilmaydi va so'ralmaydi
  const asked = calls.length;
  await send(memberUpdate(CHANNEL, 555, "left", "member"));
  assert.equal(calls.length, asked);
  assert.equal(store.getDriver(555), null);
});

test("blok: bloklangan odam nima yozsa ham «Uzr, sizga xizmat ko'rsata olmaymiz!»; tugma — oynachada; ADMIN_IDS — bloklanmaydi", async () => {
  const { store, calls, command, press, message } = setup({ config: REQUIRED, answer: memberAnswer(new Set()) });
  store.saveDriver(42, { name: "Ali" });
  store.banDriver(42);
  await command("/start");
  await message(PRIVATE, MENU.help);
  const sent = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(sent.map((c) => c.payload.text), ["Uzr, sizga xizmat ko'rsata olmaymiz!", "Uzr, sizga xizmat ko'rsata olmaymiz!"]);
  assert.equal(sent[0].payload.reply_markup.remove_keyboard, true, "pastki menyu olinadi");
  assert.ok(!calls.some((c) => c.method === "getChatMember"), "a'zolik ham tekshirilmaydi");
  await press("r:haydovchi");
  const alert = calls.filter((c) => c.method === "answerCallbackQuery").at(-1).payload;
  assert.deepEqual([alert.text, alert.show_alert], ["Uzr, sizga xizmat ko'rsata olmaymiz!", true]);
  assert.equal(store.getDriver(42).role, null);

  // username bo'yicha: boshqa akkaunt (id boshqa), lekin o'sha username
  store.unbanDriver(42);
  store.saveDriver(43, { name: "Eski", username: "ali_yangi" });
  store.banDriver(43);
  await message(PRIVATE, "salom", { from: { ...USER, username: "Ali_Yangi" } });
  assert.equal(texts(calls).at(-1), "Uzr, sizga xizmat ko'rsata olmaymiz!");

  const owner = setup({ config: { admins: [42] } });
  owner.store.saveDriver(42, { name: "Ali" });
  owner.store.banDriver(42);
  await owner.command("/start");
  assert.match(texts(owner.calls).at(-1), ROLE_QUESTION);
});

test("xaritada yo'nalish tanlandi (server topshirig'i): «Qayerdan?» xabari «✅ Yo'nalish» ga almashadi, keyin mos yuklar", async () => {
  const { store, calls, message, notices } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: { ...FORM }, active: true, phoneAskedAt: 1 });
  await message(PRIVATE, MENU.loads);
  const picker = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(picker.payload.text, /Qayerdan yuk olasiz/);
  const pickerId = store.routeMessage(42);
  assert.ok(pickerId > 0, "chatdagi «Qayerdan?» xabari eslab qolindi");

  // Web xaritasi: PUT /pub/me/route { notify: true } shunday qiladi (apps/api public.js)
  store.saveDriver(42, { profile: applyRoute(store.getDriver(42).profile, "samarqand", "toshkent", Date.now()) });
  store.addBotNotice(42, "route");
  store.addBotNotice(42, "route"); // ikki marta bosilsa ham — bitta topshiriq
  calls.length = 0;
  assert.equal(await notices.runOnce(), 1);
  const edited = calls.find((c) => c.method === "editMessageText");
  assert.deepEqual([edited.payload.chat_id, edited.payload.message_id], [42, pickerId]);
  assert.match(edited.payload.text, /✅ Yo'nalish: <b>Samarqand vil\. → Toshkent vil\.<\/b>/);
  assert.match(texts(calls).at(-1), /mos yuk chiqmadi/, "keyin — mos yuklar (bu yerda yo'q)");
  assert.equal(store.routeMessage(42), null);
  assert.equal(await notices.runOnce(), 0, "navbat bo'sh");

  // Eslab qolingan xabar yo'q — «✅ Yo'nalish» yangi xabar bo'lib keladi; raqam hali so'ralmagan bo'lsa — so'raladi
  store.saveDriver(42, { phoneAskedAt: null });
  store.addBotNotice(42, "route");
  calls.length = 0;
  await notices.runOnce();
  assert.ok(!calls.some((c) => c.method === "editMessageText"));
  const sent = texts(calls);
  assert.match(sent[0], /✅ Yo'nalish: <b>Samarqand vil\./);
  assert.match(sent.at(-1), /Telefon raqamingizni ulashasizmi/);

  // Yuk beruvchi (yoki rolini almashtirgan) — topshiriq jim tashlanadi
  store.switchRole(42, "yuk_beruvchi");
  store.addBotNotice(42, "route");
  calls.length = 0;
  await notices.runOnce();
  assert.deepEqual(calls, []);
});

test("web sozlamalarida raqam o'chirildi → bot «Raqamingiz o'chirildi» deb menyuni yangilaydi; qayta ulashgan bo'lsa — jim", async () => {
  const { store, calls, notices } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phone: null, phoneAskedAt: 1 });
  store.addBotNotice(42, "phone_deleted"); // server: DELETE /pub/me/phone
  await notices.runOnce();
  assert.equal(texts(calls).at(-1), "✅ Raqamingiz o'chirildi.");
  const menuButtons = buttons(lastMarkup(calls));
  assert.ok(menuButtons.some((b) => b.text === MENU.phone && !b.request_contact), "«➕ Guruh qo'shish» o'rnida yana «📱 Raqam ulashish»");
  assert.ok(!menuButtons.some((b) => b.text === MENU.addGroup));

  store.saveDriver(42, { phone: "+998901234567" });
  store.addBotNotice(42, "phone_deleted");
  calls.length = 0;
  await notices.runOnce();
  assert.deepEqual(calls, []);
});

// --- «➕ Guruh qo'shish» (userSources.js; Azimjon, 2026-11-10) ---
test("guruh qo'shish: raqamsizga — avval raqam; raqami borga — tushuntirish, havola tekshiriladi va tekshiruvga qo'yiladi", async () => {
  const chats = {
    "@Yangi_Guruh": { id: -100555, type: "supergroup", title: "Yangi <guruh>", username: "Yangi_Guruh" },
    "@ali_odam": { id: 5, type: "private", first_name: "Ali", username: "ali_odam" },
    "@yuk_kanal": { id: -100777, type: "channel", title: "Yuk kanali", username: "yuk_kanal" },
  };
  const { store, calls, message, command } = setup({
    config: { requiredChats: [] },
    fail: (method, payload) => method === "getChat" && !chats[payload.chat_id] && { ok: false, error_code: 400, description: "Bad Request: chat not found" },
    answer: (method, payload) => (method === "getChat" ? chats[payload.chat_id] : method === "getChatMemberCount" ? 1500 : undefined),
  });
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phoneAskedAt: 1 });

  await message(PRIVATE, MENU.addGroup);
  assert.equal(
    texts(calls).at(-1),
    "➕ Guruh qo'shish — o'z yuk guruhingiz yoki kanalingizni qo'shing — undagi e'lonlar ham shu yerga keladi.\n\n" +
      "Avval raqamingizni ulashing — pastdagi «📱 Raqam ulashish» tugmasini bosing 👇\nKeyin guruh havolasini yuborasiz.",
  );
  assert.deepEqual(buttons(lastMarkup(calls))[0], { text: PHONE.share, request_contact: true });
  await message(PRIVATE, "https://t.me/Yangi_Guruh");
  assert.match(texts(calls).at(-1), /Avval raqamingizni ulashing[\s\S]*Havolangizni shundan keyin darhol tekshiramiz/, "havola ham raqamsiz qabul qilinmaydi");
  assert.equal(store.findSource("@Yangi_Guruh"), null);

  store.saveDriver(42, { phone: "+998900000001" });
  await command("/guruh_qoshish");
  const byCommand = texts(calls).at(-1);
  await message(PRIVATE, MENU.addGroup);
  assert.equal(texts(calls).at(-1), byCommand, "/guruh_qoshish = menyudagi tugma");
  assert.match(
    texts(calls).at(-1),
    /^<b>➕ Guruh qo'shish<\/b> — o'z yuk guruhingiz yoki kanalingizni qo'shing — undagi e'lonlar ham shu yerga keladi\.\n\n👇 Guruh yoki kanal havolasini[\s\S]*kamida 5 ta yuk e'loni/,
  );
  assert.doesNotMatch(texts(calls).at(-1), /biladigan/);
  assert.doesNotMatch(texts(calls).at(-1), /Siz qo'shgan guruhlar/);

  await message(PRIVATE, "https://t.me/s/Yangi_Guruh/123");
  assert.deepEqual(calls.filter((c) => c.method === "getChat").map((c) => c.payload.chat_id), ["@Yangi_Guruh"]);
  assert.equal(texts(calls).at(-1), "🔎 <b>Yangi &lt;guruh&gt;</b> (@Yangi_Guruh) qabul qilindi. Oxirgi xabarlarini ko'rib chiqyapmiz — 1–2 daqiqada javob beramiz.");
  const row = store.findSource("@yangi_guruh");
  assert.deepEqual([row.checkState, row.enabled, row.addedBy, row.members, row.chatType], ["probe", false, 42, 1500, "group"]);

  // Qayta yuborsa (boshqa ko'rinishda ham) — Telegram'ga so'ramaydi, «siz allaqachon yuborgansiz» + holati; ro'yxatda ham ko'rinadi
  await message(PRIVATE, "@yangi_guruh");
  assert.equal(
    texts(calls).at(-1),
    "ℹ️ Bu guruhni siz allaqachon yuborgansiz: <b>Yangi &lt;guruh&gt;</b> (@Yangi_Guruh).\n🔎 Hozir tekshirilyapti — natijasini 1–2 daqiqada shu yerga yozamiz.",
  );
  assert.equal(calls.filter((c) => c.method === "getChat").length, 1);
  await message(PRIVATE, MENU.addGroup);
  assert.match(texts(calls).at(-1), /Siz qo'shgan guruhlar:<\/b>\n🔎 <b>Yangi &lt;guruh&gt;<\/b> \(@Yangi_Guruh\) — oxirgi xabarlari ko'rib chiqilyapti/);

  // Noto'g'ri havolalar
  // Yopiq guruh havolasi — Telegram akkaunt ulanmagan bo'lsa, avval /account_qosh
  await message(PRIVATE, "https://t.me/+AbCdEf123");
  assert.match(texts(calls).at(-1), /Bu yopiq guruh havolasi\. .*\/account_qosh/);
  await message(PRIVATE, "@yuk_ekspert_agent_bot");
  assert.match(texts(calls).at(-1), /botning manzili/);
  await message(PRIVATE, "@ali_odam");
  assert.match(texts(calls).at(-1), /odamning manzili/);
  await message(PRIVATE, "t.me/yoq_guruh");
  assert.match(texts(calls).at(-1), /@yoq_guruh topilmadi/);
  await message(PRIVATE, "@Yuk_Ekspert");
  assert.match(texts(calls).at(-1), /bizning o'z kanalimiz/);
  assert.equal(calls.filter((c) => c.method === "getChat").length, 3, "o'z kanalimiz va yopiq havola Telegram'ga so'ralmaydi");

  // Bir vaqtda ko'pi bilan 3 tasi tekshiriladi
  store.addUserSource({ name: "@ikki", chatId: 42 });
  store.addUserSource({ name: "@uch", chatId: 42 });
  await message(PRIVATE, "@yuk_kanal");
  assert.match(texts(calls).at(-1), /Sizda 3 ta guruh tekshirilyapti/);
  assert.equal(store.findSource("@yuk_kanal"), null);

  // Bizda avvaldan bor manba (boshqaruv markazidan qo'shilgan — nomi va turi bazada yo'q): «avvaldan mavjud», limit sanalmaydi,
  // turi va nomi Telegram'dan; Telegram javob bermasa — «guruh/kanal»
  store.addSource("@TutGruz");
  chats["@TutGruz"] = { id: -100999, type: "channel", title: "Tut Gruz", username: "TutGruz" };
  await message(PRIVATE, "https://t.me/tutgruz/5");
  assert.equal(
    texts(calls).at(-1),
    "ℹ️ Bu kanal bizda avvaldan mavjud: <b>Tut Gruz</b> (@TutGruz).\n✅ Undagi mos e'lonlar sizga ham keladi — qayta qo'shish shart emas.",
  );
  store.addSource("@Eski_Guruh");
  await message(PRIVATE, "@eski_guruh");
  assert.match(texts(calls).at(-1), /^ℹ️ Bu guruh\/kanal bizda avvaldan mavjud: <b>@Eski_Guruh<\/b>\.\n/);
  assert.equal(store.findSource("@TutGruz").addedBy, null, "admin manbasiga tegilmaydi");
});

test("guruh qo'shish uchun raqam ulashsa — yo'nalish savoli emas, guruh qo'shishga qaytadi; boshqa ish qilsa — unutiladi", async () => {
  // Azimjon (2026-11-10): /guruh_qoshish → «raqam ulashing» → ulashdi → «Qayerdan yuk olasiz?» chiqqan edi
  const chats = { "@Yangi_Guruh": { id: -100555, type: "supergroup", title: "Yangi guruh", username: "Yangi_Guruh" } };
  const { store, calls, message, command } = setup({
    config: { requiredChats: [] },
    fail: (method, payload) => method === "getChat" && !chats[payload.chat_id] && { ok: false, error_code: 400, description: "Bad Request: chat not found" },
    answer: (method, payload) => (method === "getChat" ? chats[payload.chat_id] : method === "getChatMemberCount" ? 900 : undefined),
  });
  const route = () => texts(calls).filter((t) => /Qayerdan yuk olasiz/.test(t)).length;
  store.saveDriver(42, { role: "haydovchi", profile: FORM, active: true, phoneAskedAt: 1 }); // yo'nalish hali tanlanmagan

  // 1) Tugma / buyruq → raqam → «Raqamingiz saqlandi» + guruh qo'shish xabari (bitta xabarda), yo'nalish so'ralmaydi
  await command("/guruh_qoshish");
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  assert.equal(store.getDriver(42).phone, "+998901234567");
  assert.match(texts(calls).at(-1), /^Raqamingiz saqlandi! ✅\n\n<b>➕ Guruh qo'shish<\/b> — o'z yuk guruhingiz yoki kanalingizni qo'shing/);
  assert.ok(buttons(lastMarkup(calls)).some((b) => b.text === MENU.addGroup), "menyuda endi «➕ Guruh qo'shish»");
  assert.equal(route(), 0);

  // 2) Havola yuborgan edi → raqamdan keyin o'sha havola darhol tekshiriladi
  store.saveDriver(42, { phone: null });
  await message(PRIVATE, "https://t.me/Yangi_Guruh");
  assert.equal(store.findSource("@Yangi_Guruh"), null);
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  assert.equal(texts(calls).at(-1), "Raqamingiz saqlandi! ✅\n\n🔎 <b>Yangi guruh</b> (@Yangi_Guruh) qabul qilindi. Oxirgi xabarlarini ko'rib chiqyapmiz — 1–2 daqiqada javob beramiz.");
  assert.equal(store.findSource("@Yangi_Guruh").addedBy, 42);
  assert.equal(route(), 0);

  // 3) «Keyinroq» — faqat menyu, yo'nalish savolisiz; niyat unutiladi
  store.saveDriver(42, { phone: null });
  await command("/guruh_qoshish");
  await message(PRIVATE, PHONE.later);
  assert.match(texts(calls).at(-1), /^Mayli 👍/);
  assert.equal(route(), 0);

  // 4) Raqam so'ralgach boshqa ish qildi (/yordam) — keyin menyudan ulashsa, odatdagidek (yo'nalish savoli)
  await command("/guruh_qoshish");
  await command("/yordam");
  await message(PRIVATE, undefined, contact({ user_id: 42 }));
  assert.equal(texts(calls).filter((t) => t === "Raqamingiz saqlandi! ✅").length, 1);
  assert.equal(route(), 1);
});

test("guruh qo'shish: natija qo'shgan odamga bir marta, pastki menyu bilan; sinov 5 ta yuk e'lonida o'tadi", async () => {
  const { store, calls, sources } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true, phone: "+998900000001" });
  store.addUserSource({ name: "@Yangi_Guruh", chatId: 42, title: "Yangi guruh" });
  store.finishProbe("@Yangi_Guruh", { ok: true, note: "Oxirgi 50 ta xabaridan 31 tasi yuk e'loniga o'xshaydi", stats: { loadLike: 31 } });
  await sources.runOnce();
  assert.match(texts(calls).at(-1), /^🧪 <b>Yangi guruh<\/b> \(@Yangi_Guruh\) sinovga olindi: oxirgi 50 ta xabaridan 31 tasi yuk e'loniga o'xshaydi\.\nShu paytdan undagi mos e'lonlar ham sizga keladi\.\nErtaga \d\d:\d\d gacha \(24 soat\) kamida 5 ta yuk e'loni chiqsa — doimiy qo'shiladi\.$/);
  assert.equal(buttons(lastMarkup(calls))[0].text, MENU.loads, "pastki menyu bilan");
  const sent = calls.length;
  await sources.runOnce();
  assert.equal(calls.length, sent, "ikkinchi marta yozilmaydi");

  for (let i = 1; i <= 5; i++) {
    const post = store.addPost({ source: "@Yangi_Guruh", messageId: i, text: `Toshkentdan Samarqandga ${i} tonna yuk bor` });
    store.finishPost(post.id, "done");
  }
  // Botdagi kuzatuvchi sinov hisobini daqiqada bir qiladi — shu yerda yangisi bilan darhol
  await createSourceWatcher({ store, send: (chatId, text) => calls.push({ method: "sendMessage", payload: { chat_id: chatId, text } }), log: () => {} }).runOnce();
  assert.equal(store.findSource("@Yangi_Guruh").checkState, "ok");
  assert.equal(texts(calls).at(-1), "✅ <b>Yangi guruh</b> (@Yangi_Guruh) doimiy qo'shildi: sinov paytida 5 ta yuk e'loni chiqdi. Rahmat!");
});

// --- «📦 Yuk berish»: yuk beruvchi botga oddiy xabar yozadi (shipperLoads.js, 2026-11-10). Raqamlar soxta ---
const LOAD = { fromCity: "Andijon", fromRegion: "andijon", fromCountry: "O'zbekiston", toCity: "Toshkent", toRegion: "toshkent_sh", toCountry: "O'zbekiston", cargo: "un", weightT: 20, truckClass: "fura", bodyType: "tent", phones: [] };
const shipperSetup = (result, extra = {}) => {
  const queued = [];
  const parsed = [];
  const parseLoad = async (text) => {
    parsed.push(text);
    return typeof result === "function" ? result(text) : result;
  };
  const env = setup({ parseLoad, onLoadQueued: () => queued.push(1), ...extra });
  env.store.saveDriver(42, { role: "yuk_beruvchi", active: true, phoneAskedAt: 1 });
  return { ...env, queued, parsed };
};
const lastSent = (calls) => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1).payload;
const callbacks = (payload) => payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data ?? b.text);

// Azimjon, 2026-11-12: «bot chatiga yuk haqida ma'lumotni yozib tushsam ham bo'lishligini 1-o'rinda va bold qilib
// yozib ber. hozirda u 2-o'rinda va ko'rimsiz» — web forma BOR bo'lganda ham chatga yozish 1️⃣ va QALIN, forma 2️⃣
test("«📦 Yuk berish» tugmasi (ilova bor bo'lsa ham) — oddiy tugma, chatda namuna; formaga yo'naltirmaydi (2026-11-27)", async () => {
  const { calls, message, command } = shipperSetup(null, { config: { miniappUrl: MINIAPP } });
  await command("/start");
  const give = buttons(lastMarkup(calls)).find((b) => b.text === MENU.giveLoad);
  assert.equal(give.web_app, undefined, "Mini App ochilmaydi");
  await message(PRIVATE, MENU.giveLoad);
  const intro = texts(calls).at(-1);
  assert.ok(intro.includes("Masalan:\n<b>Andijondan Toshkentga 20 tonna un bor, tent fura kerak, 3 mln, ertaga. 90 123 45 67</b>"), "misol bold");
  assert.ok(!/forma/i.test(intro));
});

test("yuk beruvchi oddiy xabar yozdi: raqamli — darhol ko'rinish, «✅ Yuborish» → navbatga, natija chatga", async () => {
  const { store, calls, message, press, queued, parsed, directDone } = shipperSetup({ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: ["+998900000001"] }], by: "rules" });
  await message(PRIVATE, "Andijondan Toshkentga 20 tonna un, tent fura kerak. 90 000 00 01");
  assert.deepEqual(parsed, ["Andijondan Toshkentga 20 tonna un, tent fura kerak. 90 000 00 01"]);
  assert.ok(calls.some((c) => c.method === "sendChatAction"), "«yozmoqda...» belgisi");
  const shown = lastSent(calls);
  assert.match(shown.text, /^📋 <b>Haydovchilarga shunday boradi:<\/b>[\s\S]*Andijon → Toshkent[\s\S]*\+998900000001[\s\S]*Hammasi to'g'rimi\?$/);
  assert.deepEqual(callbacks(shown), ["yb:send", "yb:no"], "forma manzili yo'q — «Formada tuzatish» ham yo'q");
  assert.equal(store.shipperPosts(42).length, 0, "tasdiqlanmaguncha navbatga tushmaydi");

  await press("yb:send");
  assert.equal(queued.length, 1, "ishchi darhol uyg'otildi");
  const [post] = store.shipperPosts(42);
  assert.equal(post.via, "bot");
  assert.equal(post.status, "new");
  assert.deepEqual(post.direct[0].phones, ["+998900000001"]);
  assert.deepEqual(store.getDriver(42).loadPhones, ["+998900000001"], "keyingi safar tugma bo'lib turadi");
  assert.match(lastSent(calls).text, /^📤 <b>Yuborildi<\/b>[\s\S]*Andijon → Toshkent/);
  // Ikkinchi bosish — qoralama yo'q
  await press("yb:send");
  assert.match(calls.filter((c) => c.method === "answerCallbackQuery").at(-1).payload.text, /eskirgan yoki allaqachon yuborilgan/);
  assert.equal(store.shipperPosts(42).length, 1);

  // Ishchi yubordi — natija yuk beruvchiga
  await directDone({ shipper: 42 }, { status: "done", fresh: 1, sent: 3 });
  assert.match(texts(calls).at(-1), /^✅ Yukingiz 3 ta mos haydovchiga yuborildi\. Ular sizga o'zlari qo'ng'iroq qilishadi\./);
  await directDone({ shipper: 42 }, { status: "done", fresh: 1, sent: 0 });
  assert.match(texts(calls).at(-1), /Hozircha unga mos haydovchi topilmadi/);
  await directDone({ shipper: 42 }, { status: "done", fresh: 0, sent: 0 });
  assert.match(texts(calls).at(-1), /allaqachon yuborilgan/);
  // Hisobini o'chirgan — yozilmaydi
  store.deleteDriver(42);
  const before = calls.length;
  await directDone({ shipper: 42 }, { status: "done", fresh: 1, sent: 3 });
  assert.equal(calls.length, before);
});

test("yuk beruvchi: matnda raqam yo'q — «Qaysi raqamga?»: oldingi raqami tugmada yoki yozib yuboradi; «❌» — bekor", async () => {
  const { store, calls, message, press } = shipperSetup({ ok: true, postType: "yuk_bor", loads: [LOAD], by: "ai" });
  store.saveDriver(42, { phone: "+998900000005" });
  await message(PRIVATE, "Andijondan Toshkentga 20 tonna un bor");
  let shown = lastSent(calls);
  assert.match(shown.text, /Haydovchilar qaysi raqamga qo'ng'iroq qilsin/);
  assert.deepEqual(callbacks(shown), ["yb:ph:0", "yb:no"]);
  assert.match(shown.reply_markup.inline_keyboard[0][0].text, /\+998 90 000 00 05/);
  // «Yuborish» hali yo'q — raqamsiz yuk yuborilmaydi
  await press("yb:send");
  assert.equal(store.shipperPosts(42).length, 0);
  // Qisqa, raqam emas — «tushunmadim»
  await message(PRIVATE, "salom");
  assert.match(lastSent(calls).text, /Raqamni tushunmadim/);
  // Yozdi — ikkita raqam
  await message(PRIVATE, "90 000 00 01, 90 000 00 02");
  shown = lastSent(calls);
  assert.match(shown.text, /\+998900000001, \+998900000002/);
  assert.deepEqual(callbacks(shown), ["yb:send", "yb:no"]);
  await press("yb:no");
  assert.equal(lastSent(calls).text, "❌ Bekor qilindi.");
  assert.equal(store.loadDraft(42), null);

  // Yana yozdi — endi tugmadagi raqam bilan
  await message(PRIVATE, "Andijondan Toshkentga 20 tonna un bor");
  await press("yb:ph:0");
  assert.match(lastSent(calls).text, /\+998900000005/);
  await press("yb:send");
  assert.deepEqual(store.shipperPosts(42)[0].direct[0].phones, ["+998900000005"]);
});

test("yuk beruvchi ovozli xabar yuboradi (2026-11-27): Telegram'dan olinadi → matnga → «🎤 Eshitdim» → odatdagi tasdiqlash", async () => {
  const heardFrom = [];
  let spoken = "Andijondan Toshkentga 20 tonna un bor 90 000 00 01";
  const { calls, send, parsed } = shipperSetup({ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: ["+998900000001"] }] }, {
    answer: (method, payload) => (method === "getFile" ? { file_id: payload.file_id, file_unique_id: "u", file_path: "voice/file_1.oga" } : undefined),
    downloadFile: async (filePath) => Buffer.from(`ovoz:${filePath}`),
    transcribeVoice: async (data, mime) => {
      heardFrom.push([String(data), mime]);
      return spoken;
    },
  });
  const voice = (duration) => send({ message: { message_id: 500 + duration, date: 1_700_000_000, chat: PRIVATE, from: USER, voice: { file_id: "v1", file_unique_id: "u1", duration, mime_type: "audio/ogg" } } });
  await voice(9);
  assert.deepEqual(heardFrom, [["ovoz:voice/file_1.oga", "audio/ogg"]]);
  assert.deepEqual(parsed, [spoken], "eshitilgani matndek tushuniladi");
  assert.match(texts(calls).at(-2), /🎤 Eshitdim: <i>«Andijondan Toshkentga 20 tonna un bor/);
  assert.deepEqual(callbacks(lastSent(calls)), ["yb:send", "yb:no"], "tasdiqlash tugmalari");
  // Tushunilmadi — yozib yuborish taklifi; juda uzun — 2 daqiqagacha
  spoken = null;
  await voice(5);
  assert.match(texts(calls).at(-1), /Ovozingizni tushuna olmadim[\s\S]*masalan/);
  await voice(200);
  assert.match(texts(calls).at(-1), /juda uzun/);
  assert.equal(heardFrom.length, 2, "uzun ovoz yuklab olinmaydi");
});

test("yuk beruvchi: tushunilmadi / bo'sh mashina / boshqa yo'nalish / AI band / chegara; haydovchi xabari yuk emas", async () => {
  let result = { ok: true, postType: "boshqa", loads: [] };
  const { store, calls, message } = shipperSetup(() => result);
  const reply = async (text) => {
    await message(PRIVATE, text);
    return lastSent(calls).text;
  };
  assert.match(await reply("salom"), /Bu xabardan yukni tushunmadim/);
  result = { ok: true, postType: "mashina_bor", loads: [LOAD] };
  assert.match(await reply("bo'sh fura bor"), /bo'sh mashina e'loniga o'xshaydi/);
  result = { ok: true, postType: "yuk_bor", loads: [{ ...LOAD, toCity: "Moskva", toRegion: "xorij", toCountry: "Rossiya", phones: ["+998900000001"] }] };
  assert.match(await reply("Andijondan Moskvaga 20 tonna"), /Bu yo'nalish hozircha qo'llanmaydi: Andijon → Rossiya, Moskva./);
  result = null;
  assert.match(await reply("Andijondan Toshkentga 20 tonna"), /tushuna olmadim/);
  // 24 soatda 20 ta — keyingisi qabul qilinmaydi
  for (let i = 0; i < 20; i++) store.addDirectPost({ chatId: 42, text: `yuk ${i}`, loads: [{ ...LOAD, phones: ["+998900000001"] }] });
  result = { ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: ["+998900000001"] }] };
  assert.match(await reply("Andijondan Toshkentga 20 tonna"), /24 soatda 20 ta yuk yubordingiz/);

  // Haydovchi oddiy matn yozsa — yuk deb o'qilmaydi
  const driver = shipperSetup(result);
  driver.store.saveDriver(42, { role: "haydovchi", profile: PROFILE });
  await driver.message(PRIVATE, "Andijondan Toshkentga 20 tonna");
  assert.deepEqual(driver.parsed, []);
  assert.equal(texts(driver.calls).at(-1), "Pastdagi tugmalardan birini bosing 👇");
});

test("«📦 Yuk berish»: tasdiqlashda formaga havola yo'q; ilova formasidan kelgan yuk (sendData) — tekshirilib navbatga", async () => {
  const { store, calls, webAppData, command, queued } = shipperSetup(null, { config: { miniappUrl: MINIAPP } });
  // Tasdiqlash xabarida «✏️ Formada tuzatish» yo'q (2026-11-27) — faqat ✅ / ❌
  const desk = shipperSetup({ ok: true, postType: "yuk_bor", loads: [{ ...LOAD, phones: ["+998900000001"] }] }, { config: { miniappUrl: MINIAPP } });
  await desk.message(PRIVATE, "Andijondan Toshkentga 20 tonna un. 90 000 00 01");
  assert.ok(!lastSent(desk.calls).reply_markup.inline_keyboard.flat().some((b) => b.web_app));

  // Formadan (server bilan aloqa yo'q edi) — noto'g'risi rad etiladi, to'g'risi navbatga
  await webAppData(JSON.stringify({ type: "load", load: { from: "andijon", to: "toshkent_sh", weight: "20", phones: [] } }));
  assert.match(texts(calls).at(-1), /Yuborilmadi: Telefon raqamini yozing/);
  await webAppData(JSON.stringify({ type: "load", load: { from: "andijon", to: "toshkent_sh", cargo: "un", weight: "20", phones: ["90 000 00 03"] } }));
  assert.match(texts(calls).at(-1), /Yukingiz qabul qilindi/);
  const [post] = store.shipperPosts(42);
  assert.equal(post.via, "web");
  assert.equal(post.direct[0].fromRegion, "andijon");
  assert.deepEqual(store.getDriver(42).loadPhones, ["+998900000003"]);
  assert.equal(queued.length, 1);
  // Haydovchi formani yubora olmaydi
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE });
  await webAppData(JSON.stringify({ type: "load", load: { from: "andijon", to: "toshkent_sh", weight: "20", phones: ["90 000 00 03"] } }));
  assert.match(texts(calls).at(-1), /faqat yuk beruvchilar uchun/);
  assert.equal(store.shipperPosts(42).length, 1);
});

test("/account_qosh: rolsiz — /start; ro'yxatdan o'tmagan haydovchi — avval ro'yxat; aks holda Mini App «akkaunt» tugmasi", async () => {
  const { store, calls, command } = setup({ appUrl: () => "https://yuk.example.uz/" });
  await command("/account_qosh");
  assert.equal(texts(calls).at(-1), "Iltimos, tanlang 👇");

  store.saveDriver(42, { role: "haydovchi", active: true, phoneAskedAt: 1 });
  calls.length = 0;
  await command("/account_qosh");
  assert.match(texts(calls).at(-1), /Avval ro'yxatdan o'ting/);

  store.saveDriver(42, { role: "yuk_beruvchi", active: true, phoneAskedAt: 1 });
  calls.length = 0;
  await command("/account_qosh");
  assert.match(texts(calls).at(-1), /Telegram akkauntingizni ulang/);
  const button = lastMarkup(calls).inline_keyboard[0][0];
  assert.equal(button.text, "📡 Telegram akkauntni ulash");
  const url = new URL(button.web_app.url);
  assert.deepEqual([url.origin, url.searchParams.get("v"), url.searchParams.get("r"), url.searchParams.has("t")], ["https://yuk.example.uz", "akkaunt", "yuk_beruvchi", false]);
});

test("bot tavsifi Telegram chegarasiga sig'adi va kanal/guruh havolasi bor", async () => {
  const { DESCRIPTION, SHORT_DESCRIPTION } = await import("../src/bot.js");
  assert.ok(DESCRIPTION.length <= 512, `tavsif ${DESCRIPTION.length} belgi`);
  assert.ok(SHORT_DESCRIPTION.length <= 120, `qisqa bio ${SHORT_DESCRIPTION.length} belgi`);
  assert.match(SHORT_DESCRIPTION, /🤖 AI yordamchi: @YukExperti$/);
  for (const text of [DESCRIPTION, SHORT_DESCRIPTION]) assert.match(text, /@Yuk_Ekspert\n💬 Guruh: @Yuk_Ekspert_chat/);
});

test("yuk beruvchi menyudagi «📱 Raqam ulashish» ni bossa — yuk emas, raqam afzalliklari chiqadi", async () => {
  const { store, calls, message } = setup();
  store.saveDriver(42, { role: "yuk_beruvchi" });
  await message(PRIVATE, MENU.phone);
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi\?<\/b>\n✅ Sizni doim taniymiz/);
  assert.deepEqual(lastMarkup(calls).keyboard.flat(), [{ text: PHONE.share, request_contact: true }, { text: PHONE.later }]);
});

// --- Yetkazish rejimi (feed.js, 2026-11-14): rol → rejim → (guruhlar) → saqlash; asl matnli xabar ---
const menuRows = (calls) => {
  const markup = calls.filter((c) => c.method === "sendMessage" && c.payload.reply_markup?.keyboard).at(-1).payload.reply_markup;
  return markup.keyboard.map((row) => row.map((b) => b.text));
};

test("rejim: yangi haydovchi darhol «🌐 Hamma guruhlar» (filtrsiz), menyuda «🎛 Rejim», «📋 Mos yuklar» yo'q", async () => {
  const { store, calls, message, press } = setup({ config: { miniappUrl: MINIAPP } });
  await press("r:haydovchi"); // 2026-11-19: darhol tezkor
  const { profile, active } = store.getDriver(42);
  assert.equal(active, true);
  assert.equal(profile.vehicle, null);
  assert.deepEqual(profile.feed, { mode: "tezkor", sources: [] });
  assert.ok(texts(calls).some((t) => /✅ <b>Tayyor!<\/b>[\s\S]*Mashina: <b>Hammasi<\/b>[\s\S]*Qayerdan: <b>Hamma joy<\/b>[\s\S]*Hamma guruhlar/.test(t)));
  assert.match(texts(calls).at(-1), /Telefon raqamingizni ulashasizmi/, "raqam bir marta so'raladi");
  await message(PRIVATE, PHONE.later);
  assert.deepEqual(menuRows(calls), [[MENU.feed, MENU.pause], [MENU.role, MENU.phone], [MENU.help, MENU.settings]]);
  assert.equal(store.activeUsers("haydovchi").length, 1, "mashinasiz ham faol");
  await message(PRIVATE, MENU.loads);
  assert.match(texts(calls).at(-1), /darhol shu yerga keladi \(🌐 Hamma guruhlar\)/);
  // «🎛 Filtr» (2026-11-27) — chatda oyna yo'q: pastki menyu tugmasi ilovaning «🎛 Filtr» bo'limini ochadi
  const feedButton = buttons(lastMarkup(calls)).find((b) => b.text === MENU.feed);
  assert.match(feedButton.web_app.url, /[?&]v=filtr(&|$)/);
  await message(PRIVATE, MENU.feed); // eski menyudan oddiy matn bo'lib kelsa — ilovani ochadigan inline tugma
  const reply = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(reply.payload.text, /Filtr ilovada/);
  assert.equal(inlineButtons(reply)[0].web_app.url, `${MINIAPP}?v=filtr&r=haydovchi`);
  assert.ok(!inlineButtons(reply).some((b) => b.callback_data), "chat-filtr tugmalari yo'q");
});

test("rejim: Mini App formasi rejimni yubormasa — eskisi qoladi; begona guruh tanlovdan tushadi", async () => {
  const { store, webAppData } = setup({ config: { miniappUrl: MINIAPP } });
  store.addSource("@TutGruz");
  const feed = { mode: "guruhlarim_plus", sources: ["@TutGruz"] };
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, feed }, active: true, phoneAskedAt: 1 });
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: FORM })); // eski forma — feed yo'q
  assert.deepEqual(store.getDriver(42).profile.feed, feed);
  await webAppData(JSON.stringify({ type: "profile", role: "haydovchi", profile: { ...FORM, feed: { mode: "guruhlarim", sources: ["@TutGruz", "@Begona_guruh"], trucks: ["fura"] } } }));
  assert.deepEqual(store.getDriver(42).profile.feed, { mode: "guruhlarim", sources: ["@TutGruz"], trucks: ["fura"] });
});

test("tezkor xabar (deliverRaw): asl matn, telefonlar, «📄 Asl e'lon» va e'lon bo'yicha «📞 Telefon qilish»", async () => {
  const links = [];
  const { store, calls, deliverRaw } = setup({
    appUrl: () => MINIAPP,
    postCallLink: (link) => (links.push(link), `tok${link.phone}`),
  });
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  const post = { id: 77, source: "@TutGruz", link: "https://t.me/TutGruz/5", text: "Toshkentdan Samarqandga <20 t> un bor\n90 000 00 01", postedAt: Date.now(), sender: "ali_logist" };
  assert.deepEqual(await deliverRaw(42, post, { phones: ["+998900000001"] }), { ok: true });
  const sent = calls.filter((c) => c.method === "sendMessage").at(-1).payload;
  assert.match(sent.text, /^Toshkentdan Samarqandga &lt;20 t&gt; un bor\n90 000 00 01\n\n📞 \+998900000001\n💬 <a href="https:\/\/t\.me\/ali_logist">Lichkasi<\/a>\n📢 E'lon qilingan 🕒 /);
  assert.doesNotMatch(sent.text, /@TutGruz/, "guruh nomi matnda yo'q");
  const kb = sent.reply_markup.inline_keyboard.flat();
  assert.equal(kb[0].url, "https://t.me/TutGruz/5");
  assert.equal(kb[1].web_app.url, `${MINIAPP}pub/call?c=tok0`);
  assert.deepEqual(links, [{ postId: 77, phone: 0, chatId: 42 }]);
});

test("eski chat-filtr tugmalari (fm:/fg:/fr:/ft:), /rejim, «⚡ Tezkorni o'chirish» — ilovaga yo'naltiradi, filtr o'zgarmaydi, uzilish yechiladi", async () => {
  const { store, calls, press, message, command, isBusy } = setup({ config: { miniappUrl: MINIAPP } });
  const feed = { mode: "guruhlarim", sources: ["@TutGruz"], regions: ["samarqand"] };
  store.saveDriver(42, { role: "haydovchi", phone: "+998901112233", active: true, profile: { vehicle: null, fromAreas: [], toAreas: [], feed } });
  store.setHold(42, "filtr"); // eski chat oynasi ochiq qolgan
  for (const send of [() => press("fm:done"), () => press("fg:t:@TutGruz"), () => press("fr:ok"), () => press("ft:open"), () => command("/rejim"), () => message(PRIVATE, MENU.fastOff), () => message(PRIVATE, MENU.groups)]) {
    calls.length = 0;
    await send();
    assert.match(texts(calls).at(-1), /Filtr ilovada/);
  }
  assert.equal(store.getDriver(42).hold, null);
  assert.equal(isBusy(42), false);
  assert.deepEqual(store.getDriver(42).profile.feed.sources, ["@TutGruz"], "filtr o'zgarmadi");
  assert.deepEqual(store.getDriver(42).profile.feed.regions, ["samarqand"]);
});

test("tezkor xabar: 3 s kutish paytida oyna (raqam so'rovi) ochilsa yoki pauza bosilsa — yuborilmaydi", async () => {
  const { store, calls, deliverRaw, message } = setup({});
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  const post = { id: 78, source: "@TutGruz", link: "https://t.me/TutGruz/6", text: "Toshkentdan Samarqandga 20 t un bor\n90 000 00 01", postedAt: Date.now() };
  assert.equal((await deliverRaw(42, post, { phones: [] })).ok, true);
  const sentCount = () => calls.filter((c) => c.method === "sendMessage" && /un bor/.test(c.payload.text)).length;
  const waiting = deliverRaw(42, { ...post, id: 79 }, { phones: [] }); // oraliq tufayli kutadi
  await message(PRIVATE, MENU.addGroup); // raqami yo'q — raqam so'rovi oynasi ochiladi
  assert.equal((await waiting).ok, false);
  store.saveDriver(42, { active: false }); // pauza ham
  await message(PRIVATE, "/start"); // band holatini bo'shatmaydi, lekin pauza baribir to'xtatadi
  assert.equal((await deliverRaw(42, { ...post, id: 80 }, { phones: [] })).ok, false);
  assert.equal(sentCount(), 1, "oyna ochilgandan keyin e'lon kelmadi");
});

test("charxpalak: e'lon yo'lda turganda «⏸ Pauza» — «To'xtatildi» oxirgi xabar, keyingi e'lonlar kelmaydi; boshqalarga ketaveradi", async () => {
  const arrived = []; // Telegram'ga YETIB BORGAN tartib
  const { store, deliverRaw, deliver, message } = setup({
    slow: async (method, payload) => {
      if (method !== "sendMessage") return;
      if (/un bor/.test(payload.text)) await new Promise((r) => setTimeout(r, 150)); // e'lon so'rovi sekin
      arrived.push(`${payload.chat_id}:${/un bor/.test(payload.text) ? "e'lon" : payload.text.split("\n")[0]}`);
    },
  });
  for (const id of [42, 43]) store.saveDriver(id, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  const post = { id: 90, source: "@TutGruz", link: "https://t.me/TutGruz/9", text: "Toshkentdan Samarqandga 20 t un bor\n90 000 00 01", postedAt: Date.now() };
  const flying = deliverRaw(42, post, { phones: [] }); // yo'lga chiqdi
  await new Promise((r) => setTimeout(r, 20));
  await message(PRIVATE, MENU.pause);
  assert.equal((await flying).ok, true);
  const mine = arrived.filter((a) => a.startsWith("42:"));
  assert.deepEqual(mine, ["42:e'lon", "42:⏸ To'xtatildi — botga yuk kelmaydi (ilovada alohida)."], "To'xtatildi — oxirgi");
  // uzildi: na tezkor, na yuk beruvchi yuki ketmaydi
  assert.equal((await deliverRaw(42, { ...post, id: 91 }, { phones: [] })).ok, false);
  assert.equal((await deliver(42, { fromRegion: "toshkent", phones: [] }, { ...post, id: 92 })).ok, false);
  // charxpalak aylanaveradi: boshqa haydovchiga ketadi
  assert.equal((await deliverRaw(43, { ...post, id: 93 }, { phones: [] })).ok, true);
  assert.equal(arrived.filter((a) => a.startsWith("42:")).length, 2);
});

test("har qanday amal (/start, ❓ Yordam, tugma) chatni 60 s uzadi; ▶️ darhol ulaydi; boshqa chat uzilmaydi", async () => {
  const { store, deliverRaw, message, command, press, isBusy } = setup({ actionHoldMs: 60_000 });
  for (const id of [42, 43]) store.saveDriver(id, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  const post = { id: 97, source: "@TutGruz", link: "https://t.me/TutGruz/9", text: "Toshkentdan Samarqandga 20 t un bor", postedAt: Date.now() };
  assert.equal(isBusy(42), false);
  await command("/start");
  assert.equal(isBusy(42), true);
  assert.equal((await deliverRaw(42, post, { phones: [] })).ok, false, "/start dan keyin uzildi");
  assert.equal((await deliverRaw(43, { ...post, id: 98 }, { phones: [] })).ok, true, "boshqa haydovchiga ketaveradi");
  await message(PRIVATE, MENU.help);
  assert.equal(isBusy(42), true);
  await message(PRIVATE, MENU.resume);
  assert.equal(isBusy(42), false, "▶️ — darhol ulanadi");
  await press("mr:back");
  assert.equal(isBusy(42), true, "tugma bosildi — yana uzildi");
});

test("ochiq amal: oyna ochilsa — tugatilmaguncha e'lon kelmaydi (3 daqiqadan keyin ham), bot qayta yoqilsa ham", async () => {
  const { store, deliverRaw, message, press, isBusy } = setup({});
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  const post = { id: 101, source: "@TutGruz", link: "https://t.me/TutGruz/9", text: "Toshkentdan Samarqandga 20 t un bor", postedAt: Date.now() };
  await message(PRIVATE, MENU.addGroup); // raqami yo'q — raqam so'rovi
  assert.equal(store.getDriver(42).hold.kind, "raqam", "bazaga yozildi");
  // 10 daqiqa o'tdi (oxirgi bosish eskirdi) — baribir uzilgan
  store.setHold(42, "filtr");
  assert.equal(isBusy(42), true);
  assert.equal((await deliverRaw(42, post, { phones: [] })).ok, false);
  // bot qayta yoqildi — yangi createBot, o'sha baza
  const again = setup({});
  again.store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  again.store.setHold(42, "filtr");
  assert.equal(again.isBusy(42), true, "yangi bot ham bazadan ko'radi");
  // ❓ Yordam bosildi — amal hali tugamagan
  await message(PRIVATE, MENU.help);
  assert.equal(isBusy(42), true);
  await press("fm:done"); // eski chat-filtr xabaridagi «✅ Tayyor» — ilovaga yo'naltiradi va uzilishni yechadi
  assert.equal(store.getDriver(42).hold, null);
  assert.equal(isBusy(42), false);
  assert.equal((await deliverRaw(42, { ...post, id: 102 }, { phones: [] })).ok, true);
});

test("ochiq amal: oyna Telegram'da ochilmasa (400) — chat uzilib qolmaydi, e'lonlar kelaveradi (2026-11-26, #303983)", async () => {
  // 26.11 19:00: oyna («📌 Guruh tanlash») Telegram'dan 400 qaytardi — odam oynani ko'rmadi, uzilish bazada 1,5 soat qoldi
  let broken = true;
  const { store, deliverRaw, message, isBusy } = setup({
    fail: (method, p) =>
      broken && method === "sendMessage" && { ok: false, error_code: 400, description: "Bad Request: inline keyboard button text must be encoded in UTF-8" },
  });
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  await assert.rejects(message(PRIVATE, MENU.addGroup), /UTF-8/); // raqam so'rovi oynasi
  assert.equal(store.getDriver(42).hold, null, "uzilish bazada qolmadi");
  assert.equal(isBusy(42), false);
  const post = { id: 103, source: "@yukkdehqonobod", link: "https://t.me/yukkdehqonobod/303983", text: "Qo'qondan Jizzaxga yuk bor 91 055 57 73", postedAt: Date.now() };
  broken = false;
  assert.equal((await deliverRaw(42, post, { phones: [] })).ok, true, "e'lon yetib boradi");
  // Oyna ochilsa — avvalgidek uziladi
  await message(PRIVATE, MENU.addGroup);
  assert.equal(store.getDriver(42).hold.kind, "raqam");
});

test("e'lon matnida buzuq belgi (yarim emoji) — Telegram rad etmasin: matn tozalanib yetib boradi", async () => {
  const { store, calls, deliverRaw } = setup({
    fail: (method, p) => method === "sendMessage" && !p.text.isWellFormed() && { ok: false, error_code: 400, description: "Bad Request: text must be encoded in UTF-8" },
  });
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  const post = { id: 104, source: "@TutGruz", link: "https://t.me/TutGruz/10", text: "Toshkentdan Samarqandga 20 t un bor \uD83D 90 123 45 67", postedAt: Date.now() };
  assert.equal((await deliverRaw(42, post, { phones: [] })).ok, true);
  const sent = calls.filter((c) => c.method === "sendMessage").at(-1).payload.text;
  assert.ok(sent.isWellFormed());
  assert.match(sent, /Samarqandga 20 t un bor/);
});

test("ochiq amal tashlab ketildi — 3 daqiqadan keyin BIR marta eslatma; «✅ Tugatish» — e'lonlar yana keladi", async () => {
  const { store, calls, press, message, isBusy, holdReminder } = setup({});
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  await message(PRIVATE, MENU.addGroup); // raqam so'rovi
  await holdReminder.run();
  const reminders = () => calls.filter((c) => c.method === "sendMessage" && /hali tugamadi/.test(c.payload.text));
  assert.equal(reminders().length, 0, "hali erta");
  store.db.exec("UPDATE drivers SET hold_at = 0 WHERE chat_id = 42"); // oxirgi bosish ancha oldin
  await holdReminder.run();
  await holdReminder.run();
  assert.equal(reminders().length, 1, "bir marta");
  assert.match(reminders()[0].payload.text, /📱 Raqam ulashish/);
  assert.equal(reminders()[0].payload.reply_markup.inline_keyboard[0][0].callback_data, "hold:end");
  assert.equal(isBusy(42), true, "eslatmadan keyin ham e'lon kelmaydi");
  await press("hold:end");
  assert.equal(isBusy(42), false);
});

test("ochiq amal: «➕ Guruh qo'shish» → raqam so'rovi — «Keyinroq» bilan tugaydi", async () => {
  const { store, message, isBusy } = setup({});
  store.saveDriver(42, { role: "haydovchi", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true, phoneAskedAt: 1 });
  await message(PRIVATE, MENU.addGroup); // raqami yo'q → raqam so'raladi
  assert.equal(store.getDriver(42).hold.kind, "raqam");
  await message(PRIVATE, PHONE.later);
  assert.equal(isBusy(42), false);
});

test("«💬 Lichkasi» tugmasi: username'i yo'q, bot taniydigan odamga — ID bo'yicha; begonaga va username bo'lsa — tugma yo'q", async () => {
  const { loadButtons } = await import("../src/bot.js");
  const urls = (kb) => (kb ? kb.inline_keyboard.flat().map((b) => b.url ?? b.web_app?.url) : []);
  assert.ok(urls(loadButtons({ phones: [] }, { link: "https://t.me/g/1", senderId: "5551234", senderKnown: true })).includes("tg://user?id=5551234"));
  assert.ok(!urls(loadButtons({ phones: [] }, { link: "https://t.me/g/1", senderId: "5551234" })).some((u) => u.startsWith("tg://")), "begona — Telegram rad etadi");
  assert.ok(!urls(loadButtons({ phones: [] }, { link: "https://t.me/g/1", senderId: "5551234", sender: "ali" })).some((u) => u.startsWith("tg://")));
  assert.ok(!urls(loadButtons({ phones: [] }, { senderId: "5551234" }, () => null, { lichka: false })).length, "zaxira to'plam — lichkasiz");
  const voice = loadButtons({ phones: [] }, { link: "https://t.me/g/1", media: "voice", senderId: "7", senderKnown: true });
  assert.deepEqual(voice.inline_keyboard.flat().map((b) => b.text), ["🎤 Tinglash", "💬 Lichkasi"]);
});

test("band holati (2026-11-19): «➕ Guruh qo'shish» ochiq turganda — band; havola yuborilsa — tugaydi", async () => {
  const { store, press, message, isBusy } = setup({ config: { miniappUrl: MINIAPP } });
  store.saveDriver(42, { role: "haydovchi", phone: "+998901112233", active: true, profile: { vehicle: null, fromAreas: [], toAreas: [], feed: { mode: "tezkor", sources: [] } } });
  assert.equal(isBusy(42), false);
  await message(PRIVATE, MENU.addGroup);
  assert.equal(isBusy(42), true, "havola kutilyapti");
  await message(PRIVATE, "@Yangi_guruh");
  assert.equal(isBusy(42), false, "havola yuborildi");
});

test("yopiq guruh ovozli yuki (2026-11-20): collector botga ko'rsatgan yozuvchiga «💬 Lichkasi» tugmasi; forward qilingan ovozga bot jim", async () => {
  const { store, calls, deliverRaw, send } = setup({ appUrl: () => MINIAPP });
  store.saveDriver(42, { role: "haydovchi", plan: "pro", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  const post = { id: 78, source: "-1001234567890", link: null, media: "voice", text: "Farg'onadan Toshkentga 2 tonna yuk bor", postedAt: Date.now(), senderId: "5551234" };
  const lastButtons = () => (calls.filter((c) => c.method === "sendMessage").at(-1).payload.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.url);
  await deliverRaw(42, post, { phones: [] });
  assert.ok(!lastButtons().includes("tg://user?id=5551234"), "bot ko'rmagan — tugma yo'q (Telegram rad etardi)");
  store.markSenderReachable("5551234");
  await deliverRaw(42, { ...post, id: 79 }, { phones: [] });
  assert.ok(lastButtons().includes("tg://user?id=5551234"));
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).payload.text, /«💬 Lichkasi» tugmasi orqali yozing/);
  const before = calls.length;
  await send({ message: { message_id: 900, date: 1_700_000_000, chat: PRIVATE, from: USER, voice: { file_id: "v", file_unique_id: "v", duration: 5 }, forward_origin: { type: "user", date: 1, sender_user: { id: 5551234, is_bot: false, first_name: "A" } } } });
  assert.equal(calls.slice(before).filter((c) => c.method === "sendMessage").length, 0, "forward qilingan ovozga javob yo'q");
});

test("ovozli xabar / dumaloq video (2026-11-20): asl fayl + ostida matn bitta xabarda; ikkinchisiga file_id; fayl yo'q — matn", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { mediaFileName } = await import("@yuk/store");
  const dir = mkdtempSync(join(tmpdir(), "yuk-media-"));
  writeFileSync(join(dir, mediaFileName("@yuk_guruh", 5, "voice")), "OGG");
  writeFileSync(join(dir, mediaFileName("-1001234567890", 6, "round")), "MP4");
  const { store, calls, deliverRaw } = setup({
    mediaDir: dir,
    answer: (method) =>
      method === "sendVoice" ? { message_id: 1, date: 0, chat: { id: 1 }, voice: { file_id: "VOICE_ID" } } : method === "sendVideo" ? { message_id: 2, date: 0, chat: { id: 1 }, video: { file_id: "VIDEO_ID" } } : undefined,
  });
  for (const id of [42, 43]) store.saveDriver(id, { role: "haydovchi", plan: "pro", profile: { ...PROFILE, vehicle: null, feed: { mode: "tezkor", sources: [] } }, active: true });
  const voice = { id: 90, source: "@yuk_guruh", messageId: 5, link: "https://t.me/yuk_guruh/5", media: "voice", text: "Farg'onadan Toshkentga 2 tonna yuk bor +998900000001", postedAt: Date.now(), sender: "ali_yuk" };
  assert.deepEqual(await deliverRaw(42, voice, { phones: ["+998900000001"] }), { ok: true });
  const first = calls.filter((c) => c.method === "sendVoice").at(-1).payload;
  assert.ok(first.caption.startsWith("Farg'onadan Toshkentga 2 tonna yuk bor"));
  assert.match(first.caption, /🎤 Ovozli xabardan/);
  assert.equal(first.parse_mode, "HTML");
  assert.ok(first.reply_markup.inline_keyboard.flat().some((b) => b.text === "🎤 Tinglash"));
  assert.equal(typeof first.voice, "object", "birinchisi — fayl yuklanadi");
  await deliverRaw(43, voice, { phones: ["+998900000001"] });
  assert.equal(calls.filter((c) => c.method === "sendVoice").at(-1).payload.voice, "VOICE_ID", "ikkinchisi — Telegram'dagi nusxa");
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0, "alohida matn xabari yo'q");
  // Dumaloq video — oddiy video, izohi bilan
  await deliverRaw(42, { ...voice, id: 91, source: "-1001234567890", messageId: 6, media: "round", link: null }, { phones: ["+998900000001"] });
  assert.match(calls.filter((c) => c.method === "sendVideo").at(-1).payload.caption, /📹/);
  // Fayl yo'q — avvalgidek matn
  await deliverRaw(42, { ...voice, id: 92, messageId: 7 }, { phones: ["+998900000001"] });
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).payload.text, /^Farg'onadan/);
  // Juda uzun matn — izoh 1024 belgidan oshmaydi
  writeFileSync(join(dir, mediaFileName("@yuk_guruh", 8, "voice")), "OGG");
  await deliverRaw(42, { ...voice, id: 93, messageId: 8, text: "Farg'onadan Toshkentga yuk bor ".repeat(80) }, { phones: [] });
  assert.ok(calls.filter((c) => c.method === "sendVoice").at(-1).payload.caption.length <= 1024);
});

test("e'lon olish boshlanganda (oyna tugadi / ▶️) — oxirgi 2 daqiqa uchun catchUp chaqiriladi", async () => {
  const { store, press, message, setCatchUp } = setup({ catchUpDelayMs: 0 });
  const calls = [];
  setCatchUp((chatId, since) => calls.push([chatId, Math.round((Date.now() - since) / 1000)]));
  store.saveDriver(42, { role: "haydovchi", phoneAskedAt: 1, active: true, profile: { vehicle: null, fromAreas: [], toAreas: [], feed: { mode: "tezkor", sources: [] } } });
  await message(PRIVATE, MENU.addGroup); // raqam so'rovi oynasi
  await message(PRIVATE, PHONE.later);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.at(-1), [42, 120]);
  await message(PRIVATE, MENU.pause);
  await message(PRIVATE, MENU.resume);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls.length >= 2, "▶️ dan keyin ham");
});

test("ilovaga kirish: a'zo bo'lmaguncha yo'q; a'zo bo'lgach /start app_<kod> → tasdiq so'raladi, «✅ Ha, bog'layman» kodni shu odamga bog'laydi", async () => {
  let member = false;
  const { store, calls, command, press } = setup({ config: { requiredChats: ["@Yuk_Ekspert"] }, answer: (m) => (m === "getChatMember" ? { status: member ? "member" : "left" } : undefined) });
  const code = "k".repeat(32);
  store.createAppLogin(code);
  await command(`/start app_${code}`);
  // a'zo emas — bog'lash so'ralmaydi, «a'zo bo'ling» chiqadi (Azimjon, 2026-11-26)
  const join = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(join.payload.text, /a'zo bo'ling/);
  assert.ok(!inlineButtons(join).some((b) => b.callback_data?.startsWith("al:")));
  await press(`al:ok:${code}`);
  assert.equal(store.appLoginState(code), "pending", "a'zo bo'lmaguncha tasdiqlab bo'lmaydi");
  // a'zo bo'ldi → «✅ A'zo bo'ldim» → endi so'raladi
  member = true;
  await press("sub:check");
  const ask = calls.filter((c) => c.method === "sendMessage").at(-1);
  assert.match(ask.payload.text, /ilovasiga bog'laysizmi[\s\S]*bog'lamang/);
  assert.deepEqual(inlineButtons(ask).map((b) => b.text), ["✅ Ha, bog'layman", "❌ Yo'q, bog'lamayman"]);
  assert.deepEqual(inlineButtons(ask).map((b) => b.callback_data), [`al:ok:${code}`, "al:no"]);

  await press(`al:ok:${code}`);
  assert.equal(store.appLoginState(code), "confirmed");
  assert.equal(store.consumeAppLogin(code), 42);
  assert.match(texts(calls, "editMessageText").at(-1), /Bog'landi/);
  // ikkinchi marta — eskirgan
  await press(`al:ok:${code}`);
  assert.match(texts(calls, "editMessageText").at(-1), /eskirgan/);
  await press("al:no");
  assert.match(texts(calls, "editMessageText").at(-1), /Bog'lanmadi/);
});

test("yuk beruvchidan bot o'zi raqam so'ramaydi, yordamda raqam qatori yo'q (2026-11-27); haydovchidan — so'raydi", async () => {
  const { store, calls, command, message } = setup();
  store.saveDriver(42, { role: "yuk_beruvchi", profile: { fromAreas: ["toshkent"], truckClasses: [] }, active: true });
  await command("/start");
  assert.ok(!texts(calls).some((t) => /ulashasizmi/.test(t)), "yuk beruvchi — so'ralmaydi");
  await message(PRIVATE, MENU.help);
  assert.ok(!texts(calls).at(-1).includes(MENU.phone));
  store.saveDriver(42, { role: "haydovchi", profile: PROFILE, active: true });
  calls.length = 0;
  await command("/start");
  assert.ok(texts(calls).some((t) => /ulashasizmi/.test(t)), "haydovchi — bir marta so'raladi");
});
