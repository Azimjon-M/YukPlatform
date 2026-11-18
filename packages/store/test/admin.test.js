import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireRunLock, openStore, readRunLock, removeRunLock } from "../src/index.js";

const HOUR = 3_600_000;

function fixture() {
  let time = 100 * HOUR;
  const store = openStore({ file: ":memory:", now: () => time });
  const advance = (ms) => (time += ms);
  const a = store.addPost({ source: "@a", messageId: 1, link: "https://t.me/a/1", text: "Farg'onadan Samarqandga 20 t tent", postedAt: time - 60_000 });
  const b = store.addPost({ source: "@b", messageId: 2, text: "Toshkentdan Moskvaga ref kerak", postedAt: time - 120_000 });
  store.addPost({ source: "@b", messageId: 3, text: "Toshkentdan Moskvaga ref kerak!!", postedAt: time }, { dedupeWindowMs: HOUR });
  store.addLoad({ postId: a.id, key: "a", load: { fromRegion: "fargona", fromCity: "Beshariq", toRegion: "samarqand", truckClass: "fura", bodyType: "tent", cargo: "un" } });
  store.addLoad({ postId: b.id, key: "b", load: { fromRegion: "toshkent_sh", toRegion: "xorij", toCountry: "Rossiya", bodyType: "ref", cargo: "meva" } });
  store.finishPost(a.id, "done");
  return { store, advance, a, b };
}

test("yuklar ro'yxati: filtrlar, qidiruv, sahifalash", () => {
  const { store } = fixture();
  assert.equal(store.listLoads().total, 2);
  assert.deepEqual(store.listLoads({ from: "fargona" }).items.map((i) => i.load.fromCity), ["Beshariq"]);
  assert.equal(store.listLoads({ bodyType: "ref" }).items[0].load.toCountry, "Rossiya");
  assert.equal(store.listLoads({ q: "meva" }).total, 1);
  assert.equal(store.listLoads({ q: "Moskvaga" }).total, 1, "e'lon matni ichida ham qidiradi");
  assert.equal(store.listLoads({ limit: 1, offset: 1 }).items.length, 1);
  assert.equal(store.listLoads({ truckClass: "isuzu" }).total, 0);
  assert.equal(store.listLoads().items[0].post.source, "@b", "eng yangisi birinchi");
});

test("navbat: holat bo'yicha; barcha xatolarni o'chirish — haydovchiga ketganlari faqat yashiriladi", () => {
  const { store, b } = fixture();
  assert.equal(store.listPosts({ status: "duplicate" }).total, 1);
  const c = store.addPost({ source: "@c", messageId: 4, text: "Buxorodan Navoiyga 5 t isuzu", postedAt: 0 });
  const d = store.addPost({ source: "@c", messageId: 5, text: "Xivadan Urganchga labo kerak +998901234567", postedAt: 0 });
  store.addPostDelivery({ postId: d.id, chatId: 7, ok: true }); // tezkor rejimda asl matn bilan ketgan
  for (const post of [b, c, d]) store.finishPost(post.id, "failed", "503");
  assert.equal(store.listPosts({ status: "failed" }).items[0].error, "503");

  assert.deepEqual(store.clearFailed(), { deleted: 1, hidden: 2 });
  assert.equal(store.listPosts({ status: "failed" }).total, 0);
  assert.equal(store.getPost(c.id), null, "hech kimga ketmagan xato — o'chdi");
  assert.ok(store.getPost(d.id), "asl matni yuborilgan — qoldi («📞 Telefon qilish» raqamni matndan o'qiydi)");
  const kept = store.listPosts({ status: "skipped" }).items;
  assert.deepEqual(kept.map((p) => p.id).sort(), [b.id, d.id].sort(), "yuki bor (b) va yuborilgani (d) — o'tkazib yuborildi");
  assert.equal(kept[0].error, "Xato (tozalangan): 503");
  assert.deepEqual(store.clearFailed(), { deleted: 0, hidden: 0 });
});

test("manbalar: bir marta .env dan, qo'shish, o'chirish, statistika", () => {
  const { store } = fixture();
  assert.equal(store.seedSources(["@a", "@b"]), 2);
  assert.equal(store.seedSources(["@c"]), 0, "jadval bo'sh bo'lmasa, .env qayta yozilmaydi");
  assert.equal(store.addSource("@a"), false);
  assert.equal(store.addSource("@c", { note: "yangi" }), true);
  store.setSourceEnabled("@b", false);
  store.removeSource("@c");
  assert.deepEqual(store.listSources().map((s) => [s.name, s.enabled]), [["@a", true], ["@b", false]]);
  const stats = store.sourceStats();
  assert.deepEqual(stats["@a"], { posts: 1, duplicates: 0, loads: 1, lastPostAt: stats["@a"].lastPostAt, live: 0, delaySec: 60 });
  assert.equal(stats["@b"].duplicates, 1);
});

