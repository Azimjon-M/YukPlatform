import { test } from "node:test";
import assert from "node:assert/strict";
import { accountError, accountStatus, codeWhere, suggestAccountName } from "../src/tgAccounts.js";

test("yangi akkaunt nomi: ikkinchi, uchinchi … band bo'lsa — keyingisi", () => {
  assert.equal(suggestAccountName([]), "ikkinchi");
  assert.equal(suggestAccountName([{ name: "asosiy" }, { name: "ikkinchi" }]), "uchinchi");
  assert.equal(suggestAccountName([{ name: "asosiy" }, { name: "uchinchi" }]), "ikkinchi");
});

test("holat: sessiyasi yo'q qo'shimcha akkauntga Mini App'dan qayta kirsa bo'ladi, asosiysiga — yo'q", () => {
  assert.deepEqual([accountStatus({ name: "ikkinchi", status: "ok" }).problem, accountStatus({ name: "ikkinchi", status: "ok" }).relogin], [false, false]);
  assert.equal(accountStatus({ name: "ikkinchi", status: "logged_out" }).relogin, true);
  const main = accountStatus({ name: "asosiy", status: "logged_out" });
  assert.equal(main.relogin, false);
  assert.match(main.hint, /npm run tg:login/);
  assert.equal(accountStatus({ name: "ikkinchi", status: "error" }).problem, true);
});

test("xato matni: qo'shimcha akkauntda terminal maslahati olib tashlanadi (o'rniga «Qayta kirish» tugmasi)", () => {
  const revoked = "Sessiya bekor qilingan (AUTH_KEY_UNREGISTERED). Qayta kiring: npm run tg:login -- --account eski";
  assert.equal(accountError({ name: "eski", error: revoked }), "Sessiya bekor qilingan (AUTH_KEY_UNREGISTERED)");
  assert.equal(accountError({ name: "eski", error: "Sessiya fayli yo'q (npm run tg:login -- --account eski)" }), "Sessiya fayli yo'q");
  assert.equal(accountError({ name: "eski", error: "Sessiya fayli o'chirilgan (npm run tg:logout)" }), "Sessiya fayli o'chirilgan");
  assert.equal(
    accountError({ name: "uch", error: "bu «ikkinchi» akkauntining o'zi (Ali) — bir akkaunt ikki marta ulanmaydi — egasi qayta kirmaguncha ulanmaydi: npm run tg:login -- --account uch" }),
    "bu «ikkinchi» akkauntining o'zi (Ali) — bir akkaunt ikki marta ulanmaydi",
  );
  assert.equal(accountError({ name: "asosiy", error: revoked }), revoked, "asosiyga — terminal yagona yo'l");
  assert.equal(accountError({ name: "eski", error: "TIMEOUT" }), "TIMEOUT");
});

test("kod qayerga ketdi — tushunarli matn", () => {
  assert.match(codeWhere({ phone: "+998 90 ••• •• 67", via: "app" }), /\+998 90 ••• •• 67 akkauntiga yubordi: Telegram ilovasiga — «Telegram» nomli rasmiy chatga/);
  assert.match(codeWhere({ phone: "+998 90 ••• •• 67", via: "sms" }), /SMS orqali/);
  assert.match(codeWhere({ phone: "x", via: "setup_email" }), /pochta bog'lash/);
});

test("scanText: akkaunt guruhlarini tekshirish natijasi bir qatorda", async () => {
  const { scanText } = await import("../src/tgAccounts.js");
  assert.equal(scanText(null), null);
  assert.equal(scanText({ checked: 0, pending: 0, trial: 0, ok: 0, failed: 0, rejected: 0 }), null);
  assert.equal(
    scanText({ running: true, checked: 12, pending: 30, trial: 2, ok: 1, failed: 0, rejected: 9 }),
    "🔎 Tekshirilyapti (~15 daq qoldi) · 3 ta yuk guruhi topildi",
  );
  assert.equal(scanText({ running: false, checked: 12, pending: 0, trial: 0, ok: 4, failed: 2, rejected: 6 }), "🔎 4 ta yuk guruhi topildi");
});

test("myScanView: o'z akkauntidagi «🔎 Auto scan» holati oddiy so'zlar bilan", async () => {
  const { myScanView } = await import("../src/tgAccounts.js");
  const base = { checked: 0, pending: 0, trial: 0, ok: 0, failed: 0, rejected: 0, errors: 0, running: false };
  assert.equal(myScanView(null), null);
  assert.deepEqual(myScanView(base), { running: false, lines: [] });
  const running = myScanView({ ...base, running: true, checked: 3, pending: 12, trial: 1, rejected: 2 });
  assert.equal(running.running, true);
  assert.match(running.lines[0], /tekshirilyapti — taxminan 6 daqiqa qoldi/);
  assert.match(running.lines[1], /Hozircha 1 ta yuk guruhi topildi/);
  assert.equal(myScanView({ ...base, running: true, pending: 1 }).lines[1], "Hozircha yuk guruhi topilmadi.");
  const done = myScanView({ ...base, checked: 15, ok: 2, failed: 1, rejected: 12, errors: 1 });
  assert.deepEqual(done.lines, ["✅ Tekshiruv tugadi: 2 ta yuk guruhi topildi — ulardagi e'lonlar sizga keladi."]);
  assert.ok(!done.lines.join(" ").match(/emas|o'qib/), "yuk guruhi bo'lmaganlar sanalmaydi");
  assert.deepEqual(myScanView({ ...base, checked: 5, rejected: 5 }).lines, ["✅ Tekshiruv tugadi: yuk guruhi topilmadi."]);
});
