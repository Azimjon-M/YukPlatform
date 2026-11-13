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