test("manbalar: a'zolik (jonli) va qanday kelgani — via, o'rtacha kechikish", () => {
  const { store } = fixture();
  store.addSource("@a");
  store.addSource("@b");
  assert.equal(store.listSources()[0].joined, null, "collector hali tekshirmagan");
  assert.equal(store.setSourceMembership("@a", true), true);
  store.setSourceMembership("@b", false);
  assert.equal(store.setSourceMembership("@yoq", true), false, "ro'yxatda yo'q manba");
  assert.deepEqual(store.listSources().map((s) => [s.name, s.joined, typeof s.checkedAt]), [["@a", true, "number"], ["@b", false, "number"]]);

  const live = store.addPost({ source: "@a", messageId: 7, text: "Andijondan Toshkentga 10 t isuzu kerak", postedAt: 100 * HOUR - 2_000, via: "live" });
  assert.equal(store.db.prepare("SELECT via FROM posts WHERE id = ?").get(live.id).via, "live");
  store.addPost({ source: "@a", messageId: 8, text: "Collector to'xtab turganda yozilgan eski e'lon", postedAt: 100 * HOUR - 3 * HOUR });
  // Kompyuter soati Telegram'dan 2 s orqada: «kelajakda joylangan» — 0 s
  store.addPost({ source: "@a", messageId: 9, text: "Qo'qondan Toshkentga 5 t isuzu kerak bugun", postedAt: 100 * HOUR + 2_000, via: "live" });
  const stats = store.sourceStats()["@a"];
  assert.equal(stats.live, 2);
  assert.equal(stats.delaySec, 21, "(60 + 2 + 0) / 3; 3 soat kechikkan eski e'lon hisobga olinmaydi");
});

test("manbalar: collector navbati (oraliq, kuzatish usuli) va guruh faolligi", () => {
  const { store } = fixture();
  store.addSource("@a");
  assert.deepEqual([store.listSources()[0].pollMs, store.listSources()[0].watch], [null, null], "collector hali yozmagan");
  assert.equal(store.setSourceSchedule("@a", { pollMs: 25_000, watch: "poll" }), true);
  assert.equal(store.setSourceSchedule("@yoq", { pollMs: 1, watch: "tops" }), false);
  assert.deepEqual([store.listSources()[0].pollMs, store.listSources()[0].watch], [25_000, "poll"]);

  // Faollik guruhda yozilgan vaqt bo'yicha (posted_at): 3 soatdan eski e'lon faqat kunlikka kiradi, takror ham sanaladi
  store.addPost({ source: "@a", messageId: 8, text: "Collector to'xtab turganda yozilgan eski e'lon", postedAt: 100 * HOUR - 4 * HOUR });
  assert.deepEqual(store.sourceActivity(), { "@a": { recent: 1, day: 2 }, "@b": { recent: 2, day: 2 } });
});

test("manbalar: a'zo bo'lish navbati va kunlik hisob", () => {
  const { store, advance } = fixture();
  for (const n of ["@a", "@b", "@c"]) store.addSource(n);
  assert.equal(store.requestJoin("@yoq"), null);
  assert.equal(store.requestJoin("@a"), "wanted");
  assert.equal(store.cancelJoin("@a"), true);
  assert.equal(store.cancelJoin("@a"), false, "navbatda emas");
  store.setSourceMembership("@b", true);
  assert.equal(store.requestJoin("@b"), "joined", "akkaunt allaqachon a'zo");
  store.requestJoin("@a");
  store.setJoinState("@a", "joined");
  store.setJoinState("@c", "error", { error: "CHANNEL_PRIVATE" });
  assert.equal(store.requestJoin("@c"), "wanted", "xatodan keyin qayta navbatga");
  assert.deepEqual(store.listSources().map((s) => [s.name, s.joinState, s.joinError]), [["@a", "joined", null], ["@b", null, null], ["@c", "wanted", null]]);
  assert.equal(store.joinsSince(0), 1);
  advance(25 * HOUR);
  assert.equal(store.joinsSince(100 * HOUR + HOUR), 0, "24 soatdan eskisi sanalmaydi");
});

