import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPhone, MAIN_TG_ACCOUNT, openStore, TG_ACCOUNT_NAME } from "../src/index.js";

const fresh = () => {
  const clock = { t: 1_000 };
  return { clock, store: openStore({ file: ":memory:", now: () => clock.t }) };
};

test("akkaunt nomi: kichik lotin harflari, raqam, _ -; asosiy — «asosiy»", () => {
  assert.equal(MAIN_TG_ACCOUNT, "asosiy");
  for (const name of ["ikkinchi", "dost_1", "a2", "haydovchi-guruh"]) assert.ok(TG_ACCOUNT_NAME.test(name), name);
  for (const name of ["", "a", "Ikkinchi", "1akk", "../x", "nom bilan", "a".repeat(21)]) assert.ok(!TG_ACCOUNT_NAME.test(name), name);
});

test("hashPhone: format farqi muhim emas, raqamsiz — null, raqamning o'zi chiqmaydi", () => {
  const h = hashPhone("+998 90 123-45-67");
  assert.equal(h, hashPhone("998901234567"), "bo'shliq/format bir xil xesh berishi kerak");
  assert.notEqual(h, hashPhone("+998901234568"), "boshqa raqam — boshqa xesh");
  assert.equal(hashPhone(""), null);
  assert.equal(hashPhone(null), null);
  assert.ok(!h.includes("901234567"), "xeshda raqamning o'zi bo'lmasligi kerak");
});

test("setTgAccountOwner/setTgAccountPhoneHash: raqam xeshi saqlanadi, keyingi saqlashlar o'chirmaydi", () => {
  const { store } = fresh();
  store.setTgAccountOwner("ikkinchi", 500, hashPhone("+998901234567"));
  assert.equal(store.listTgAccounts().find((a) => a.name === "ikkinchi").phoneHash, hashPhone("998901234567"));
  // Collector o'z qatorini yozsa ham xesh (va egasi) saqlanib qoladi
  store.saveTgAccount("ikkinchi", { userId: "77", status: "ok" });
  const row = store.listTgAccounts().find((a) => a.name === "ikkinchi");
  assert.equal(row.phoneHash, hashPhone("998901234567"));
  assert.equal(row.addedBy, 500);
  // Egasi yo'q (admin qo'shgan) akkaunt uchun faqat xesh
  store.setTgAccountPhoneHash("uchinchi", hashPhone("+998901110022"));
  assert.equal(store.listTgAccounts().find((a) => a.name === "uchinchi").phoneHash, hashPhone("998901110022"));
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

test("avtomatik Pro: akkaunt bog'lagan bo'lsa bas (raqam shart emas, 2026-11-26); akkaunt chiqib ketsa — tushadi", () => {
  const store = openStore({ file: ":memory:" });
  store.saveDriver(70, { profile: { x: 1 }, active: true, role: "haydovchi" });
  assert.equal(store.getDriver(70).autoPro, false);
  store.setTgAccountOwner("dost", 70, null);
  assert.equal(store.getDriver(70).autoPro, true, "raqamsiz ham");
  assert.equal(store.activeUsers("haydovchi").find((u) => u.chatId === 70).autoPro, true);
  assert.equal(store.listDrivers().find((u) => u.chatId === 70).autoPro, true);
  store.saveTgAccount("dost", { status: "error" });
  assert.equal(store.getDriver(70).autoPro, true, "vaqtinchalik ulanish xatosi — Pro qoladi");
  store.saveTgAccount("dost", { status: "logged_out" });
  assert.equal(store.getDriver(70).autoPro, false, "akkaunt chiqib ketdi");
  store.close();
});

test("Auto scan (2026-11-27): o'qib bo'lmagan (error) guruh — Auto scan qayta bosilsa 1 kun kutmasdan yana tekshiriladi", () => {
  let time = 1_000_000;
  const store = openStore({ file: ":memory:", now: () => time });
  store.saveTgAccount("ufk-1", { userId: 1, status: "ok" });
  store.setTgDialogs("ufk-1", [{ id: "-1004489147352", title: "YUK MARKAZI", username: null, type: "guruh", members: 647 }]);
  store.requestAccountScan("ufk-1");
  const since = store.listTgAccounts().find((a) => a.name === "ufk-1").scanRequestedAt;
  store.finishDialogScan("-1004489147352", { account: "ufk-1", state: "error", note: "a'zo emas" });
  assert.deepEqual(store.dialogsToScan("ufk-1", { since }), [], "shu so'rov ichida — qayta urinmaydi");
  time += 60_000;
  store.requestAccountScan("ufk-1");
  const again = store.listTgAccounts().find((a) => a.name === "ufk-1").scanRequestedAt;
  assert.deepEqual(store.dialogsToScan("ufk-1", { since: again }).map((d) => d.peerId), ["-1004489147352"]);
});
