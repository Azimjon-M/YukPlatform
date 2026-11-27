import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function setup() {
  let time = 1_800_000_000_000;
  const store = openStore({ file: ":memory:", now: () => time });
  store.saveDriver(7, { name: "Ali", role: "haydovchi" });
  store.setPlanSettings({ prices: { pro: 50_000, max: 120_000 }, days: 30, payInfo: "Click: 8600 …", holdHours: 48 });
  return { store, advance: (ms) => (time += ms), now: () => time };
}

test("to'lov: ishonchli chek — obuna DARHOL yoqiladi (held); egasi tasdiqlasa qoladi, muddati tugagach Free", () => {
  const { store, advance, now } = setup();
  const { ok, payment } = store.claimPayment({ chatId: 7, plan: "pro", amount: 50_000, receipt: "r/7/1.jpg", sure: true });
  assert.equal(ok, true);
  assert.deepEqual([payment.status, payment.price, payment.holdUntil], ["held", 50_000, now() + 48 * HOUR]);
  assert.deepEqual([store.getDriver(7).plan, store.getDriver(7).planUntil], ["pro", now() + 30 * DAY]);
  assert.deepEqual(store.paymentNotices().map((p) => [p.id, p.status]), [[payment.id, "held"]]);
  store.markPaymentNotified(payment.id, "held");
  assert.deepEqual(store.paymentNotices(), []);
  // Ikkinchi chek — ochiq so'rov bor
  assert.deepEqual([store.claimPayment({ chatId: 7, plan: "max", amount: 120_000, sure: true }).error], ["open"]);

  advance(10 * HOUR);
  assert.equal(store.decidePayment(payment.id, true).status, "confirmed");
  assert.equal(store.decidePayment(payment.id, false), null, "hal qilingan — qayta o'zgarmaydi");
  advance(3 * DAY);
  assert.deepEqual(store.lapsePayments(), [], "tasdiqlangan — bekor bo'lmaydi");
  assert.equal(store.getDriver(7).plan, "pro");
  advance(28 * DAY);
  assert.deepEqual([store.getDriver(7).plan, store.getDriver(7).planUntil], ["free", null], "30 kun o'tdi — Free");
  assert.equal(store.listDrivers().find((d) => d.chatId === 7).plan, "free");
});

test("to'lov: egasi rad etsa yoki 48 soatda tasdiqlamasa — avvalgi obuna qaytadi; keyingi cheki darhol yoqilmaydi", () => {
  const { store, advance } = setup();
  store.saveDriver(7, { plan: "pro" }); // qo'lda berilgan, muddatsiz Pro
  const a = store.claimPayment({ chatId: 7, plan: "max", amount: 120_000, sure: true }).payment;
  assert.equal(store.getDriver(7).plan, "max");
  assert.equal(store.decidePayment(a.id, false, "chek soxta").status, "rejected");
  assert.deepEqual([store.getDriver(7).plan, store.getDriver(7).planUntil], ["pro", null], "avvalgi muddatsiz Pro qaytdi");

  const b = store.claimPayment({ chatId: 7, plan: "max", amount: 120_000, sure: true }).payment;
  assert.equal(b.status, "asked", "yaqinda rad etilgan — egasi hal qiladi");
  assert.equal(store.getDriver(7).plan, "pro");
  assert.equal(store.decidePayment(b.id, true).status, "confirmed");
  assert.equal(store.getDriver(7).plan, "max", "tasdiqlandi — shu paytda yoqildi");

  store.saveDriver(8, { name: "Vali", role: "haydovchi" });
  const c = store.claimPayment({ chatId: 8, plan: "pro", amount: 50_000, sure: true }).payment;
  advance(49 * HOUR);
  assert.deepEqual(store.lapsePayments().map((p) => [p.id, p.status]), [[c.id, "lapsed"]]);
  assert.equal(store.getDriver(8).plan, "free");
  assert.equal(store.decidePayment(c.id, true).status, "confirmed", "kech bo'lsa ham tasdiqlasa — yoqiladi");
  assert.equal(store.getDriver(8).plan, "pro");
});