test("ko'rsatkichlar: navbat, oxirgi soat, kechikish, soatma-soat", () => {
  const { store, advance } = fixture();
  const m = store.metrics();
  assert.equal(m.queue.waiting, 1);
  assert.equal(m.lastHour.posts, 2);
  assert.equal(m.lastHour.duplicates, 1);
  assert.equal(m.lastHour.processed, 1);
  assert.equal(m.lastHour.loads, 2);
  assert.equal(m.lastHour.medianDelayMin, 1);
  assert.equal(m.hourly.posts.length, 24);
  assert.equal(m.hourly.posts.at(-1), 2);
  advance(2 * HOUR);
  const later = store.metrics();
  assert.equal(later.hourly.posts.at(-3), 2, "ikki soat oldingi ustunga o'tdi");
  assert.equal(later.lastHour.posts, 0);
  assert.equal(later.queue.oldestWaitingMin, 122);
});

test("bitta nusxa: ishlayotgan PID bo'lsa ikkinchisi ochilmaydi, o'lik PID'ning fayli e'tiborsiz", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-lock-"));
  const release = acquireRunLock("bot", { dir });
  assert.equal(readRunLock("bot", { dir }).pid, process.pid);
  assert.doesNotThrow(() => acquireRunLock("bot", { dir }), "o'z PID'i — xato emas");
  writeFileSync(path.join(dir, "collector.json"), JSON.stringify({ pid: process.ppid, startedAt: 0 }));
  assert.throws(() => acquireRunLock("collector", { dir }), (e) => e.code === "ALREADY_RUNNING");
  writeFileSync(path.join(dir, "collector.json"), JSON.stringify({ pid: 999_999_9, startedAt: 0 }));
  assert.doesNotThrow(() => acquireRunLock("collector", { dir }));
  release();
  assert.equal(readRunLock("bot", { dir }), null);
});

// 2026-11-09: majburan o'ldirilgan botning fayli qolgan, Windows PID'ni `npm start` ga bergan — bot yoqilmay qolgan edi
test("yurak urishi: PID boshqa jarayonga o'tgan eski fayl — tirik emas (stale)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-lock-"));
  const file = path.join(dir, "bot.json");
  const old = new Date(Date.now() - 60_000);
  // process.ppid — tirik jarayon, lekin fayl 60 s yangilanmagan (urish 10 s): egasi o'lgan
  writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: 0, beatMs: 10_000 }));
  utimesSync(file, old, old);
  assert.deepEqual([readRunLock("bot", { dir }).alive, readRunLock("bot", { dir }).stale], [false, true]);
  assert.doesNotThrow(() => acquireRunLock("bot", { dir, beatMs: 30 })(), "eskirgan faylni egallaydi");

  // Yangi urilgan — tirik, ikkinchi nusxa ochilmaydi
  writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: 0, beatMs: 10_000 }));
  assert.deepEqual([readRunLock("bot", { dir }).alive, readRunLock("bot", { dir }).stale], [true, false]);
  assert.throws(() => acquireRunLock("bot", { dir }), (e) => e.code === "ALREADY_RUNNING");
  assert.equal(readRunLock("bot", { dir, now: Date.now() + 41_000 }).alive, false, "40 s dan keyin — eskirgan");

  // Yurak urishisiz eski format — avvalgidek faqat PID
  writeFileSync(file, JSON.stringify({ pid: process.ppid, startedAt: 0 }));
  utimesSync(file, old, old);
  assert.equal(readRunLock("bot", { dir }).alive, true);
});

test("yurak urishi: egasi fayl vaqtini yangilab turadi, o'chirilsa qayta yozadi", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-lock-"));
  const file = path.join(dir, "collector.json");
  const release = acquireRunLock("collector", { dir, beatMs: 30 });
  assert.equal(readRunLock("collector", { dir }).beatMs, 30);
  const old = new Date(Date.now() - 60_000);
  utimesSync(file, old, old);
  assert.equal(readRunLock("collector", { dir }).alive, false);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(statSync(file).mtimeMs > old.getTime() + 30_000, "urish fayl vaqtini yangiladi");
  assert.equal(readRunLock("collector", { dir }).alive, true);
  removeRunLock("collector", { dir, pid: 12345 });
  assert.ok(readRunLock("collector", { dir }), "boshqa PID nomidan o'chirilmaydi");
  removeRunLock("collector", { dir });
  assert.equal(readRunLock("collector", { dir }), null);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(readRunLock("collector", { dir }).pid, process.pid, "biz hali ishlayapmiz — fayl qayta yozildi");
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readRunLock("collector", { dir }), null, "release'dan keyin urish to'xtaydi");
});
