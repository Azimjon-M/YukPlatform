import { test } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
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

test("expireOldPosts: faqat navbatdagi eski e'lonlarni izoh bilan yopadi, AI'dagilarga tegmaydi", () => {
  const store = openStore({ file: ":memory:", now: () => 50_000 });
  const old = store.addPost({ source: "@a", messageId: 1, text: "Toshkentdan Samarqandga 20 t", postedAt: 1_000 });
  const busy = store.addPost({ source: "@a", messageId: 2, text: "Buxorodan Navoiyga 10 t", postedAt: 2_000 });
  const fresh = store.addPost({ source: "@a", messageId: 3, text: "Andijondan Farg'onaga 5 t", postedAt: 40_000 });
  const finished = store.addPost({ source: "@a", messageId: 4, text: "Qarshidan Termizga 22 t", postedAt: 1_000 });
  store.finishPost(finished.id, "failed", "AI xatosi");

  assert.equal(store.expireOldPosts({ before: 30_000, error: "Eskirgan", exclude: [busy.id] }), 1);
  const rows = Object.fromEntries(store.db.prepare("SELECT id, status, error, done_at FROM posts").all().map((r) => [r.id, r]));
  assert.deepEqual({ ...rows[old.id] }, { id: old.id, status: "done", error: "Eskirgan", done_at: 50_000 });
  assert.equal(rows[busy.id].status, "new", "AI'da turgan e'lon");
  assert.equal(rows[fresh.id].status, "new", "yangi e'lon");
  assert.equal(rows[finished.id].error, "AI xatosi", "navbatda bo'lmagan e'lon o'zgarmaydi");
  assert.equal(store.expireOldPosts({ before: 30_000, error: "Eskirgan" }), 1, "endi AI'dagisi ham");
});

test("takeNewPosts: joylangan va navbatga tushgan vaqt alohida (bot batch kutishini navbat vaqtidan hisoblaydi)", () => {
  const store = openStore({ file: ":memory:", now: () => 90_000 });
  store.addPost({ source: "@a", messageId: 1, text: "Toshkentdan Samarqandga 20 t", postedAt: 30_000 });
  const [post] = store.takeNewPosts();
  assert.equal(post.postedAt, 30_000);
  assert.equal(post.queuedAt, 90_000);
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

test("telefon raqami (ixtiyoriy): saqlash, o'chirish, so'ralgan vaqt; foydalanuvchini butunlay o'chirish", () => {
  const clock = fakeClock(5_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  let user = store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: { fromAreas: [] }, active: true });
  assert.deepEqual([user.phone, user.phoneAt, user.phoneAskedAt], [null, null, null]);

  store.saveDriver(42, { phoneAskedAt: 4_000 });
  clock.advance(1_000);
  user = store.saveDriver(42, { phone: "+998901234567" });
  assert.deepEqual([user.phone, user.phoneAt, user.phoneAskedAt], ["+998901234567", 6_000, 4_000]);
  assert.equal(store.listDrivers()[0].phone, "+998901234567", "boshqaruv markazi ro'yxatida bor");
  assert.equal(store.saveDriver(42, { active: false }).phone, "+998901234567", "berilmagan maydon o'zgarmaydi");

  user = store.saveDriver(42, { phone: null });
  assert.deepEqual([user.phone, user.phoneAt, user.phoneAskedAt], [null, null, 4_000]);

  assert.equal(store.deleteDriver(42), true);
  assert.equal(store.getDriver(42), null);
  assert.equal(store.deleteDriver(42), false);
});

test("switchRole: har rolning sozlamalari alohida saqlanadi, qaytganda tiklanadi", () => {
  const store = openStore({ file: ":memory:" });
  const truck = { vehicle: { truckClass: "isuzu" }, fromAreas: ["toshkent"] };
  const cargo = { fromAreas: ["samarqand"], truckClasses: ["fura"] };
  store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: truck, active: true });

  // Yuk beruvchi bo'ldi — u rolda hali sozlama yo'q
  let user = store.switchRole(42, "yuk_beruvchi");
  assert.equal(user.role, "yuk_beruvchi");
  assert.equal(user.profile, null);
  assert.deepEqual(user.profiles, { haydovchi: truck }, "haydovchi sozlamalari yashirildi");
  assert.equal(store.activeUsers("haydovchi").length, 0, "endi yuk olmaydi");

  store.saveDriver(42, { profile: cargo });
  user = store.switchRole(42, "haydovchi");
  assert.deepEqual(user.profile, truck, "mashinasi qaytdi");
  assert.equal(user.active, true);
  assert.deepEqual(user.profiles, { haydovchi: truck, yuk_beruvchi: cargo });
  assert.deepEqual(store.activeUsers("haydovchi").map((u) => u.chatId), [42]);

  assert.deepEqual(store.switchRole(42, "yuk_beruvchi").profile, cargo);
  assert.equal(store.switchRole(42, "yuk_beruvchi").role, "yuk_beruvchi", "o'sha rol — o'zgarmaydi");
  assert.deepEqual(store.getDriver(42).profile, cargo);

  // Rollardan oldingi yozuv: role yo'q, profil bor → haydovchi hisoblanadi va saqlanadi
  store.saveDriver(7, { profile: truck, active: true });
  store.db.exec("UPDATE drivers SET role = NULL WHERE chat_id = 7");
  assert.deepEqual(store.switchRole(7, "yuk_beruvchi").profiles, { haydovchi: truck });
  assert.deepEqual(store.switchRole(7, "haydovchi").profile, truck);

  // Yangi foydalanuvchi — yozuv yaratiladi
  user = store.switchRole(99, "haydovchi");
  assert.deepEqual([user.role, user.profile, user.profiles], ["haydovchi", null, {}]);
});

test("eski baza: telefon va profiles ustunlari migratsiyada qo'shiladi, yozuvlar saqlanadi", () => {
  const file = `${process.env.TEMP ?? "/tmp"}/yuk-migrate-${process.pid}-${Date.now()}.db`;
  const old = openStore({ file });
  old.saveDriver(7, { name: "Eski", role: "haydovchi", profile: { fromAreas: [] }, active: true });
  // Ustunlarsiz eski bazani yasaymiz (DROP COLUMN — SQLite 3.35+)
  for (const column of ["phone", "phone_at", "phone_asked_at", "profiles"]) old.db.exec(`ALTER TABLE drivers DROP COLUMN ${column}`);
  old.close();
  const store = openStore({ file });
  const user = store.getDriver(7);
  assert.equal(user.name, "Eski");
  assert.equal(user.phone, null);
  assert.deepEqual(user.profiles, {});
  assert.deepEqual(store.switchRole(7, "yuk_beruvchi").profiles, { haydovchi: { fromAreas: [] } });
  assert.equal(store.saveDriver(7, { phone: "+998901234567" }).phone, "+998901234567");
  store.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(file + suffix);
    } catch {
      // yo'q bo'lsa — mayli
    }
  }
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
