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
    scanText({ checked: 12, pending: 30, trial: 2, ok: 1, failed: 0, rejected: 9 }),
    "🔎 12 ta guruh tekshirildi · 3 tasi manbaga olindi (2 tasi sinovda) · 9 tasi yuk guruhi emas · yana 30 tasi navbatda",
  );
});

test("myScanView: o'z akkauntidagi «🔎 Auto scan» holati oddiy so'zlar bilan", async () => {
  const { myScanView } = await import("../src/tgAccounts.js");
  const base = { checked: 0, pending: 0, trial: 0, ok: 0, failed: 0, rejected: 0, errors: 0, running: false };
  assert.equal(myScanView(null), null);
  assert.deepEqual(myScanView(base), { running: false, lines: [] });
  const running = myScanView({ ...base, running: true, checked: 3, pending: 12, trial: 1 });
  assert.equal(running.running, true);
  assert.match(running.lines[0], /tekshirilyapti: 3 tasi tayyor, yana 12 tasi navbatda/);
  assert.match(running.lines[1], /1 tasida yuk e'lonlari bor/);
  const done = myScanView({ ...base, checked: 15, ok: 2, rejected: 13 });
  assert.match(done.lines[0], /Tekshiruv tugadi: 15 ta/);
  assert.match(done.lines.at(-1), /13 tasi yuk guruhi emas/);
});
