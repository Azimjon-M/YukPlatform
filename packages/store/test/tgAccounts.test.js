import { test } from "node:test";
import assert from "node:assert/strict";
import { MAIN_TG_ACCOUNT, openStore, TG_ACCOUNT_NAME } from "../src/index.js";

const fresh = () => {
  const clock = { t: 1_000 };
  return { clock, store: openStore({ file: ":memory:", now: () => clock.t }) };
};

test("akkaunt nomi: kichik lotin harflari, raqam, _ -; asosiy — «asosiy»", () => {
  assert.equal(MAIN_TG_ACCOUNT, "asosiy");
  for (const name of ["ikkinchi", "dost_1", "a2", "haydovchi-guruh"]) assert.ok(TG_ACCOUNT_NAME.test(name), name);
  for (const name of ["", "a", "Ikkinchi", "1akk", "../x", "nom bilan", "a".repeat(21)]) assert.ok(!TG_ACCOUNT_NAME.test(name), name);
});

test("saveTgAccount: kim va holati; berilmagan maydon o'zgarmaydi; asosiy ro'yxatda birinchi", () => {
  const { clock, store } = fresh();
  store.saveTgAccount("ikkinchi", { userId: 222, username: "ikki", firstName: "Ikki", status: "ok" });
  store.saveTgAccount(MAIN_TG_ACCOUNT, { userId: 111, username: null, firstName: "Asosiy", status: "ok" });
  clock.t = 2_000;
  store.saveTgAccount("ikkinchi", { status: "error", error: "ulanib bo'lmadi" });
  const [main, second] = store.listTgAccounts();
  assert.equal(main.name, "asosiy");
  assert.deepEqual(
    [second.name, second.userId, second.username, second.firstName, second.status, second.error, second.updatedAt, second.dialogs],
    ["ikkinchi", "222", "ikki", "Ikki", "error", "ulanib bo'lmadi", 2_000, 0],
  );
  store.saveTgAccount("ikkinchi", { status: "ok", error: null });
  assert.equal(store.listTgAccounts()[1].error, null);
});

test("setTgDialogs: ro'yxat butunlay almashtiriladi; findTgDialog — asosiy birinchi", () => {
  const { clock, store } = fresh();
  store.saveTgAccount("ikkinchi", { status: "ok" });
  store.saveTgAccount("asosiy", { status: "ok" });
  const yopiq = { id: "-1001234567", title: "Haydovchilar (yopiq)", username: null, type: "guruh", members: 80 };
  store.setTgDialogs("ikkinchi", [yopiq, { id: "-4001", title: "Kichik guruh", type: "guruh" }]);
  clock.t = 5_000;
  store.setTgDialogs("asosiy", [{ ...yopiq, members: 81 }]);
  assert.deepEqual(
    store.findTgDialog("-1001234567").map((d) => [d.account, d.members]),
    [["asosiy", 81], ["ikkinchi", 80]],
  );
  assert.equal(store.listTgAccounts().find((a) => a.name === "asosiy").dialogsAt, 5_000);
  store.setTgDialogs("ikkinchi", [{ id: "-4001", title: "Kichik guruh", type: "guruh" }]);
  assert.deepEqual(store.tgDialogs({ account: "ikkinchi" }).map((d) => d.peerId), ["-4001"], "chiqib ketgan guruh o'chdi");
  assert.equal(store.tgDialogs().length, 2);
});

test("ro'yxatni yangilash so'rovi: vaqti saqlanadi", () => {
  const { clock, store } = fresh();
  assert.equal(store.dialogsRefreshRequest(), null);
  clock.t = 7_000;
  assert.equal(store.requestDialogsRefresh(), 7_000);
  assert.equal(store.dialogsRefreshRequest(), 7_000);
});

test("manba qo'shimcha akkaunt bilan: account, nomi; a'zo bo'lish navbatiga tushmaydi; jonli belgi o'zgaradi", () => {
  const { store } = fresh();
  const before = store.changeMarks().sources;
  assert.ok(store.addSource("-1001234567", { account: "ikkinchi", title: "Haydovchilar", chatType: "group", members: 80 }));
  const row = store.listSources().find((s) => s.name === "-1001234567");
  assert.deepEqual([row.account, row.title, row.chatType, row.members], ["ikkinchi", "Haydovchilar", "group", 80]);
  assert.equal(store.requestJoin("-1001234567"), "account");
  assert.equal(row.joinState, null);
  store.addSource("@ochiq");
  assert.equal(store.listSources().find((s) => s.name === "@ochiq").account, null);
  assert.notEqual(store.changeMarks().sources, before);
  const marks = store.changeMarks().sources;
  store.saveTgAccount("ikkinchi", { status: "ok" });
  assert.notEqual(store.changeMarks().sources, marks, "akkaunt holati ham sahifani yangilaydi");
});
