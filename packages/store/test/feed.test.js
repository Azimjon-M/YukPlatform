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

test("feedSources: ochiq va yopiq guruhlar; yopig'ini Pro yoki o'zi qo'shgan ko'radi, boshqaga ko'rinmaydi; o'chirilgan va tekshiruvdan o'tmaganlar yo'q", () => {
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
  // 2026-11-19: begona yopiq guruh (-1001111111) oddiy foydalanuvchiga umuman ko'rinmaydi
  assert.deepEqual(list.map((s) => s.name), ["-1002222222", "@TutGruz", "@Sokin_guruh"]);
  assert.equal(list[1].perDay, 3);
  assert.deepEqual([list[0].mine, list[0].closed, list[0].locked], [true, true, false], "o'zi qo'shgan yopiq — tanlay oladi");
  assert.equal(list[1].locked, false);
  assert.deepEqual(store.feedSources(20).map((s) => s.name), ["@TutGruz", "@Sokin_guruh"], "begona — faqat ochiqlar");
  // Pro — hamma yopiq guruhni ko'radi va tanlaydi
  const pro = store.feedSources(20, { pro: true });
  assert.deepEqual(pro.map((s) => s.name).sort(), ["-1001111111", "-1002222222", "@Sokin_guruh", "@TutGruz"]);
  assert.ok(pro.every((s) => !s.locked));
  assert.deepEqual(store.allowedFeedSources(20, ["@tutgruz", "-1002222222", "@Ochiq_emas", "@TutGruz"]), ["@TutGruz"], "Pro emas — yopiq tashlanadi");
  assert.deepEqual(store.allowedFeedSources(20, ["@tutgruz", "-1001111111"], { pro: true }), ["@TutGruz", "-1001111111"]);
  assert.deepEqual(store.allowedFeedSources(10, ["-1002222222", "-1001111111"]), ["-1002222222"], "o'zi qo'shgani — Pro'siz ham");
  assert.equal(store.sourceTitles()["-1002222222"], "O'z yopig'im");
});

test("feedSources own: o'z Telegram akkaunti a'zo bo'lgan guruh/kanal (id yoki @username bo'yicha) va o'zi qo'shgani — 👤 Akkauntimdagi", () => {
  const { store } = setup();
  store.addSource("@TutGruz");
  store.addSource("@Mening_kanalim");
  store.addSource("-1003333333", { account: "u9-1", title: "A'zo yopiq guruhim" });
  store.saveDriver(10, { name: "A", role: "haydovchi" });
  store.setTgAccountOwner("u9-1", 10);
  store.setTgDialogs("u9-1", [
    { id: "-1003333333", title: "A'zo yopiq guruhim", type: "supergroup" },
    { id: "-1004444444", title: "Kanalim", username: "mening_kanalim", type: "channel" },
  ]);
  const own = (chatId, opts) => Object.fromEntries(store.feedSources(chatId, opts).map((s) => [s.name, s.own]));
  assert.deepEqual(own(10, { pro: true }), { "@TutGruz": false, "@Mening_kanalim": true, "-1003333333": true });
  assert.deepEqual(own(20, { pro: true }), { "@TutGruz": false, "@Mening_kanalim": false, "-1003333333": false }, "begonada own yo'q");
});

test("feedSources members: sources dagi soni, bo'lmasa akkauntlarimiz guruhlar ro'yxatidagi (tg_dialogs) eng kattasi", () => {
  const { store } = setup();
  store.addSource("@TutGruz");
  store.addSource("@Sanoqli");
  store.setTgDialogs("u1-1", [{ id: "-1005", title: "Tut", username: "tutgruz", type: "supergroup", members: 1340 }]);
  store.setTgDialogs("u2-1", [{ id: "-1005", title: "Tut", username: "TutGruz", type: "supergroup", members: 1500 }]);
  const byName = Object.fromEntries(store.feedSources(10).map((s) => [s.name, s.members]));
  assert.deepEqual(byName, { "@TutGruz": 1500, "@Sanoqli": null });
});
