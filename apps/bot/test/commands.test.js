// «Menu» tugmasi (buyruqlar ro'yxati) — faqat rol tanlaganlarda. Soxta Telegram: so'rovlar faqat yoziladi
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { openStore } from "@yuk/store";
import { COMMANDS, createCommandSync } from "../src/commands.js";

function setup({ fail = () => false, defaults = [] } = {}) {
  const store = openStore({ file: ":memory:" });
  const calls = [];
  const api = {
    async setMyCommands(commands, options) {
      calls.push(["set", options.scope.chat_id]);
      if (fail(options.scope.chat_id)) throw new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "setMyCommands", {});
      return true;
    },
    async deleteMyCommands(options) {
      calls.push(["delete", options?.scope?.chat_id ?? "default"]);
      return true;
    },
    async getMyCommands() {
      return defaults;
    },
  };
  const sync = createCommandSync({ api, store, log: () => {}, sleep: async () => {} });
  return { store, calls, sync };
}

test("rol tanlaganning chatiga buyruqlar qo'yiladi, rolsizga — yo'q; rol olinsa — olib tashlanadi", async () => {
  const { store, calls, sync } = setup();
  store.saveDriver(1, { name: "Rolsiz" });
  store.saveDriver(2, { name: "Haydovchi", role: "haydovchi" });
  store.saveDriver(3, { name: "Eski", profile: { vehicle: { truckClass: "fura" } } }); // eski qator: profil bor, rol yo'q
  assert.equal(await sync.sweep(), 2);
  assert.deepEqual(calls, [["set", 2], ["set", 3]]);
  assert.equal(await sync.sweep(), 0, "ikkinchi marta — hech narsa (bazada yozilgan)");

  // Rolsiz odam rol tanladi — botdagi xabardan keyin darhol (sync)
  calls.length = 0;
  store.saveDriver(1, { role: "yuk_beruvchi" });
  await sync.sync(1);
  await sync.sync(1);
  assert.deepEqual(calls, [["set", 1]]);

  // Web'dan hisobdan chiqdi / hisobini o'chirdi — har daqiqadagi tekshiruv olib tashlaydi
  calls.length = 0;
  store.signOut(2);
  store.deleteDriver(1, { via: "web" });
  await sync.sweep();
  assert.deepEqual(calls.sort(), [["delete", 1], ["delete", 2]]);
});

test("Telegram rad etsa — qayta-qayta urinmaydi; umumiy ro'yxat faqat bor bo'lsa olib tashlanadi", async () => {
  const { store, calls, sync } = setup({ fail: (chatId) => chatId === 5, defaults: COMMANDS });
  store.saveDriver(5, { role: "haydovchi" });
  assert.equal(await sync.sweep(), 1);
  assert.equal(await sync.sweep(), 0);
  assert.deepEqual(calls, [["set", 5]]);

  assert.equal(await sync.dropDefault(), true);
  assert.deepEqual(calls.at(-1), ["delete", "default"]);
  const empty = setup();
  assert.equal(await empty.sync.dropDefault(), false);
  assert.deepEqual(empty.calls, []);
});

test("ro'yxatga yangi buyruq qo'shilsa (/guruh_qoshish) — ishga tushganda allaqachon o'rnatilgan chatlarga ham qaytadan qo'yiladi", async () => {
  const { store, calls, sync } = setup();
  assert.ok(COMMANDS.some((c) => c.command === "guruh_qoshish"), "menyudagi «➕ Guruh qo'shish» buyrug'i");
  store.saveDriver(2, { role: "haydovchi" });
  store.saveDriver(3, { name: "Rolsiz" });
  await sync.sweep();
  assert.deepEqual(calls, [["set", 2]]);

  // Avvalgi versiyada qo'yilgan ro'yxat bazada yozilmagan (yoki boshqacha) — hammasi yangilanadi, rolsizga tegilmaydi
  calls.length = 0;
  assert.equal(sync.renewIfChanged(), 1);
  await sync.sweep();
  assert.deepEqual(calls, [["set", 2]]);

  // Ro'yxat o'zgarmagan — keyingi ishga tushishda hech narsa
  calls.length = 0;
  assert.equal(sync.renewIfChanged(), 0);
  assert.equal(await sync.sweep(), 0);
  assert.deepEqual(calls, []);
});
