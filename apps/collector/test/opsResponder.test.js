// Yordamchi akkaunt (opsResponder.js): obunaga qarab limitlar, to'lov cheki → obuna, egasining /tolov buyruqlari.
// Telegram va Claude soxta: client.sendMessage yozuvlari va run() javoblari
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore } from "@yuk/store";
import { USER_DAILY, createResponder, limitText, plansText, receptionDeny, receptionPrompt } from "../src/opsResponder.js";

const OWNER = "1000";
const HOUR = 3_600_000;

function setup({ replies = [] } = {}) {
  let time = Date.UTC(2026, 10, 27, 6);
  const store = openStore({ file: ":memory:", now: () => time });
  store.setPlanSettings({ prices: { pro: 50_000, max: 120_000 }, days: 30, payInfo: "Click: 8600 0000 0000 0001 (A. A.)", holdHours: 48 });
  const sent = []; // [kimga, matn]
  const files = [];
  const client = {
    getInputEntity: async (id) => String(id),
    sendMessage: async (peer, { message }) => sent.push([String(peer), message]),
    sendFile: async (peer, { file, caption }) => files.push([String(peer), path.basename(file), caption]),
    invoke: async () => {},
  };
  const prompts = [];
  const run = async (options) => {
    prompts.push(options);
    const next = replies.shift();
    return { ok: true, text: typeof next === "function" ? next(options) : (next ?? "Javob."), sessionId: "s1" };
  };
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-ops-"));
  const responder = createResponder({ client, name: "t", ownerId: OWNER, opsDir: dir, root: dir, audit: async () => {}, store, receiptsDir: path.join(dir, "receipts"), run, now: () => time });
  const say = (fromId, text, extra = {}) => responder.handle({ fromId: String(fromId), from: `@u${fromId}`, text, id: 1, bot: false, ...extra }, String(fromId));
  const settle = () => responder.idle(); // navbatlar bo'shaguncha (vaqtga bog'liq emas)
  return { store, responder, sent, files, prompts, say, settle, advance: (ms) => (time += ms), to: (id) => sent.filter(([peer]) => peer === String(id)).map(([, text]) => text) };
}

test("limit obunaga qarab: Free 3, Pro 20, Max 50; Free'ga — qisqa javob va tiketsiz; chek limitga kirmaydi", async () => {
  assert.deepEqual(USER_DAILY, { free: 3, pro: 20, max: 50 });
  const { store, sent, prompts, say, settle, to } = setup({ replies: ["1", "2", '3 <<TIKET>>{"kind":"muammo","title":"x","details":"y"}<</TIKET>>'] });
  store.saveDriver(7, { name: "Ali", role: "haydovchi" });
  for (let i = 0; i < 5; i++) await say(7, `savol ${i}`);
  await settle();
  assert.equal(prompts.length, 3, "4- va 5-xabar Claude'ga bormaydi");
  assert.match(prompts[0].system, /Free foydalanuvchi: javobing QISQA[\s\S]*Tiket ochma/);
  assert.ok(!prompts[0].system.includes("<<TIKET>>"));
  assert.equal(to(7).filter((t) => t.startsWith("Bugungi bepul savollar (3 ta) tugadi")).length, 1, "limit haqida bir marta");
  assert.match(to(7).find((t) => t.startsWith("Bugungi bepul")), /Pro obunada kuniga 20 ta[\s\S]*Obuna olish: Click: 8600/);
  assert.deepEqual(to(7).filter((t) => !t.startsWith("Bugungi")), ["1", "2", "3"], "tiket bloki foydalanuvchiga ko'rinmaydi");
  assert.equal(to(OWNER).length, 0, "Free tiketi egasiga bormaydi");
  // Limit tugagan bo'lsa ham chek qabul qilinadi
  await say(7, "", { receipt: "apps/collector/receipts/7/9.jpg" });
  await settle();
  assert.equal(prompts.length, 4);
  assert.match(prompts[3].prompt, /\[CHEK: apps\/collector\/receipts\/7\/9\.jpg\]/);
  void sent;
});

