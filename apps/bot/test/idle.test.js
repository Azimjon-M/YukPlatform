import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { openStore } from "@yuk/store";
import { IDLE_BUTTONS, createIdleWatcher, idlePausedText, idleWarningText } from "../src/idle.js";

const HOUR = 60 * 60 * 1000;
const TRUCK = { vehicle: { truckClass: "fura" }, fromAreas: [], toAreas: [], routeAt: 1 };

function setup({ fail } = {}) {
  let time = 100 * HOUR;
  const clock = { now: () => time, advance: (ms) => (time += ms) };
  const store = openStore({ file: ":memory:", now: clock.now });
  const sent = [];
  const api = {
    async sendMessage(chatId, text, other) {
      if (fail?.(chatId)) {
        throw new GrammyError("403", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {});
      }
      sent.push({ chatId, text, buttons: other.reply_markup.inline_keyboard.flat().map((b) => b.callback_data) });
    },
  };
  const watcher = createIdleWatcher({ store, api, log: () => {}, now: clock.now });
  return { store, clock, sent, watcher };
}

test("24 soat kirmasa — ogohlantirish (bir marta), 48 soatda — pauza va xabar", async () => {
  const { store, clock, sent, watcher } = setup();
  store.saveDriver(42, { name: "Ali", role: "haydovchi", profile: TRUCK, active: true });
  store.touchDriver(42, "bot");

  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 0 });
  assert.equal(Number(store.getSetting("idle_since")), 100 * HOUR, "kuzatuv birinchi tekshiruvdan boshlanadi");

  clock.advance(23 * HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 0 });
  clock.advance(HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 1, paused: 0 });
  assert.deepEqual(sent.map((m) => [m.chatId, m.buttons]), [[42, [IDLE_BUTTONS.ok]]]);
  assert.match(sent[0].text, /Bir kundan beri kirmadingiz\. Yuklar kelaversinmi\?[\s\S]*ertaga/);
  assert.equal(store.getDriver(42).idleWarnedAt, 124 * HOUR);

  clock.advance(10 * 60 * 1000);
  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 0 }, "ikkinchi marta ogohlantirmaydi");

  clock.advance(24 * HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 1 });
  const user = store.getDriver(42);
  assert.deepEqual([user.active, user.pausedBy], [false, "idle"]);
  assert.equal(store.activeUsers("haydovchi").length, 0, "endi yuk bormaydi");
  assert.match(sent.at(-1).text, /2 kundan beri kirmaganingiz uchun yuklar yuborish to'xtatildi/);
  assert.deepEqual(sent.at(-1).buttons, [IDLE_BUTTONS.resume]);

  clock.advance(48 * HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 0 }, "pauzadagiga boshqa xabar yo'q");
});

test("ogohlantirishdan keyin botga kirsa — pauza bo'lmaydi, soat qaytadan", async () => {
  const { store, clock, sent, watcher } = setup();
  store.saveDriver(42, { role: "haydovchi", profile: TRUCK, active: true });
  store.touchDriver(42, "bot");
  await watcher.runOnce();
  clock.advance(24 * HOUR);
  await watcher.runOnce();
  assert.equal(sent.length, 1);

  clock.advance(2 * HOUR);
  store.touchDriver(42, "web"); // web'ni ochdi
  clock.advance(22 * HOUR + 1);
  assert.deepEqual(await watcher.runOnce(), { warned: 0, paused: 0 });
  assert.equal(store.getDriver(42).active, true);
  clock.advance(2 * HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 1, paused: 0 }, "kirganidan 24 soat o'tib — yangi ogohlantirish");
});

test("yuk beruvchiga — «bo'sh mashinalar»; botni bloklagan — pauza (bloklagan), o'chirgan va pauzadagiga — hech narsa", async () => {
  const { store, clock, sent, watcher } = setup({ fail: (chatId) => chatId === 8 });
  store.saveDriver(7, { role: "yuk_beruvchi", profile: { fromAreas: [], truckClasses: [] }, active: true });
  store.saveDriver(8, { role: "haydovchi", profile: TRUCK, active: true });
  store.saveDriver(9, { role: "haydovchi", profile: TRUCK, active: false });
  store.saveDriver(10, { role: "haydovchi", profile: TRUCK, active: true });
  store.deleteDriver(10);
  await watcher.runOnce();
  clock.advance(25 * HOUR);
  assert.deepEqual(await watcher.runOnce(), { warned: 1, paused: 0 });
  assert.deepEqual(sent.map((m) => m.chatId), [7]);
  assert.match(sent[0].text, /bo'sh mashinalar/i);
  assert.deepEqual([store.getDriver(8).active, store.getDriver(8).pausedBy, store.getDriver(8).idleWarnedAt], [false, "blocked", null]);
});

test("xabar matnlari", () => {
  assert.match(idleWarningText({ role: "haydovchi", profile: TRUCK }), /Yuklar kelaversinmi/);
  assert.match(idlePausedText({ role: "yuk_beruvchi", profile: {} }), /bo'sh mashinalar yuborish to'xtatildi[\s\S]*tugmani bosing/);
});
