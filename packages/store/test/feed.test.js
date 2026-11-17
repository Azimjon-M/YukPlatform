import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.js";

function setup() {
  let time = Date.UTC(2026, 10, 14, 8, 0);
  const store = openStore({ file: ":memory:", now: () => time });
  return { store, tick: (ms) => (time += ms) };
}

const post = (source, messageId, text = "Toshkentdan Samarqandga 20 tonna tent kerak +998 90 000 00 01") => ({
  source,
  messageId,
  link: `https://t.me/${source.slice(1)}/${messageId}`,
  text: `${text} #${messageId}`,
  postedAt: Date.UTC(2026, 10, 14, 7, 59),
});

test("post_deliveries: kimga asl matn bilan ketgani, qo'ng'iroq belgisi, butunlay o'chirishda o'chadi", () => {
  const { store } = setup();
  const { id } = store.addPost(post("@TutGruz", 1));
  store.saveDriver(10, { name: "A" });
  store.addPostDelivery({ postId: id, chatId: 10, ok: true });
  store.addPostDelivery({ postId: id, chatId: 11, ok: false, error: "Forbidden" });
  assert.deepEqual(store.postDeliveredTo(id), [10]);
  assert.equal(store.markPostCalled({ postId: id, chatId: 10 }), true);
  assert.equal(store.markPostCalled({ postId: id, chatId: 10 }), false, "faqat birinchi bosilgani");
  assert.equal(store.getPost(id).source, "@TutGruz");
  assert.equal(store.getPost(9999), null);
  const row = store.listDrivers().find((d) => d.chatId === 10);
  assert.deepEqual({ ...row.rawDeliveries, lastAt: null }, { today: 1, total: 1, lastAt: null, called: 1 });
  assert.equal(store.driverDetails(10).rawDeliveries[0].source, "@TutGruz");
  store.purgeDriver(10);
  assert.deepEqual(store.postDeliveredTo(id), []);
});

test("feedSources: ochiq va yopiq guruhlar; yopig'ini Pro yoki o'zi qo'shgan tanlaydi, boshqaga — locked; o'chirilgan va tekshiruvdan o'tmaganlar yo'q", () => {
  const { store } = setup();
  store.addSource("@TutGruz");
  store.addSource("@Sokin_guruh");
  store.addSource("@Ochiq_emas", { enabled: false });
  store.addSource("-1001111111", { account: "u1-1", title: "Begona yopiq" });
  store.addUserSource({ name: "-1002222222", chatId: 10, title: "O'z yopig'im", account: "u1-1" });
  store.finishProbe("-1002222222", { ok: true, note: "", stats: {} });
  store.addUserSource({ name: "@Rad_etilgan", chatId: 10 });
  store.finishProbe("@Rad_etilgan", { ok: false, note: "kam", stats: {} });
  for (let i = 1; i <= 3; i++) store.addPost(post("@tutgruz", i)); // harfi boshqacha (bot o'zi admin bo'lgan guruh)
  const list = store.feedSources(10);
  assert.deepEqual(list.map((s) => s.name), ["-1002222222", "@TutGruz", "-1001111111", "@Sokin_guruh"]);
  assert.equal(list[1].perDay, 3);
  assert.deepEqual([list[0].mine, list[0].closed, list[0].locked], [true, true, false], "o'zi qo'shgan yopiq — tanlay oladi");
  assert.deepEqual([list[2].closed, list[2].locked], [true, true], "begona yopiq, Pro emas — locked");
  assert.equal(list[1].locked, false);
  // Pro — hamma yopiq guruhni tanlaydi
  assert.ok(store.feedSources(20, { pro: true }).every((s) => !s.locked));
  assert.deepEqual(store.allowedFeedSources(20, ["@tutgruz", "-1002222222", "@Ochiq_emas", "@TutGruz"]), ["@TutGruz"], "Pro emas — yopiq tashlanadi");
  assert.deepEqual(store.allowedFeedSources(20, ["@tutgruz", "-1001111111"], { pro: true }), ["@TutGruz", "-1001111111"]);
  assert.deepEqual(store.allowedFeedSources(10, ["-1002222222", "-1001111111"]), ["-1002222222"], "o'zi qo'shgani — Pro'siz ham");
  assert.equal(store.sourceTitles()["-1002222222"], "O'z yopig'im");
});
