import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_PAUSE_MS, IDLE_WARN_MS, idleState } from "../src/index.js";

const HOUR = 60 * 60 * 1000;
const SINCE = 1_000 * HOUR; // kuzatuv boshlangan vaqt
const user = (fields = {}) => ({ active: true, profile: { vehicle: {} }, deletedAt: null, seenAt: null, createdAt: 1, idleWarnedAt: null, ...fields });

test("avtomatik pauza: 24 soatda ogohlantirish, 48 soatda pauza; soat oxirgi kirgan vaqtdan", () => {
  assert.equal(IDLE_WARN_MS, 24 * HOUR);
  assert.equal(IDLE_PAUSE_MS, 48 * HOUR);
  const seen = SINCE + 5 * HOUR;
  assert.equal(idleState(user({ seenAt: seen }), seen + 23 * HOUR, SINCE).action, null);
  const due = idleState(user({ seenAt: seen }), seen + 24 * HOUR, SINCE);
  assert.deepEqual(due, { lastSeen: seen, warned: false, warnAt: seen + 24 * HOUR, pauseAt: seen + 48 * HOUR, action: "warn" });
  // Ogohlantirilgan: 48 soatgacha — hech narsa, keyin — pauza
  const warned = user({ seenAt: seen, idleWarnedAt: seen + 24 * HOUR });
  assert.equal(idleState(warned, seen + 47 * HOUR, SINCE).action, null);
  assert.equal(idleState(warned, seen + 48 * HOUR, SINCE).action, "pause");
});

test("ogohlantirishdan keyin kirsa — yangi davr; ogohlantirishsiz pauza yo'q", () => {
  const seen = SINCE + HOUR;
  // Ogohlantirishdan keyin kirdi: eski ogohlantirish hisob emas — 24 soatdan keyin yana ogohlantirish
  const back = user({ seenAt: seen + 30 * HOUR, idleWarnedAt: seen + 24 * HOUR });
  assert.equal(idleState(back, seen + 50 * HOUR, SINCE).action, null);
  assert.equal(idleState(back, seen + 54 * HOUR, SINCE).action, "warn");
  // Bot uzoq to'xtab qolgan: 60 soat kirmagan, lekin ogohlantirilmagan — avval ogohlantirish
  assert.equal(idleState(user({ seenAt: seen }), seen + 60 * HOUR, SINCE).action, "warn");
  // Kech ogohlantirilgan (60-soatda) — pauza ogohlantirishdan kamida 24 soat keyin
  const late = user({ seenAt: seen, idleWarnedAt: seen + 60 * HOUR });
  assert.equal(idleState(late, seen + 70 * HOUR, SINCE).action, null);
  assert.equal(idleState(late, seen + 84 * HOUR, SINCE).pauseAt, seen + 84 * HOUR);
  assert.equal(idleState(late, seen + 84 * HOUR, SINCE).action, "pause");
});

test("eski foydalanuvchilar (seen_at yo'q) — soat kuzatuv boshlangan paytdan; pauzadagi va profilsizga — hech narsa", () => {
  assert.equal(idleState(user(), SINCE + 23 * HOUR, SINCE).action, null, "birinchi kunning o'zida hech kim ogohlantirilmaydi");
  assert.equal(idleState(user(), SINCE + 24 * HOUR, SINCE).action, "warn");
  // Kuzatuvdan keyin ro'yxatdan o'tgan va hali yozmagan (seen_at yo'q) — createdAt dan
  assert.equal(idleState(user({ createdAt: SINCE + 10 * HOUR }), SINCE + 30 * HOUR, SINCE).action, null);
  assert.equal(idleState(user({ active: false }), SINCE + 100 * HOUR, SINCE).action, null);
  assert.equal(idleState(user({ profile: null }), SINCE + 100 * HOUR, SINCE).action, null);
  assert.equal(idleState(user({ deletedAt: 5 }), SINCE + 100 * HOUR, SINCE).action, null);
  assert.equal(idleState(user({ createdAt: null }), SINCE, null).action, null, "hech qanday vaqt yo'q");
});
