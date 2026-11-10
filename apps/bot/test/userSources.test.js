// «➕ Guruh qo'shish»: havolani tushunish, sinov qoidasi va natijani yozish (userSources.js). Telegram'ga ulanmaydi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { openStore } from "@yuk/store";
import { SOURCE_RULES, createSourceWatcher, existingText, parseSourceLink, resultText, reviewTrial } from "../src/userSources.js";

const HOUR = 3_600_000;

test("havola: t.me, https, /s/, xabar havolasi, @nomi — guruh nomi; yopiq taklif, bot, noto'g'ri — xato; oddiy matn — havola emas", () => {
  for (const text of ["https://t.me/Yuk_Guruh", "t.me/Yuk_Guruh", "  http://www.t.me/Yuk_Guruh/123 ", "https://t.me/s/Yuk_Guruh", "telegram.me/Yuk_Guruh?x=1", "@Yuk_Guruh"]) {
    assert.deepEqual(parseSourceLink(text), { username: "Yuk_Guruh" }, text);
  }
  assert.deepEqual(parseSourceLink("https://t.me/+AbCdEf123"), { error: "private" });
  assert.deepEqual(parseSourceLink("t.me/joinchat/AbCdEf"), { error: "private" });
  assert.deepEqual(parseSourceLink("https://t.me/c/123456/78"), { error: "private" });
  assert.deepEqual(parseSourceLink("@Yuk_Ekspert_agent_bot"), { error: "bot" });
  assert.deepEqual(parseSourceLink("t.me/ab"), { error: "invalid" });
  assert.equal(parseSourceLink("Toshkentdan Samarqandga yuk bor"), null);
  assert.equal(parseSourceLink("guruh: https://t.me/Yuk_Guruh"), null, "faqat havolaning o'zi");
  assert.equal(parseSourceLink("@ab"), null);
});

test("sinov: 5 ta yuk e'lonida darhol o'tadi; yuki juda kam bo'lsa oldinroq to'xtaydi; muddatda — navbatdagilarni kutadi", () => {
  const until = 100 * HOUR;
  const stats = (extra) => ({ posts: 0, loads: 0, processed: 0, waiting: 0, repeats: 0, ...extra });
  assert.deepEqual(reviewTrial(stats({ loads: 5, processed: 5 }), { until, now: until - 20 * HOUR }), { done: true, ok: true, note: "Sinov paytida 5 ta yuk e'loni chiqdi" });
  assert.deepEqual(reviewTrial(stats({ loads: 2, processed: 10 }), { until, now: until - HOUR }), { done: false });
  const early = reviewTrial(stats({ loads: 3, processed: 40 }), { until, now: until - 20 * HOUR });
  assert.deepEqual(early, { done: true, ok: false, note: "40 ta xabaridan atigi 3 tasi yuk e'loni — sinov muddatidan oldin to'xtatildi" });
  assert.equal(reviewTrial(stats({ loads: 4, processed: 40 }), { until, now: until - HOUR }).done, false, "10% — yetarli");
  assert.deepEqual(reviewTrial(stats({ loads: 2, waiting: 3 }), { until, now: until + 10 * 60_000 }), { done: false }, "navbatdagilari tahlil qilinsin");
  assert.deepEqual(reviewTrial(stats({ loads: 2, repeats: 4, waiting: 3 }), { until, now: until + HOUR }), {
    done: true,
    ok: false,
    note: "24 soatda atigi 2 ta yuk e'loni chiqdi (kamida 5 ta kerak); yana 4 tasi boshqa guruhlarimizda allaqachon bor edi — ular sizga baribir keladi",
  });
  assert.equal(reviewTrial(stats(), { until, now: until }).note, "24 soatda birorta ham yuk e'loni chiqmadi (kamida 5 ta kerak)");
  // Aloqasiz e'lonlar (telefon ham, lichka ham yo'q) yuk deb sanalmaydi — izohda sababi aytiladi
  assert.equal(
    reviewTrial(stats({ loads: 1, noContact: 30 }), { until, now: until }).note,
    "24 soatda atigi 1 ta yuk e'loni chiqdi (kamida 5 ta kerak); 30 ta e'lonida telefon raqami ham, lichkasi ham yo'q edi — bunday e'lonlar hech kimga yuborilmaydi",
  );
  assert.match(reviewTrial(stats({ loads: 1, processed: 40, noContact: 35 }), { until, now: 0 }).note, /to'xtatildi; 35 ta e'lonida telefon raqami ham/);
});

