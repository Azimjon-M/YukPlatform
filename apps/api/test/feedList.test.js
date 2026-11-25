import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createFeedList } from "../src/feedList.js";

const NOW = 1_800_000_000_000;
const LOAD = "Toshkentdan Samarqandga 20 tonna yuk bor, fura kerak. +998 90 000 00 01";

function setup() {
  const store = openStore({ file: ":memory:", now: () => NOW });
  let id = 0;
  const add = (source, text, ago = 60_000, extra = {}) =>
    store.addPost({ source, messageId: ++id, link: source.startsWith("@") ? `https://t.me/${source.slice(1)}/${id}` : null, text, postedAt: NOW - ago, ...extra });
  return { store, add, feed: createFeedList({ store, now: () => NOW }) };
}

const driver = (feed, extra = {}) => ({ chatId: 7, role: "haydovchi", plan: "free", profile: { feed }, ...extra });

test("lenta: botdagidek asl e'lonlar — so'nggi 10 daqiqa, quruq gap yo'q, eng yangisi birinchi", () => {
  const { add, feed } = setup();
  add("@yuk_aaa", LOAD, 20 * 60_000); // eski
  add("@yuk_aaa", "Assalomu alaykum hammaga", 60_000); // quruq gap
  add("@yuk_aaa", LOAD.replace("01", "02"), 120_000);
  add("@yuk_bbb", "Farg'onadan Toshkentga 5 tonna yuk bor, isuzu kerak. +998 90 000 00 03", 30_000);
  const out = feed.list(driver({ mode: "tezkor", sources: [] }));
  assert.equal(out.total, 2);
  assert.match(out.items[0].post.text, /Farg'onadan/);
  assert.equal(out.items[0].post.link, "https://t.me/yuk_bbb/4");
  assert.deepEqual(out.items[0].load.phones.length, 1);
  assert.equal(out.items[1].load.fromRegion, "toshkent_sh");
});

test("lenta: «📌 Mening guruhlarim», «📍 Qayerdan» filtri va yopiq guruh faqat Pro'ga", () => {
  const { add, feed } = setup();
  add("@yuk_aaa", LOAD, 60_000);
  add("@yuk_bbb", "Farg'onadan Toshkentga 5 tonna yuk bor, isuzu kerak. +998 90 000 00 03", 30_000);
  add("-1001", "Andijondan Toshkentga 10 tonna yuk bor. +998 90 000 00 04", 10_000);
  assert.deepEqual(feed.list(driver({ mode: "guruhlarim", sources: ["@yuk_bbb"] })).items.map((i) => i.post.source), ["@yuk_bbb"]);
  assert.deepEqual(feed.list(driver({ mode: "tezkor", sources: [], regions: ["toshkent_sh"] })).items.map((i) => i.post.source), ["@yuk_aaa"]);
  assert.deepEqual(feed.list(driver({ mode: "tezkor", sources: [] })).items.map((i) => i.post.source), ["@yuk_bbb", "@yuk_aaa"]);
  assert.deepEqual(feed.list(driver({ mode: "tezkor", sources: [] }, { plan: "pro" })).items.map((i) => i.post.source), ["-1001", "@yuk_bbb", "@yuk_aaa"]);
});

test("lenta: ilova pauzada — bo'sh, active: false; bot pauzasi lentaga ta'sir qilmaydi", () => {
  const { add, feed } = setup();
  add("@yuk_aaa", LOAD, 60_000);
  assert.equal(feed.list(driver({ mode: "tezkor", sources: [] }, { active: false })).total, 1, "bot pauzada — ilova lentasi ishlaydi");
  assert.deepEqual(feed.list(driver({ mode: "tezkor", sources: [] }, { appActive: false })), { minutes: 10, active: false, total: 0, items: [] });
  assert.equal(feed.list(driver({ mode: "tezkor", sources: [] })).active, true);
});
