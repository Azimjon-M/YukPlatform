import { test } from "node:test";
import assert from "node:assert/strict";
import { formatContactPhone, isOwnContact, normalizeContactPhone, shouldAskPhone } from "../src/index.js";

test("kontakt raqami: bitta ko'rinishga keltiriladi, noto'g'risi — null", () => {
  assert.equal(normalizeContactPhone("998901234567"), "+998901234567");
  assert.equal(normalizeContactPhone("+998 90 123-45-67"), "+998901234567");
  assert.equal(normalizeContactPhone("+7 701 123 45 67"), "+77011234567");
  assert.equal(normalizeContactPhone("123"), null);
  assert.equal(normalizeContactPhone(""), null);
  assert.equal(normalizeContactPhone(undefined), null);
});

test("ko'rsatish: O'zbekiston raqami bo'lib yoziladi, boshqasi o'zgarmaydi", () => {
  assert.equal(formatContactPhone("+998901234567"), "+998 90 123 45 67");
  assert.equal(formatContactPhone("+77011234567"), "+77011234567");
  assert.equal(formatContactPhone(null), "");
});

test("faqat o'z kontakti: birovniki va Telegram'siz kontakt — yo'q", () => {
  assert.equal(isOwnContact({ user_id: 42, phone_number: "998901234567" }, 42), true);
  assert.equal(isOwnContact({ user_id: 77, phone_number: "998901234567" }, 42), false);
  assert.equal(isOwnContact({ phone_number: "998901234567" }, 42), false);
  assert.equal(isOwnContact(null, 42), false);
});

test("bot raqamni bir marta so'raydi: sozlamalardan keyin, raqam yo'q va hali so'ralmagan", () => {
  assert.equal(shouldAskPhone({ profile: {}, phone: null, phoneAskedAt: null }), true);
  assert.equal(shouldAskPhone({ profile: null }), false, "sozlamalari yo'q");
  assert.equal(shouldAskPhone({ profile: {}, phone: "+998901234567" }), false);
  assert.equal(shouldAskPhone({ profile: {}, phoneAskedAt: 1 }), false, "«Keyinroq» bosgan");
  assert.equal(shouldAskPhone(null), false);
});