test("natija matnlari va qayta yuborish: rad etilgani bir haftadan keyin", () => {
  const base = { name: "@Yuk_Guruh", title: "Yuk guruhi", enabled: false, checkAt: 10 * HOUR, checkUntil: null };
  const probeFailed = { ...base, checkState: "failed", checkNote: "Oxirgi 50 ta xabaridan faqat 1 tasi yuk e'loniga o'xshaydi", checkStats: { probe: {} } };
  assert.equal(
    resultText(probeFailed),
    "❌ <b>Yuk guruhi</b> (@Yuk_Guruh) qo'shilmadi: oxirgi 50 ta xabaridan faqat 1 tasi yuk e'loniga o'xshaydi.\nFaqat yuk e'lonlari chiqadigan ochiq guruh yoki kanal qo'shiladi.",
  );
  const trialFailed = { ...probeFailed, checkNote: "24 soatda atigi 2 ta yuk e'loni chiqdi (kamida 5 ta kerak)", checkStats: { probe: {}, trial: { loads: 2 } } };
  assert.equal(resultText(trialFailed), "⏸ <b>Yuk guruhi</b> (@Yuk_Guruh) o'chirildi: 24 soatda atigi 2 ta yuk e'loni chiqdi (kamida 5 ta kerak).");
  assert.match(
    existingText({ ...probeFailed, chatType: "group" }, { now: 10 * HOUR + 24 * HOUR }),
    /^ℹ️ Bu guruh avval ham yuborilgan: <b>Yuk guruhi<\/b> \(@Yuk_Guruh\)\.\n❌ Yaqinda tekshirildi va qo'shilmadi: Oxirgi 50[\s\S]*dan keyin qayta yuborishingiz mumkin\.$/,
  );
  assert.equal(existingText(probeFailed, { now: 10 * HOUR + SOURCE_RULES.retryAfterMs }), null, "bir hafta o'tdi — qayta tekshiriladi");
});

test("avvaldan mavjud: «Bu guruh/kanal bizda avvaldan mavjud» + holati; o'zi yuborganiga — «siz allaqachon yuborgansiz»", () => {
  const admin = { name: "@TutGruz", title: null, enabled: true, checkState: null, addedBy: null };
  assert.equal(
    existingText(admin, { now: 0 }),
    "ℹ️ Bu guruh/kanal bizda avvaldan mavjud: <b>@TutGruz</b>.\n✅ Undagi mos e'lonlar sizga ham keladi — qayta qo'shish shart emas.",
    "turi bilinmasa — ikkalasi",
  );
  assert.equal(
    existingText({ ...admin, title: "Yuk kanali", chatType: "channel" }, { now: 0, chatId: 42 }),
    "ℹ️ Bu kanal bizda avvaldan mavjud: <b>Yuk kanali</b> (@TutGruz).\n✅ Undagi mos e'lonlar sizga ham keladi — qayta qo'shish shart emas.",
  );
  assert.match(existingText({ ...admin, chatType: "group", enabled: false }, { now: 0 }), /^ℹ️ Bu guruh bizda avvaldan mavjud: .*\n⏸ Hozir kuzatuvdan o'chirib qo'yilgan\.$/);

  const probe = { name: "@yangi", title: "Yangi", chatType: "group", enabled: false, checkState: "probe", addedBy: 7 };
  assert.equal(existingText(probe, { now: 0, chatId: 8 }), "ℹ️ Bu guruh bizda avvaldan mavjud: <b>Yangi</b> (@yangi).\n🔎 Hozir tekshirilyapti.");
  assert.equal(
    existingText(probe, { now: 0, chatId: 7 }),
    "ℹ️ Bu guruhni siz allaqachon yuborgansiz: <b>Yangi</b> (@yangi).\n🔎 Hozir tekshirilyapti — natijasini 1–2 daqiqada shu yerga yozamiz.",
  );
  const trial = { ...probe, enabled: true, checkState: "trial", checkUntil: Date.UTC(2026, 10, 11, 9, 30) };
  assert.equal(
    existingText(trial, { now: 0, chatId: 8, trial: { loads: 2 } }),
    "ℹ️ Bu guruh bizda avvaldan mavjud: <b>Yangi</b> (@yangi).\n🧪 Hozir sinovda: 2/5 yuk e'loni, 11.11 14:30 gacha. Shu paytgacha undagi mos e'lonlar sizga ham keladi.",
  );
});

test("kuzatuvchi: Telegram rad etsa (bloklagan) — qayta urinmaydi; aloqa yo'q — keyingi safar", async () => {
  const store = openStore({ file: ":memory:" });
  store.addUserSource({ name: "@a_guruh", chatId: 1 });
  store.finishProbe("@a_guruh", { ok: false, note: "Guruhda birorta ham xabar topilmadi" });
  let mode = "network";
  const sent = [];
  const send = async (chatId, text) => {
    if (mode === "network") throw new Error("fetch failed");
    if (mode === "blocked") throw new GrammyError("Forbidden", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {});
    sent.push([chatId, text]);
  };
  const watcher = createSourceWatcher({ store, send, log: () => {} });
  await watcher.runOnce();
  assert.equal(store.sourceNotices().length, 1, "aloqa yo'q — keyin yana uriniladi");
  mode = "blocked";
  await watcher.runOnce();
  assert.equal(store.sourceNotices().length, 0, "bloklagan — boshqa urinilmaydi");
  assert.deepEqual(sent, []);
});
