import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireRunLock, openStore, readRunLock } from "../src/index.js";

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

test("navbat: holat bo'yicha, xatolini qayta navbatga qaytarish", () => {
  const { store, b } = fixture();
  assert.equal(store.listPosts({ status: "duplicate" }).total, 1);
  store.finishPost(b.id, "failed", "503");
  assert.equal(store.listPosts({ status: "failed" }).items[0].error, "503");
  assert.equal(store.retryFailed(b.id), 1);
  assert.equal(store.listPosts({ status: "new" }).items[0].id, b.id);
  assert.equal(store.retryFailed(), 0);
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
  assert.deepEqual(stats["@a"], { posts: 1, duplicates: 0, loads: 1, lastPostAt: stats["@a"].lastPostAt });
  assert.equal(stats["@b"].duplicates, 1);
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
