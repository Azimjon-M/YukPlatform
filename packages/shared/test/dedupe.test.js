import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeduper, loadKey, loadKeys } from "../src/index.js";

const PHONE_A = "+998900000001";
const PHONE_B = "+998900000002";
const load = (extra = {}) => ({
  fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand",
  bodyType: "tent", weightT: 20, price: 3800000, cargo: "sement", phones: [PHONE_A], ...extra,
});

test("narx, yuk nomi, yozilishi farq qilsa ham — o'sha yuk", () => {
  assert.equal(loadKey(load()), loadKey(load({ price: 4000000, cargo: "tsement" })));
  assert.equal(loadKey(load()), loadKey(load({ fromCity: "TOSHKENT", phones: ["998 90 000 00 01"] })));
  assert.equal(loadKey(load({ phones: [PHONE_A, PHONE_B] })), loadKey(load({ phones: [PHONE_B, PHONE_A] })));
});

test("boshqa telefon, yo'nalish, kuzov yoki og'irlik — boshqa yuk", () => {
  const base = loadKey(load());
  assert.notEqual(base, loadKey(load({ phones: [PHONE_B] })));
  assert.notEqual(base, loadKey(load({ toCity: "Buxoro", toRegion: "buxoro" })));
  assert.notEqual(base, loadKey(load({ bodyType: "ref" })));
  assert.notEqual(base, loadKey(load({ weightT: 10 })));
});

test("faqat viloyat yozilgan yuk ham kalit oladi", () => {
  assert.match(loadKey(load({ fromCity: null, fromRegion: "surxondaryo" })), /\|surxondaryo\|/);
});

test("bitta e'londagi ikki bir xil yuk alohida, qayta tashlansa — takror", () => {
  const post = [load({ bodyType: "ploshatka" }), load({ bodyType: "ploshatka" }), load()];
  const keys = loadKeys(post);
  assert.equal(new Set(keys).size, 3);
  const deduper = createDeduper({ now: () => 0 });
  assert.equal(deduper.fresh(post).length, 3);
  assert.equal(deduper.fresh(post).length, 0, "boshqa guruhga tashlangan o'sha e'lon");
  assert.equal(deduper.fresh([...post, load({ toCity: "Jizzax", toRegion: "jizzax" })]).length, 1);
});

test("muddat o'tgach kalit unutiladi", () => {
  const deduper = createDeduper({ windowMs: 1000 });
  const key = loadKey(load());
  assert.equal(deduper.isNew(key, 0), true);
  assert.equal(deduper.isNew(key, 999), false);
  assert.equal(deduper.isNew(key, 2001), true, "1 soniyadan keyin yana yangi");
  assert.equal(deduper.size, 1);
});
