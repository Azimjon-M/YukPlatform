// Yuk beruvchining o'z yuki: navbatga tushishi, kunlik limit, qoralama, raqamlar, butunlay o'chirish. Raqamlar soxta
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.js";

const HOUR = 3_600_000;
const LOAD = { fromRegion: "andijon", toRegion: "toshkent_sh", weightT: 20, phones: ["+998900000001"] };

test("yuk beruvchi yuki: navbatga tayyor yuk bilan tushadi, raqami 1, 2, ...; AI uni eskirgan deb yopmaydi", () => {
  let time = 100 * HOUR;
  const store = openStore({ file: ":memory:", now: () => time });
  store.saveDriver(7, { name: "Ali", role: "yuk_beruvchi" });
  const first = store.addDirectPost({ chatId: 7, text: "Andijondan Toshkentga 20 tonna", loads: [LOAD], via: "bot", sender: "ali_yuk" });
  const second = store.addDirectPost({ chatId: 7, text: "Andijondan Toshkentga 20 tonna", loads: [LOAD], via: "web" });
  const [a, b] = store.takeNewPosts(10);
  assert.equal(a.id, first.id);
  assert.equal(a.source, "shipper:7");
  assert.equal(a.messageId, 1);
  assert.equal(b.messageId, 2, "bir xil matn — takror deb tashlanmaydi");
  assert.equal(a.shipper, 7);
  assert.deepEqual(a.direct, [LOAD]);
  assert.equal(a.sender, "ali_yuk");
  assert.equal(a.via, "bot");
  assert.equal(a.link, null);
  assert.equal(second.id, b.id);
  // Oddiy e'londa — yo'q
  store.addPost({ source: "@g", messageId: 1, text: "Toshkentdan Samarqandga yuk bor", postedAt: time - 5 * HOUR });
  assert.equal(store.takeNewPosts(10, { newest: false })[2].direct, null);
  time += 5 * HOUR;
  assert.equal(store.expireOldPosts({ before: time - 3 * HOUR, error: "Eskirgan" }), 1, "faqat guruhdagi e'lon");
  assert.equal(store.takeNewPosts(10).length, 2);

  assert.equal(store.shipperPostCount(7), 2);
  time += 20 * HOUR;
  assert.equal(store.shipperPostCount(7), 0, "24 soatdan eskisi sanalmaydi");
  store.finishPost(first.id, "done", null, "shipper");
  assert.deepEqual(
    store.shipperPosts(7).map((p) => [p.id, p.via, p.status]),
    [[second.id, "web", "new"], [first.id, "bot", "done"]],
  );
});

test("qoralama va oxirgi raqamlar; butunlay o'chirishda yuborgan yuklari ham o'chadi", () => {
  const store = openStore({ file: ":memory:" });
  store.saveDriver(7, { role: "yuk_beruvchi" });
  assert.equal(store.loadDraft(7), null);
  store.setLoadDraft(7, { text: "yuk", loads: [LOAD], stage: "confirm" });
  assert.deepEqual(store.loadDraft(7).loads, [LOAD]);
  store.setLoadDraft(7, null);
  assert.equal(store.loadDraft(7), null);
  assert.deepEqual(store.getDriver(7).loadPhones, []);
  store.setLoadPhones(7, ["+998900000001"]);
  assert.deepEqual(store.getDriver(7).loadPhones, ["+998900000001"]);

  const { id } = store.addDirectPost({ chatId: 7, text: "yuk", loads: [LOAD] });
  const loadId = store.addLoad({ postId: id, key: "k", load: LOAD });
  store.addDelivery({ loadId, chatId: 8, ok: true });
  store.addPost({ source: "@g", messageId: 1, text: "boshqa e'lon" });
  assert.equal(store.purgeDriver(7), true);
  assert.equal(store.shipperPosts(7).length, 0);
  assert.equal(store.getLoad(loadId), null);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 1, "boshqa e'lonlarga tegilmaydi");
});