test("to'lov: tekshirib bo'lmagan / summa kam / narx belgilanmagan — darhol yoqilmaydi; uzaytirish muddat ustiga qo'shiladi; sozlamalar", () => {
  const { store, advance, now } = setup();
  assert.equal(store.claimPayment({ chatId: 7, plan: "pro", amount: 50_000, sure: false }).payment.status, "asked");
  store.decidePayment(1, true);
  const until = store.getDriver(7).planUntil;
  assert.equal(until, now() + 30 * DAY);
  advance(5 * DAY);
  const more = store.claimPayment({ chatId: 7, plan: "pro", amount: 50_000, sure: true }).payment;
  assert.equal(more.status, "held");
  assert.equal(store.getDriver(7).planUntil, until + 30 * DAY, "tugamagan muddat ustiga");
  store.decidePayment(more.id, true);

  store.saveDriver(8, { name: "Vali" });
  assert.equal(store.claimPayment({ chatId: 8, plan: "pro", amount: 40_000, sure: true }).payment.status, "asked", "summa kam");
  assert.equal(store.claimPayment({ chatId: 9, plan: "pro", amount: 50_000, sure: true }).error, "no_user");
  assert.equal(store.claimPayment({ chatId: 7, plan: "vip", amount: 1, sure: true }).error, "plan");
  assert.deepEqual(store.listPayments({ status: "open" }).map((p) => p.chatId), [8]);

  assert.deepEqual(store.setPlanSettings({ prices: { pro: "70000" }, days: 0, holdHours: 24 }), { prices: { pro: 70_000, max: 120_000 }, days: 30, payInfo: "Click: 8600 …", holdHours: 24, autoGrant: true });
  const fresh = openStore({ file: ":memory:" });
  assert.deepEqual(fresh.planSettings(), { prices: { pro: 0, max: 0 }, days: 30, payInfo: "", holdHours: 48, autoGrant: true });
  fresh.saveDriver(1, { name: "X" });
  assert.equal(fresh.claimPayment({ chatId: 1, plan: "pro", amount: 999_999, sure: true }).payment.status, "asked", "narx belgilanmagan — egasi hal qiladi");
});

test("to'lov: bitta tranzaksiya raqami ikkinchi marta — darhol yoqilmaydi (dupOf); rad etilgan chek raqami qayta ishlatilsa — bo'ladi", () => {
  const { store } = setup();
  store.saveDriver(8, { name: "Vali", role: "haydovchi" });
  const a = store.claimPayment({ chatId: 7, plan: "pro", amount: 50_000, sure: true, txn: "4471 120093", paidAt: "27.11.2026 15:20" }).payment;
  assert.deepEqual([a.status, a.txn, a.paidAt, a.dupOf], ["held", "4471120093", "27.11.2026 15:20", null]);
  const b = store.claimPayment({ chatId: 8, plan: "pro", amount: 50_000, sure: true, txn: "4471120093" }).payment;
  assert.deepEqual([b.status, b.dupOf], ["asked", a.id], "o'sha chek boshqa odamda");
  assert.equal(store.getDriver(8).plan, "free");
  store.decidePayment(a.id, false);
  store.decidePayment(b.id, false);
  store.saveDriver(9, { name: "Yangi", role: "haydovchi" });
  assert.equal(store.claimPayment({ chatId: 9, plan: "pro", amount: 50_000, sure: true, txn: "4471120093" }).payment.dupOf, null, "rad etilganlar hisobga kirmaydi");
});

test("to'lov: «darhol yoqish» o'chirilgan (autoGrant: false) — eng ishonchli chek ham faqat egasi tasdiqlagach yoqiladi", () => {
  const { store } = setup();
  store.setPlanSettings({ autoGrant: false });
  const p = store.claimPayment({ chatId: 7, plan: "pro", amount: 50_000, sure: true }).payment;
  assert.equal(p.status, "asked");
  assert.equal(store.getDriver(7).plan, "free");
  store.decidePayment(p.id, true);
  assert.equal(store.getDriver(7).plan, "pro");
});
