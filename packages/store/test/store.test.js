import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, textKey } from "../src/index.js";

function fakeClock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
}

test("matn kaliti: emoji, harf kattaligi, bo'sh joy farq qilmaydi", () => {
  assert.equal(textKey("🚛 Toshkent - Farg'ona\n20 T"), textKey("toshkent farg ona 20 t 🔥"));
});

test("e'lon navbatga tushadi, bir xil xabar ikki marta yozilmaydi", () => {
  const store = openStore({ file: ":memory:" });
  const first = store.addPost({ source: "@a", messageId: 1, text: "Toshkentdan Samarqandga 20 t", postedAt: 1 });
  assert.equal(first.status, "new");
  assert.equal(store.addPost({ source: "@a", messageId: 1, text: "Toshkentdan Samarqandga 20 t", postedAt: 1 }), null);
  assert.deepEqual(store.takeNewPosts().map((p) => p.id), [first.id]);
  store.finishPost(first.id, "done");
  assert.equal(store.takeNewPosts().length, 0);
});

test("boshqa guruhga tashlangan o'sha matn AI'ga bormaydi (duplicate)", () => {
  const store = openStore({ file: ":memory:" });
  const window = 60_000;
  store.addPost({ source: "@a", messageId: 1, text: "🚛 Toshkent → Samarqand", postedAt: 1000 }, { dedupeWindowMs: window });
  const again = store.addPost({ source: "@b", messageId: 7, text: "Toshkent Samarqand", postedAt: 2000 }, { dedupeWindowMs: window });
  assert.equal(again.status, "duplicate");
  // Oxirgi ko'rinishidan (2000) muddat o'tgach — yangi
  const later = store.addPost({ source: "@c", messageId: 9, text: "Toshkent Samarqand", postedAt: 2000 + window + 1 }, { dedupeWindowMs: window });
  assert.equal(later.status, "new");
});

test("yuk kaliti muddat ichida takror hisoblanadi", () => {
  const clock = fakeClock();
  const store = openStore({ file: ":memory:", now: clock.now });
  const post = store.addPost({ source: "@a", messageId: 1, text: "x".repeat(30) });
  const id = store.addLoad({ postId: post.id, key: "k1", load: { fromCity: "Toshkent" } });
  store.setLoadDelivery(id, { sentTo: 3, channelMessageId: 55 });
  assert.equal(store.hasRecentLoad("k1", 1000), true);
  assert.equal(store.hasRecentLoad("k2", 1000), false);
  clock.advance(1001);
  assert.equal(store.hasRecentLoad("k1", 1000), false);
  assert.equal(store.stats().loads24h.sent, 3);
});

test("haydovchi: qoralama, profil, faol/pauza", () => {
  const store = openStore({ file: ":memory:" });
  store.saveDriver(42, { name: "Ali", draft: { step: "class" } });
  let driver = store.getDriver(42);
  assert.equal(driver.name, "Ali");
  assert.deepEqual(driver.draft, { step: "class" });
  assert.equal(driver.active, false);
  assert.equal(store.activeDrivers().length, 0);

  store.saveDriver(42, { profile: { vehicle: { truckClass: "isuzu" } }, draft: null, active: true });
  driver = store.getDriver(42);
  assert.equal(driver.draft, null);
  assert.equal(driver.name, "Ali", "berilmagan maydon o'zgarmaydi");
  assert.deepEqual(store.activeDrivers().map((d) => d.chatId), [42]);

  store.saveDriver(42, { active: false });
  assert.equal(store.activeDrivers().length, 0);
  assert.deepEqual(store.stats().drivers, { total: 1, active: 0 });
});

test("collector kursori", () => {
  const store = openStore({ file: ":memory:" });
  assert.equal(store.getCursor("@a"), null);
  store.setCursor("@a", 10);
  store.setCursor("@a", 15);
  assert.equal(store.getCursor("@a"), 15);
});

test("oxirgi yuklar: eng yangisi birinchi, muddatdan eskisi tushmaydi", () => {
  const clock = fakeClock();
  const store = openStore({ file: ":memory:", now: clock.now });
  const post = store.addPost({ source: "@a", messageId: 1, link: "https://t.me/a/1", text: "Toshkentdan Samarqandga 20 t", postedAt: 5 });
  store.addLoad({ postId: post.id, key: "k1", load: { fromCity: "Toshkent" } });
  clock.advance(10_000);
  store.addLoad({ postId: post.id, key: "k2", load: { fromCity: "Andijon" } });
  const all = store.recentLoads({ sinceMs: 60_000 });
  assert.deepEqual(all.map((r) => r.load.fromCity), ["Andijon", "Toshkent"]);
  assert.deepEqual(all[0].post, { source: "@a", link: "https://t.me/a/1", postedAt: 5 });
  assert.deepEqual(store.recentLoads({ sinceMs: 5_000 }).map((r) => r.load.fromCity), ["Andijon"]);
  assert.equal(store.recentLoads({ sinceMs: 60_000, limit: 1 }).length, 1);
});
