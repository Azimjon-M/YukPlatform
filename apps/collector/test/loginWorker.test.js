import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRIES } from "../src/authErrors.js";
import { AGAIN, createLoginSession } from "../src/loginWorker.js";

const telegramError = (errorMessage) => Object.assign(new Error(errorMessage), { errorMessage });
const USER = { id: 77, username: "yuk_ikki", firstName: "Ikkinchi" };

// Soxta Telegram: kod 11111 — noto'g'ri, 22222 — 2FA kerak, 33333 — to'g'ri; parol «good» — to'g'ri.
// Haqiqiy tarmoqqa hech narsa ketmaydi
function setup({ sendCode, user = USER } = {}) {
  const calls = { saved: [], closed: 0, disconnected: 0, codes: [], passwords: [] };
  const telegram = {
    createClient: async () => ({ fake: true }),
    sendLoginCode: sendCode ?? (async (client, phone) => ((calls.phone = phone), { phoneCodeHash: "hash-1", via: "app", length: 5 })),
    resendLoginCode: async (client, { phoneNumber, phoneCodeHash }) => {
      calls.resent = { phoneNumber, phoneCodeHash };
      return { phoneCodeHash: "hash-2", via: "sms", length: 5, next: "call", timeout: 60 };
    },
    signInWithCode: async (client, { phoneNumber, phoneCodeHash, code }) => {
      calls.codes.push({ phoneNumber, phoneCodeHash, code });
      if (code === "11111") throw telegramError("PHONE_CODE_INVALID");
      if (code === "44444") throw telegramError("PHONE_CODE_EXPIRED");
      if (code === "22222") return { password: true, hint: "mushuk" };
      return { user };
    },
    signInWithPassword: async (client, password) => {
      calls.passwords.push(password);
      if (password !== "good") throw telegramError("PASSWORD_HASH_INVALID");
      return { user };
    },
    userInfo: (u) => ({ userId: String(u.id), username: u.username ?? null, firstName: u.firstName ?? null }),
    saveSession: async (client, name) => calls.saved.push(name),
    closeAuthorization: async () => calls.closed++,
    disconnect: async () => calls.disconnected++,
  };
  const sent = [];
  const session = createLoginSession({ telegram, send: async (message) => sent.push(message) });
  return { session, sent, calls };
}

test("kirish: raqam → kod (noto'g'ri, keyin 2FA) → parol (noto'g'ri, keyin to'g'ri) → sessiya saqlanadi", async () => {
  const { session, sent, calls } = setup();
  await session.handle({ type: "start", name: "ikkinchi", phone: "+998901234567", taken: {} });
  assert.deepEqual(sent.at(-1), { type: "code", via: "app", length: 5, next: null, timeout: null });
  assert.equal(calls.phone, "+998901234567");

  await session.handle({ type: "code", code: "11111" });
  assert.deepEqual(sent.at(-1), { type: "error", retry: true, message: "Kod noto'g'ri. Qayta kiriting." });
  assert.equal(session.step, "code");

  await session.handle({ type: "code", code: "22222" });
  assert.deepEqual(sent.at(-1), { type: "password", hint: "mushuk" });
  assert.deepEqual(calls.codes.at(-1), { phoneNumber: "+998901234567", phoneCodeHash: "hash-1", code: "22222" });

  await session.handle({ type: "password", password: "yomon" });
  assert.equal(sent.at(-1).retry, true);
  assert.match(sent.at(-1).message, /parol noto'g'ri/);

  await session.handle({ type: "password", password: "good" });
  assert.deepEqual(sent.at(-1), { type: "done", user: { userId: "77", username: "yuk_ikki", firstName: "Ikkinchi" } });
  assert.deepEqual(calls.saved, ["ikkinchi"]);
  assert.equal(session.finished, true);
  await session.close();
  assert.equal(calls.disconnected, 1);
});

test("2FA'siz akkaunt: to'g'ri kod bilan darhol tayyor", async () => {
  const { session, sent, calls } = setup();
  await session.handle({ type: "start", name: "uchinchi", phone: "+998901234567" });
  await session.handle({ type: "code", code: "33333" });
  assert.equal(sent.at(-1).type, "done");
  assert.deepEqual(calls.saved, ["uchinchi"]);
});

test("noto'g'ri kod cheksiz emas: urinishlar tugasa kirish tugaydi", async () => {
  const { session, sent } = setup();
  await session.handle({ type: "start", name: "ikkinchi", phone: "+998901234567" });
  for (let i = 0; i < MAX_RETRIES; i++) {
    await session.handle({ type: "code", code: "11111" });
    assert.equal(sent.at(-1).retry, true);
  }
  await session.handle({ type: "code", code: "11111" });
  assert.equal(sent.at(-1).retry, false);
  assert.match(sent.at(-1).message, new RegExp(`Urinishlar tugadi, qaytadan: ${AGAIN}`));
  assert.equal(session.step, "failed");
});