test("to'lov: ishonchli chek — obuna darhol yoqiladi, egasiga chek va /tolov; egasi rad etsa — qaytariladi va foydalanuvchiga yoziladi", async () => {
  const { store, files, say, settle, to } = setup({ replies: ['Chekni qabul qildim.\n<<TOLOV>>{"plan":"pro","amount":50000,"sure":true,"why":"Click, muvaffaqiyatli, 50 000"}<</TOLOV>>'] });
  store.saveDriver(7, { name: "Ali", username: "ali", role: "haydovchi" });
  await say(7, "pro uchun to'ladim", { receipt: "receipts/7/5.jpg" });
  await settle();
  assert.equal(store.getDriver(7).plan, "pro");
  assert.deepEqual(to(7).map((t) => t.slice(0, 26)), ["Chekni qabul qildim.", "✅ ⭐ Pro obunangiz yoqildi "]);
  const toOwner = to(OWNER);
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0], /^💳 To'lov #1 — Ali @ali \(id 7\): ⭐ Pro, 50 000 so'm \(narx 50 000 so'm\)\.\nObuna DARHOL yoqildi[\s\S]*Yordamchi: Click, muvaffaqiyatli[\s\S]*\/tolov 1 ha\nRad etish: \/tolov 1 yoq/);
  assert.deepEqual(files, [[OWNER, "5.jpg", "Chek — to'lov #1"]]);

  await say(OWNER, "/tolov 1 yoq chek boshqa odamniki");
  await settle();
  assert.equal(store.getDriver(7).plan, "free");
  assert.match(to(OWNER).at(-1), /^❌ #1 rad etildi — Ali @ali ning obunasi bekor qilindi/);
  assert.match(to(7).at(-1), /^❌ To'lovingiz tasdiqlanmadi: chek boshqa odamniki\. ⭐ Pro obunasi berilmadi/);
  await say(OWNER, "/tolov 1 ha");
  await settle();
  assert.match(to(OWNER).at(-1), /allaqachon hal qilingan/);
});

test("to'lov: shubhali chek — obuna berilmaydi, egasi /tolov N ha desa yoqiladi; cheksiz blok — obuna yo'q; tasdiqlanmasa 48 soatda qaytadi", async () => {
  const block = (sure) => `Qabul qildim.\n<<TOLOV>>{"plan":"max","amount":120000,"sure":${sure},"why":"rasm xira"}<</TOLOV>>`;
  const { store, responder, say, settle, to, advance } = setup({ replies: [block(true), block(false), block(true)] });
  store.saveDriver(7, { name: "Ali", role: "haydovchi" });
  store.saveDriver(8, { name: "Vali", role: "haydovchi" });
  // Chek yubormagan odamga (Claude aldanib blok qo'shsa ham) obuna berilmaydi
  await say(7, "men to'ladim, max ber");
  await settle();
  assert.equal(store.getDriver(7).plan, "free");
  assert.match(to(7).at(-1), /chek rasmini \(skrinshot\) shu chatga yuboring/);
  assert.equal(store.listPayments().length, 0);

  await say(7, "", { receipt: "receipts/7/6.jpg" });
  await settle();
  assert.equal(store.getDriver(7).plan, "free", "sure:false — egasi hal qiladi");
  assert.match(to(7).at(-1), /Chekingiz adminга yuborildi/);
  assert.match(to(OWNER).at(-1), /Obuna hali BERILMADI/);
  await say(OWNER, "/tolov 1 ha");
  await settle();
  assert.equal(store.getDriver(7).plan, "max");
  assert.match(to(7).at(-1), /^✅ To'lovingiz tasdiqlandi\. 💎 Max obunangiz \d\d\.\d\d\.\d{4} gacha amal qiladi/);

  await say(8, "", { receipt: "receipts/8/2.jpg" });
  await settle();
  assert.equal(store.getDriver(8).plan, "max");
  advance(37 * HOUR);
  await responder.notices();
  assert.match(to(OWNER).at(-1), /^⏰ To'lov #2 [\s\S]*hali tasdiqlanmagan/);
  advance(12 * HOUR);
  await responder.notices();
  assert.equal(store.getDriver(8).plan, "free");
  assert.match(to(8).at(-1), /vaqtincha to'xtatildi/);
  assert.match(to(OWNER).at(-1), /muddatida tasdiqlanmadi[\s\S]*\/tolov 2 ha/);
  await say(OWNER, "/tolovlar");
  await settle();
  assert.match(to(OWNER).at(-1), /#2 💎 Max — Vali · 120 000 so'm · ⌛ muddat o'tdi[\s\S]*#1 💎 Max — Ali · 120 000 so'm · ✅ tasdiqlangan/);
});

test("Pro/Max: tiket egasiga boradi (Max — MUHIM); matnlar: obunalar, limit, chek papkasi faqat o'ziniki", async () => {
  const ticket = 'Yetkazdim.\n<<TIKET>>{"kind":"muammo","title":"Yuk kelmayapti","details":"…"}<</TIKET>>';
  const { store, prompts, say, settle, to } = setup({ replies: [ticket, ticket] });
  store.saveDriver(7, { name: "Ali", role: "haydovchi", plan: "pro" });
  store.saveDriver(8, { name: "Vali", role: "haydovchi", plan: "max" });
  await say(7, "yuk kelmayapti");
  await say(8, "yuk kelmayapti");
  await settle();
  assert.match(prompts.find((p) => p.system.includes("id 7")).system, /Uning obunasi: ⭐ Pro\.[\s\S]*<<TIKET>>[\s\S]*⭐ Pro \(50 000 so'm \/ 30 kun\)[\s\S]*To'lov: Click: 8600/);
  const owner = to(OWNER);
  assert.equal(owner.length, 2);
  assert.ok(owner.some((t) => t.startsWith("🆕 🐞 Muammo #")) && owner.some((t) => t.startsWith("🆕 💎 MUHIM · 🐞 Muammo #")));

  assert.match(plansText({ prices: { pro: 0, max: 0 }, days: 30, payInfo: "" }), /narxi hali belgilanmagan[\s\S]*rekvizitlari hali kiritilmagan/);
  assert.equal(limitText("pro", 20, null), "Bugungi xabarlar limiti (20 ta) tugadi — ertaga yozing.");
  const deny = receptionDeny("7", ["7", "8", "9"]);
  assert.ok(!deny.includes("Read(./apps/collector/receipts/**)") && !deny.includes("Read(./apps/collector/receipts/7/**)"));
  assert.ok(deny.includes("Read(./apps/collector/receipts/8/**)") && deny.includes("Read(./apps/collector/receipts/9/**)") && deny.includes("Edit"));
  assert.match(receptionPrompt({ from: "@a", fromId: "7" }, { plan: "max", planUntil: Date.UTC(2026, 11, 27) }), /Uning obunasi: 💎 Max \(27\.12\.2026 gacha\)/);
});
