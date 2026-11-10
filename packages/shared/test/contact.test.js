import { test } from "node:test";
import assert from "node:assert/strict";
import { formatContactPhone, isOwnContact, normalizeContactPhone, senderLink, shouldAskPhone, telegramUsername } from "../src/index.js";

test("jo'natuvchi username'i: @ olinadi, noto'g'ri ko'rinishdagisi — null; havola t.me ga", () => {
  assert.equal(telegramUsername("@ish_beruvchi"), "ish_beruvchi");
  assert.equal(telegramUsername(" Ali_99 "), "Ali_99");
  assert.equal(telegramUsername("abcd"), "abcd", "4 belgi — Fragment username");
  assert.equal(telegramUsername("abc"), null);
  assert.equal(telegramUsername("9ali_99"), null, "raqam bilan boshlanmaydi");
  assert.equal(telegramUsername('ali"><script>'), null);
  assert.equal(telegramUsername("a".repeat(33)), null);
  assert.equal(telegramUsername(null), null);
  assert.equal(senderLink("@ish_beruvchi"), "https://t.me/ish_beruvchi");
  assert.equal(senderLink("bad name"), null);
});

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
