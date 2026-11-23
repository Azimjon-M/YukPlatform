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
  assert.equal(post.sender, null);
});

test("e'lonni yozgan odam (sender) navbatdagi e'londa va «Mos yuklar» ro'yxatida bor", () => {
  const store = openStore({ file: ":memory:" });
  const { id } = store.addPost({ source: "@a", messageId: 1, text: "Toshkentdan Samarqandga 20 t", postedAt: Date.now(), sender: "ish_beruvchi" });
  const [post] = store.takeNewPosts();
  assert.equal(post.sender, "ish_beruvchi");
  store.addLoad({ postId: id, key: "k1", load: { fromCity: "Toshkent" } });
  assert.equal(store.recentLoads()[0].post.sender, "ish_beruvchi");
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

test("telefon raqami (ixtiyoriy): saqlash, o'chirish, so'ralgan vaqt; hisobni o'chirish va butunlay o'chirish", () => {
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

  // Hisobni o'chirish — qator qoladi (Azimjon: «Hammasi saqlansin»), ikkinchi marta — false
  assert.equal(store.deleteDriver(42), true);
  assert.notEqual(store.getDriver(42), null);
  assert.equal(store.deleteDriver(42), false);
  // Butunlay o'chirish — faqat boshqaruv markazidan
  assert.equal(store.purgeDriver(42), true);
  assert.equal(store.getDriver(42), null);
  assert.equal(store.purgeDriver(42), false);
});

test("hisobni o'chirish: qator va ma'lumot qoladi (snapshot), yuborish to'xtaydi; qaytsa — boshidan, «necha marta» qoladi", () => {
  const clock = fakeClock(10_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: ["toshkent"], toAreas: [], routeAt: 9_000 };
  const cargo = { fromAreas: ["samarqand"], truckClasses: ["fura"] };
  store.saveDriver(42, { name: "Ali", role: "yuk_beruvchi", profile: cargo, active: true });
  store.switchRole(42, "haydovchi");
  store.saveDriver(42, { profile: truck, phone: "+998901234567", isAdmin: true });
  assert.equal(store.activeUsers("haydovchi").length, 1);

  clock.advance(1_000);
  assert.equal(store.deleteDriver(42, { via: "web" }), true);
  const user = store.getDriver(42);
  assert.deepEqual(
    [user.role, user.profile, user.phone, user.isAdmin, user.active, user.deletedAt, user.deletedVia, user.deletedCount],
    [null, null, null, false, false, 11_000, "web", 1],
    "foydalanuvchi uchun hisob yopildi",
  );
  assert.equal(store.activeUsers("haydovchi").length, 0, "yuk yuborilmaydi");

  // Boshqaruv markazida — hammasi ko'rinadi
  const row = store.listDrivers().find((d) => d.chatId === 42);
  assert.equal(row.name, "Ali");
  assert.deepEqual(row.deletedSnapshot.profile, truck);
  assert.deepEqual(row.deletedSnapshot.profiles, { yuk_beruvchi: cargo });
  assert.equal(row.deletedSnapshot.phone, "+998901234567");
  assert.equal(row.deletedSnapshot.role, "haydovchi");
  assert.equal(row.deletedSnapshot.isAdmin, true);
  const deletedEvent = store.driverDetails(42).events[0];
  assert.equal(deletedEvent.type, "deleted");
  assert.equal(deletedEvent.detail.via, "web");
  assert.equal(deletedEvent.detail.phone, "+998901234567");

  // Qaytdi: belgi olinadi, ma'lumot tiklanmaydi (boshidan boshlaydi), «1 marta o'chirgan» qoladi
  clock.advance(1_000);
  assert.equal(store.comeBack(42, "bot"), true);
  assert.equal(store.comeBack(42, "bot"), false, "o'chirilmagan — hech narsa");
  const back = store.getDriver(42);
  assert.deepEqual([back.deletedAt, back.deletedCount, back.returnedAt, back.role, back.profile], [null, 1, 12_000, null, null]);
  assert.equal(store.listDrivers()[0].deletedSnapshot, null);

  // Ikkinchi marta o'chirsa — 2
  store.saveDriver(42, { role: "haydovchi" });
  store.deleteDriver(42, { via: "bot" });
  assert.equal(store.getDriver(42).deletedCount, 2);
  assert.deepEqual(
    store.driverDetails(42).events.slice(0, 3).map((e) => e.type),
    ["deleted", "role", "returned"],
  );
});

test("tarix (user_events): rol, ro'yxatdan o'tish, yo'nalish, pauza, bloklash, raqam, admin, chiqish", () => {
  const clock = fakeClock(1_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  const types = () => store.driverDetails(42).events.map((e) => e.type).reverse();
  store.saveDriver(42, { name: "Ali" });
  store.saveDriver(42, { name: "Ali" }); // o'zgarish yo'q — voqea yo'q
  store.switchRole(42, "haydovchi");
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [] };
  store.saveDriver(42, { profile: truck });
  store.saveDriver(42, { profile: { ...truck, vehicle: { truckClass: "isuzu" } } });
  store.saveDriver(42, { profile: { ...truck, vehicle: { truckClass: "isuzu" }, fromAreas: ["toshkent"], routeAt: 2_000 } });
  store.saveDriver(42, { active: false });
  store.saveDriver(42, { active: true, why: "admin" });
  store.saveDriver(42, { active: false, why: "blocked" });
  store.saveDriver(42, { phone: "+998901234567" });
  store.saveDriver(42, { phone: null });
  store.saveDriver(42, { isAdmin: true });
  store.signOut(42);
  assert.deepEqual(types(), [
    "joined",
    "role",
    "registered",
    "settings",
    "route",
    "paused",
    "resumed",
    "blocked",
    "phone",
    "phone_removed",
    "admin",
    "signout",
  ]);
  const events = store.driverDetails(42).events;
  assert.deepEqual(events.find((e) => e.type === "resumed").detail, { by: "admin" });
  assert.deepEqual(events.find((e) => e.type === "route").detail, { fromAreas: ["toshkent"], toAreas: [] });
  assert.deepEqual(events.find((e) => e.type === "role").detail, { from: null, to: "haydovchi", restored: false });
  assert.equal(store.driverDetails(999), null);
  // Jonli belgi: yangi voqea — drivers o'zgaradi
  const before = store.changeMarks().drivers;
  store.logEvent(42, "returned", { via: "bot" });
  assert.notEqual(store.changeMarks().drivers, before);
});

test("pauza: kim va qachon (o'zi / 48 soat kirmagan / bloklagan); yoqilsa — tozalanadi; «24 soat» ogohlantirishi", () => {
  const clock = fakeClock(1_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: { fromAreas: [] }, active: true });
  let user = store.getDriver(42);
  assert.deepEqual([user.pausedAt, user.pausedBy, user.idleWarnedAt], [null, null, null]);

  clock.advance(1_000);
  store.markIdleWarned(42);
  assert.equal(store.getDriver(42).idleWarnedAt, 2_000);
  assert.equal(store.getDriver(42).updatedAt, 1_000, "ogohlantirish sozlama emas — updated_at o'zgarmaydi");

  clock.advance(1_000);
  user = store.saveDriver(42, { active: false, why: "idle" });
  assert.deepEqual([user.active, user.pausedAt, user.pausedBy], [false, 3_000, "idle"]);
  store.saveDriver(42, { active: false, why: "blocked" });
  assert.equal(store.getDriver(42).pausedBy, "idle", "holat o'zgarmasa — sababi ham o'zgarmaydi");
  user = store.saveDriver(42, { active: true });
  assert.deepEqual([user.pausedAt, user.pausedBy], [null, null]);
  user = store.saveDriver(42, { active: false });
  assert.equal(user.pausedBy, "user", "o'zi ⏸ bosgan");

  const row = store.listDrivers()[0];
  assert.deepEqual([row.pausedBy, row.idleWarnedAt], ["user", 2_000]);
  assert.deepEqual(
    store.driverDetails(42).events.slice(0, 4).map((e) => [e.type, e.detail]),
    [["paused", null], ["resumed", null], ["paused", { by: "idle" }], ["idle_warned", null]],
  );
});

test("batafsil: ikkala rolning sozlamalari, yuborilgan yuklar (yo'nalish, xato, e'lon havolasi)", () => {
  const clock = fakeClock(1_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  store.saveDriver(7, { name: "Vali", role: "haydovchi", profile: { fromAreas: [] }, active: true });
  store.switchRole(7, "yuk_beruvchi");
  const post = store.addPost({ source: "@a", messageId: 1, link: "https://t.me/a/1", text: "Samarqanddan Toshkentga 20 t", postedAt: 5 });
  const loadId = store.addLoad({ postId: post.id, key: "k", load: { fromCity: "Samarqand" }, kind: "mashina" });
  store.addDelivery({ loadId, chatId: 7, ok: true });
  clock.advance(1_000);
  store.addDelivery({ loadId, chatId: 7, ok: false, error: "Forbidden: bot was blocked by the user" });
  // «📞 Telefon qilish» bosildi — yetib borgan xabarga yoziladi (yetmagani bosilishi mumkin emas), faqat birinchi marta
  clock.advance(1_000);
  assert.equal(store.markCalled({ loadId, chatId: 7 }), true);
  clock.advance(1_000);
  assert.equal(store.markCalled({ loadId, chatId: 7 }), false, "ikkinchi bosish — vaqt o'zgarmaydi");
  assert.equal(store.markCalled({ loadId, chatId: 8 }), false, "unga yuborilmagan");
  const details = store.driverDetails(7);
  assert.deepEqual(details.profiles, { haydovchi: { fromAreas: [] } });
  assert.deepEqual(details.deliveries, [
    { ok: false, error: "Forbidden: bot was blocked by the user", at: 2_000, calledAt: null, load: { fromCity: "Samarqand" }, kind: "mashina", link: "https://t.me/a/1" },
    { ok: true, error: null, at: 1_000, calledAt: 3_000, load: { fromCity: "Samarqand" }, kind: "mashina", link: "https://t.me/a/1" },
  ]);
  assert.equal(store.listDrivers().find((d) => d.chatId === 7).deliveries.called, 1);

  // Bitta yuk id bo'yicha (qo'ng'iroq sahifasi)
  assert.deepEqual(store.getLoad(loadId), {
    id: loadId,
    kind: "mashina",
    load: { fromCity: "Samarqand" },
    post: { source: "@a", link: "https://t.me/a/1", postedAt: 5 },
    createdAt: 1_000,
  });
  assert.equal(store.getLoad(loadId + 100), null);
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

test("signOut: rol va sozlamalar yashiriladi, yuborish to'xtaydi; rolni qayta tanlasa — tiklanadi", () => {
  const store = openStore({ file: ":memory:" });
  const truck = { vehicle: { truckClass: "isuzu" }, fromAreas: ["toshkent"], routeAt: 1 };
  const cargo = { fromAreas: ["samarqand"], truckClasses: ["fura"] };
  store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: truck, active: true, phone: "+998901112233", isAdmin: true });
  store.switchRole(42, "yuk_beruvchi");
  store.saveDriver(42, { profile: cargo });
  store.switchRole(42, "haydovchi");

  const out = store.signOut(42);
  assert.deepEqual([out.role, out.profile, out.active, out.draft], [null, null, false, null]);
  assert.deepEqual(out.profiles, { haydovchi: truck, yuk_beruvchi: cargo }, "ikkala rolning sozlamalari saqlandi");
  assert.deepEqual([out.name, out.phone, out.isAdmin], ["Ali", "+998901112233", true], "raqam va ism qoladi");
  assert.equal(store.activeUsers("haydovchi").length, 0, "bot yuk yubormaydi");
  assert.ok(out.signedOutAt > 0);
  assert.equal(out.signedOutRole, "haydovchi");
  // Boshqaruv markazi: rol ustuni bo'sh, lekin oxirgi rol va sozlamalari ko'rinadi
  const listed = store.listDrivers().find((d) => d.chatId === 42);
  assert.deepEqual([listed.role, listed.profile, listed.signedOutRole, listed.savedProfile], [null, null, "haydovchi", truck]);
  assert.ok(listed.signedOutAt > 0);
  const again = store.signOut(42);
  assert.deepEqual(again.profiles, out.profiles, "ikkinchi marta — hech narsa yo'qolmaydi");
  assert.deepEqual([again.signedOutAt, again.signedOutRole], [out.signedOutAt, "haydovchi"], "vaqti va roli o'zgarmaydi");

  const back = store.switchRole(42, "haydovchi");
  assert.deepEqual([back.role, back.profile, back.active], ["haydovchi", truck, true], "qayta kirdi — yo'nalish bilan tiklandi");
  assert.deepEqual([back.signedOutAt, back.signedOutRole], [null, null], "«chiqqan» belgisi tozalandi");
  assert.equal(store.listDrivers().find((d) => d.chatId === 42).savedProfile, null);
  assert.deepEqual(store.activeUsers("haydovchi").map((u) => u.chatId), [42]);
  assert.equal(store.signOut(404), null, "yozuv yo'q");
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

test("eski baza: ustunlardan oldin hisobdan chiqqanlar migratsiyada «chiqqan» deb belgilanadi", () => {
  const file = `${process.env.TEMP ?? "/tmp"}/yuk-signout-${process.pid}-${Date.now()}.db`;
  const old = openStore({ file });
  const truck = { vehicle: { truckClass: "fura" }, fromAreas: ["samarqand"] };
  old.saveDriver(1, { name: "Chiqqan", role: "haydovchi", profile: truck, active: true });
  old.signOut(1);
  old.saveDriver(2, { name: "Ikki rol", role: "haydovchi", profile: truck });
  old.switchRole(2, "yuk_beruvchi");
  old.saveDriver(2, { profile: { fromAreas: [] } });
  old.signOut(2);
  old.saveDriver(3, { name: "Yangi" }); // rol tanlamagan, hech narsa saqlanmagan
  old.saveDriver(4, { name: "Faol", role: "haydovchi", profile: truck, active: true });
  // signOut yozgan belgilarsiz eski bazani yasaymiz
  for (const column of ["signed_out_at", "signed_out_role"]) old.db.exec(`ALTER TABLE drivers DROP COLUMN ${column}`);
  old.close();
  const store = openStore({ file });
  const byId = Object.fromEntries(store.listDrivers().map((d) => [d.chatId, d]));
  assert.ok(byId[1].signedOutAt > 0);
  assert.deepEqual([byId[1].signedOutRole, byId[1].savedProfile], ["haydovchi", truck], "yagona saqlangan rol — o'shandan chiqqan");
  assert.ok(byId[2].signedOutAt > 0);
  assert.equal(byId[2].signedOutRole, null, "ikkala rol saqlangan — qaysi biridan chiqqani noma'lum");
  assert.deepEqual([byId[3].signedOutAt, byId[4].signedOutAt], [null, null], "yangi va faol foydalanuvchiga tegmaydi");
  store.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(file + suffix);
    } catch {
      // yo'q bo'lsa — mayli
    }
  }
});

test("oxirgi faollik: bot/web, 15 s da bir martadan tez yozilmaydi, updated_at o'zgarmaydi", () => {
  const clock = fakeClock();
  const store = openStore({ file: ":memory:", now: clock.now });
  store.touchDriver(5, "bot"); // yo'q foydalanuvchi — hech narsa
  assert.equal(store.getDriver(5), null);
  const created = store.saveDriver(5, { name: "Ali" });
  clock.advance(1000);
  store.touchDriver(5, "bot");
  const seen = store.getDriver(5);
  assert.deepEqual([seen.seenAt, seen.seenVia, seen.updatedAt], [clock.now(), "bot", created.updatedAt]);
  clock.advance(5000);
  store.touchDriver(5, "bot");
  assert.equal(store.getDriver(5).seenAt, seen.seenAt, "15 s o'tmagan — yozilmaydi");
  store.touchDriver(5, "web");
  assert.deepEqual([store.getDriver(5).seenAt, store.getDriver(5).seenVia], [clock.now(), "web"], "web'ga o'tdi — darrov");
  clock.advance(16_000);
  store.touchDriver(5, "web");
  assert.equal(store.getDriver(5).seenAt, clock.now());
  assert.equal(store.listDrivers()[0].seenVia, "web");
});

test("olgan yuklari: bugun (Toshkent vaqti) / jami, oxirgisi yo'nalishi bilan, oxirgi xato; butunlay o'chirilsa — o'chadi", () => {
  // 2026-11-09 00:30 Toshkent = 2026-11-08 19:30 UTC — «bugun» shu kun 00:00 Toshkent'dan
  const clock = fakeClock(Date.UTC(2026, 10, 8, 19, 30));
  const store = openStore({ file: ":memory:", now: clock.now });
  store.saveDriver(7, { name: "Vali", role: "haydovchi", profile: { vehicle: {} }, active: true });
  store.saveDriver(8, { name: "Ali" });
  const post = store.addPost({ source: "@a", messageId: 1, text: "Samarqanddan Toshkentga 5 t", postedAt: clock.now() });
  const yesterday = store.addLoad({ postId: post.id, key: "a", load: { fromRegion: "andijon", toRegion: "namangan" } });
  const today = store.addLoad({ postId: post.id, key: "b", load: { fromCity: "Samarqand", fromRegion: "samarqand", toRegion: "toshkent_sh" } });

  clock.advance(-60 * 60 * 1000); // 23:30 kecha
  store.addDelivery({ loadId: yesterday, chatId: 7, ok: true });
  clock.advance(60 * 60 * 1000 + 60_000); // 00:31 bugun
  store.addDelivery({ loadId: today, chatId: 7, ok: true });
  const lastAt = clock.now();
  clock.advance(1000);
  store.addDelivery({ loadId: today, chatId: 7, ok: false, error: "Forbidden: bot was blocked by the user" });

  const [vali] = store.listDrivers().filter((d) => d.chatId === 7);
  assert.deepEqual(vali.deliveries, {
    today: 1,
    total: 2,
    lastAt,
    lastLoad: { fromCity: "Samarqand", fromRegion: "samarqand", toRegion: "toshkent_sh" },
    failed: 1,
    lastError: "Forbidden: bot was blocked by the user",
    lastErrorAt: clock.now(),
    called: 0,
  });
  assert.deepEqual(store.listDrivers().find((d) => d.chatId === 8).deliveries, {
    today: 0, total: 0, lastAt: null, lastLoad: null, failed: 0, lastError: null, lastErrorAt: null, called: 0,
  });

  // Jonli belgilar: yangi yuborish — drivers va loads o'zgaradi, posts — yo'q
  const before = store.changeMarks();
  store.addDelivery({ loadId: today, chatId: 8, ok: true });
  const after = store.changeMarks();
  assert.deepEqual(
    Object.keys(after).filter((k) => after[k] !== before[k]),
    ["drivers", "loads"],
  );
  store.saveDriver(8, { active: true });
  assert.notEqual(store.changeMarks().drivers, after.drivers);

  // Hisobini o'chirsa — yuborilganlar ro'yxati qoladi; butunlay o'chirilsa (purge) — o'chadi
  assert.equal(store.deleteDriver(7), true);
  assert.equal(store.listDrivers().find((d) => d.chatId === 7).deliveries.total, 2, "hisobini o'chirsa ham qoladi");
  assert.equal(store.purgeDriver(7), true);
  store.saveDriver(7, { name: "Vali" });
  assert.equal(store.listDrivers().find((d) => d.chatId === 7).deliveries.total, 0, "butunlay o'chirilganda yuborilganlar ro'yxati ham o'chdi");
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
  assert.deepEqual(all[0].post, { source: "@a", link: "https://t.me/a/1", postedAt: 5, sender: null, fromShipper: false, media: null, senderId: null });
  assert.deepEqual(store.recentLoads({ sinceMs: 5_000 }).map((r) => r.load.fromCity), ["Andijon"]);
  assert.equal(store.recentLoads({ sinceMs: 60_000, limit: 1 }).length, 1);
});

test("takeNewPostsAfter: id'dan keyingi yangi e'lonlar; finishPost kim tushunganini yozadi", () => {
  const store = openStore({ file: ":memory:" });
  for (let i = 1; i <= 3; i++) store.addPost({ source: "@g", messageId: i, text: `e'lon matni ${i} ${"x".repeat(20)}`, postedAt: Date.now() });
  const all = store.takeNewPostsAfter(0);
  assert.deepEqual(all.map((p) => p.messageId), [1, 2, 3]);
  assert.deepEqual(store.takeNewPostsAfter(all[1].id).map((p) => p.messageId), [3]);
  store.finishPost(all[0].id, "done", null, "rules");
  store.finishPost(all[1].id, "failed", "xato");
  assert.deepEqual(store.takeNewPostsAfter(0).map((p) => p.messageId), [3], "tugaganlari olinmaydi");
  const byId = Object.fromEntries(store.listPosts().items.map((p) => [p.messageId, p.parsedBy]));
  assert.deepEqual(byId, { 1: "rules", 2: null, 3: null });
  store.close();
});

test("kanal va guruhga a'zolik: holat, tarix (o'zgarganda) va eslatma vaqti; updated_at o'zgarmaydi", () => {
  const clock = fakeClock(1_000);
  const store = openStore({ file: ":memory:", now: clock.now });
  assert.equal(store.setSubscription(42, { ok: false, missing: ["@k"] }), false, "yo'q foydalanuvchi — yozilmaydi");
  store.saveDriver(42, { name: "Ali" });
  store.saveDriver(43, { name: "Vali" });
  assert.deepEqual([store.getDriver(42).subOk, store.getDriver(42).subMissing], [null, []]);

  clock.advance(1_000);
  store.setSubscription(43, { ok: true });
  store.setSubscription(42, { ok: false, missing: ["@k", "@g"] });
  store.setSubscription(42, { ok: false, missing: ["@k", "@g"] });
  store.setSubscription(42, { ok: false, missing: ["@g"] });
  store.setSubscription(42, { ok: true, missing: ["@g"] });
  store.markSubReminded(42);
  const user = store.getDriver(42);
  assert.deepEqual([user.subOk, user.subMissing, user.subCheckedAt, user.subRemindedAt, user.updatedAt], [true, [], 2_000, 2_000, 1_000]);
  assert.deepEqual(
    store.driverDetails(42).events.filter((e) => e.type.startsWith("sub_")).map((e) => [e.type, e.detail]),
    [["sub_joined", null], ["sub_left", { missing: ["@g"], first: false }], ["sub_left", { missing: ["@k", "@g"], first: true }]],
  );
  assert.equal(store.driverDetails(43).events.filter((e) => e.type.startsWith("sub_")).length, 0, "birinchi tekshiruvda a'zo — tarixga yozilmaydi");
  const row = store.listDrivers().find((d) => d.chatId === 42);
  assert.deepEqual([row.subOk, row.subMissing, row.subCheckedAt], [true, [], 2_000]);

  const before = store.changeMarks().drivers;
  store.setSubscription(43, { ok: false, missing: ["@k"] });
  assert.notEqual(store.changeMarks().drivers, before, "boshqaruv markazi jonli yangilanadi");
});

test("blok: id, username va raqamga; boshqa akkaunt o'sha username / raqam bilan ham bloklangan; yuk ro'yxatidan chiqadi; blokdan chiqarish", () => {
  const store = openStore({ file: ":memory:" });
  const profile = { fromAreas: [] };
  store.saveDriver(1, { name: "Ali", username: "Ali_Haydovchi", phone: "+998901112233", role: "haydovchi", profile, active: true });
  store.saveDriver(2, { name: "Ikkinchi akkaunt", username: "ali_haydovchi", role: "haydovchi", profile, active: true });
  store.saveDriver(3, { name: "Vali", phone: "+998901112233" });
  store.saveDriver(4, { name: "Begona", username: "begona", role: "haydovchi", profile, active: true });
  assert.equal(store.banOf({ chatId: 1 }), null);
  assert.equal(store.banDriver(99), null, "yo'q foydalanuvchi");

  assert.deepEqual(store.banDriver(1), { kind: "id", value: "1", chatId: 1, at: store.banOf({ chatId: 1 }).at });
  assert.equal(store.banOf({ chatId: 2, username: "ALI_haydovchi" }).kind, "username", "username katta-kichik harfsiz");
  assert.equal(store.banOf({ chatId: 3, phone: "+998901112233" }).kind, "phone");
  assert.equal(store.banOf({ chatId: 4, username: "@begona" }), null);
  assert.deepEqual(store.activeUsers("haydovchi").map((u) => u.chatId), [4], "bloklanganlarga yuk va ogohlantirish bormaydi");
  const rows = Object.fromEntries(store.listDrivers().map((d) => [d.chatId, d.banned?.by ?? null]));
  assert.deepEqual(rows, { 1: "id", 2: "username", 3: "phone", 4: null });

  // 2-akkauntni blokdan chiqarish — faqat uni bloklab turgan username yozuvi o'chadi, 1 bloklangan qoladi
  assert.equal(store.unbanDriver(2), 1);
  assert.equal(store.banOf({ chatId: 2, username: "ali_haydovchi" }), null);
  assert.equal(store.banOf({ chatId: 1 }).kind, "id");
  assert.equal(store.unbanDriver(1), 2);
  assert.equal(store.banOf({ chatId: 3, phone: "+998901112233" }), null);
  assert.equal(store.unbanDriver(1), 0);
  assert.deepEqual(
    store.driverDetails(1).events.filter((e) => /banned/.test(e.type)).map((e) => [e.type, e.detail]),
    [["unbanned", null], ["banned", { username: "Ali_Haydovchi", phone: "+998901112233" }]],
  );
  const before = store.changeMarks().drivers;
  store.banDriver(4);
  assert.notEqual(store.changeMarks().drivers, before, "boshqaruv markazi jonli yangilanadi");
});

test("botga topshiriqlar (bot_notices): bir odamga bittadan, olingach o'chadi, 10 daqiqadan eskisi bajarilmaydi; yo'nalish xabari", () => {
  const clock = fakeClock();
  const store = openStore({ file: ":memory:", now: clock.now });
  store.addBotNotice(42, "route");
  store.addBotNotice(42, "route");
  store.addBotNotice(7, "route");
  assert.deepEqual(store.takeBotNotices().map((n) => [n.chatId, n.kind]), [[42, "route"], [7, "route"]]);
  assert.deepEqual(store.takeBotNotices(), []);

  store.addBotNotice(42, "route");
  clock.advance(11 * 60 * 1000); // bot o'chiq turdi
  assert.deepEqual(store.takeBotNotices(), [], "eski topshiriq tashlanadi");
  assert.deepEqual(store.takeBotNotices(), [], "va o'chirilgan");

  store.saveDriver(42, { name: "Ali" });
  assert.equal(store.routeMessage(42), null);
  store.setRouteMessage(42, 555);
  assert.equal(store.routeMessage(42), 555);
  store.setRouteMessage(42, null);
  assert.equal(store.routeMessage(42), null);
  assert.equal(store.routeMessage(999), null, "yo'q odam");
  store.close();
});

test("metrics maxAgeMs: shuncha yangi hisob bo'lsa — qayta hisoblamaydi (og'ir so'rov, API qotmasin)", () => {
  let time = 1_000_000;
  const store = openStore({ file: ":memory:", now: () => time });
  const first = store.metrics({ maxAgeMs: 15_000 });
  store.addPost({ source: "@a", messageId: 1, text: "yangi e'lon matni uzunroq", postedAt: time });
  assert.equal(store.metrics({ maxAgeMs: 15_000 }), first, "15 s ichida — o'sha natija");
  assert.equal(store.metrics().queue.waiting, 1, "maxAgeMs'siz — har doim yangi");
  time += 16_000;
  assert.equal(store.metrics({ maxAgeMs: 15_000 }).queue.waiting, 1);
  store.close();
});

test("qidiruv kirill/lotin farqisiz: «тошкент» = «Тошкент» = «toshkent», «Қўқон» = «qo'qon»; takrorlar qidiruvda yo'q", () => {
  const store = openStore({ file: ":memory:" });
  store.addPost({ source: "@a", messageId: 1, text: "Тошкентдан Қўқонга 5 тонна юк бор", postedAt: 1 });
  store.addPost({ source: "@a", messageId: 2, text: "Toshkentdan Samarqandga yuk bor", postedAt: 2 });
  store.addPost({ source: "@b", messageId: 3, text: "Тошкентдан Қўқонга 5 тонна юк бор", postedAt: 3 }, { dedupeWindowMs: 60_000 });
  const found = (q, extra = {}) => store.listPosts({ q, ...extra }).total;
  assert.equal(found("тошкент"), 2);
  assert.equal(found("ТОШКЕНТ"), 2);
  assert.equal(found("toshkent"), 2);
  assert.equal(found("qo'qon"), 1);
  assert.equal(found("Қўқон"), 1);
  assert.equal(found("samarqand"), 1);
  assert.equal(found("Самарқанд"), 1, "kirillcha so'rov lotin e'lonni ham topadi");
  assert.equal(found("тошкент", { status: "duplicate" }), 1, "«Takror» bo'limida — takrorlar");
  store.close();
});

test("backfillTextFold: eski e'lonlar (text_fold yo'q) eng yangisidan to'ldiriladi, keyin 0", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "yuk-fold-")), "t.db");
  let store = openStore({ file });
  for (let i = 1; i <= 7; i++) store.addPost({ source: "@a", messageId: i, text: `Тошкент ${i}`, postedAt: i });
  store.close();
  const raw = new DatabaseSync(file);
  raw.exec("UPDATE posts SET text_fold = NULL"); // eski baza: ustun hali bo'sh
  raw.close();
  store = openStore({ file });
  assert.equal(store.listPosts({ q: "toshkent" }).total, 0, "to'ldirilmaguncha topilmaydi");
  let rounds = 0;
  while (store.backfillTextFold(3) > 0) rounds++;
  assert.equal(rounds, 3, "7 ta qator, 3 tadan");
  assert.equal(store.listPosts({ q: "toshkent" }).total, 7);
  assert.equal(store.backfillTextFold(3), 0);
  store.close();
});

test("ilova kirish kodi: 10 daqiqadan keyin eskiradi, tasdiqsiz token yo'q", () => {
  let time = 1_000_000;
  const store = openStore({ file: ":memory:", now: () => time });
  const code = "a".repeat(32);
  store.createAppLogin(code);
  assert.equal(store.appLoginState(code), "pending");
  assert.equal(store.consumeAppLogin(code), null);
  assert.throws(() => store.createAppLogin("qisqa"));
  time += 11 * 60 * 1000;
  assert.equal(store.appLoginState(code), "expired");
  assert.equal(store.confirmAppLogin(code, 5), false);
  const second = "b".repeat(32);
  store.createAppLogin(second);
  assert.equal(store.confirmAppLogin(second, 5), true);
  assert.equal(store.appLoginState(second), "confirmed");
  assert.equal(store.consumeAppLogin(second), 5);
  assert.equal(store.appLoginState(second), "used");
  store.close();
});