test("eskirgan kod va raqam xatosi — qaytadan boshlash kerak (terminal buyrug'i emas, Mini App tugmasi)", async () => {
  const expired = setup();
  await expired.session.handle({ type: "start", name: "ikkinchi", phone: "+998901234567" });
  await expired.session.handle({ type: "code", code: "44444" });
  assert.equal(expired.sent.at(-1).retry, false);
  assert.match(expired.sent.at(-1).message, /Kod eskirdi/);
  assert.ok(expired.sent.at(-1).message.includes(AGAIN));
  assert.ok(!expired.sent.at(-1).message.includes("npm run"));

  const badPhone = setup({ sendCode: async () => Promise.reject(telegramError("PHONE_NUMBER_INVALID")) });
  await badPhone.session.handle({ type: "start", name: "ikkinchi", phone: "+998" });
  assert.equal(badPhone.sent.at(-1).retry, false, "raqam bosqichida qayta so'ralmaydi — yangi kirish kerak");
  assert.match(badPhone.sent.at(-1).message, /Telefon raqam noto'g'ri/);
});

test("boshqa nom bilan ulangan akkaunt — saqlanmaydi, yangi sessiya yopiladi; o'z nomi bilan qayta kirsa — bo'ladi", async () => {
  const dup = setup();
  await dup.session.handle({ type: "start", name: "uchinchi", phone: "+998901234567", taken: { 77: "ikkinchi" } });
  await dup.session.handle({ type: "code", code: "33333" });
  assert.equal(dup.sent.at(-1).retry, false);
  assert.match(dup.sent.at(-1).message, /«ikkinchi» nomi bilan ulangan/);
  assert.deepEqual(dup.calls.saved, []);
  assert.equal(dup.calls.closed, 1);

  const again = setup();
  await again.session.handle({ type: "start", name: "ikkinchi", phone: "+998901234567", taken: { 77: "ikkinchi" } });
  await again.session.handle({ type: "code", code: "33333" });
  assert.equal(again.sent.at(-1).type, "done");
  assert.deepEqual(again.calls.saved, ["ikkinchi"]);
});

test("bosqichga mos kelmagan so'rov — e'tiborsiz, holat buzilmaydi", async () => {
  const { session, sent, calls } = setup();
  await session.handle({ type: "code", code: "33333" }); // hali raqam yo'q
  assert.deepEqual(sent.at(-1), { type: "error", retry: true, message: "Bu bosqichda kutilmagan so'rov — sahifani yangilang" });
  assert.deepEqual(calls.codes, []);
  assert.equal(session.step, "start");
});

test("«Kod kelmadi»: kod SMS bilan qayta yuboriladi, yangi hash bilan kiriladi", async () => {
  const { session, sent, calls } = setup();
  await session.handle({ type: "start", name: "ikkinchi", phone: "+998901234567", taken: {} });
  await session.handle({ type: "resend" });
  assert.deepEqual(sent.at(-1), { type: "code", via: "sms", length: 5, next: "call", timeout: 60 });
  assert.deepEqual(calls.resent, { phoneNumber: "+998901234567", phoneCodeHash: "hash-1" });
  await session.handle({ type: "code", code: "33333" });
  assert.equal(calls.codes.at(-1).phoneCodeHash, "hash-2");
  assert.equal(sent.at(-1).type, "done");
});

test("QR / havola: token yuboriladi, tasdiqlangach sessiya saqlanadi; 2FA bo'lsa — parol", async () => {
  const { session, sent, calls } = setup();
  const results = [{ url: "tg://login?token=AAA", expires: Math.floor(Date.now() / 1000) + 30 }, { user: USER }];
  let accepted = null;
  const telegram = {
    createClient: async () => ({ fake: true }),
    exportLoginToken: async () => results.shift(),
    onLoginTokenAccepted: (client, cb) => (accepted = cb),
    userInfo: (u) => ({ userId: String(u.id), username: u.username ?? null, firstName: u.firstName ?? null }),
    saveSession: async (client, name) => calls.saved.push(name),
    closeAuthorization: async () => {},
    disconnect: async () => {},
  };
  const out = [];
  const qr = createLoginSession({ telegram, send: async (m) => out.push(m) });
  const running = qr.handle({ type: "qr", name: "uchinchi", taken: {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(out[0].type, "qr");
  assert.equal(out[0].url, "tg://login?token=AAA");
  assert.equal(qr.step, "qr");
  accepted(); // egasi Telegram'da tasdiqladi
  await running;
  assert.equal(out.at(-1).type, "done");
  assert.deepEqual(calls.saved, ["uchinchi"]);
  assert.equal(sent.length, 0);
  assert.ok(session);

  // 2FA: tasdiqlangach parol so'raladi
  const pw = [];
  const twoFa = createLoginSession({
    telegram: { ...telegram, exportLoginToken: async () => ({ password: true, hint: "mushuk" }), signInWithPassword: async () => ({ user: USER }) },
    send: async (m) => pw.push(m),
  });
  await twoFa.handle({ type: "qr", name: "turtinchi", taken: {} });
  assert.deepEqual(pw.at(-1), { type: "password", hint: "mushuk" });
  await twoFa.handle({ type: "password", password: "good" });
  assert.equal(pw.at(-1).type, "done");
});

test("QR kutilayotganda bekor qilinsa — sikl to'xtaydi", async () => {
  const out = [];
  const qr = createLoginSession({
    telegram: { createClient: async () => ({}), exportLoginToken: async () => ({ url: "tg://login?token=B", expires: null }), onLoginTokenAccepted: () => {}, disconnect: async () => {} },
    send: async (m) => out.push(m),
  });
  const running = qr.handle({ type: "qr", name: "x", taken: {} });
  await new Promise((r) => setImmediate(r));
  await qr.close();
  await running;
  assert.equal(out.length, 1);
  assert.equal(qr.finished, true);
});
