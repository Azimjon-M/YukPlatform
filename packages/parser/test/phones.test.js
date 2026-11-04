import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhones } from "../src/phones.js";

const UZ = "+998901234567";

test("o'zbek raqamining har xil yozilishi bitta ko'rinishga keladi", () => {
  for (const text of [
    "+998 90 123 45 67",
    "998901234567",
    "+998901234567",
    "90 123 45 67",
    "901234567",
    "(90) 123-45-67",
    "+998 (90) 123-45-67",
    "8 90 123 45 67",
    "90.123.45.67",
  ]) {
    assert.deepEqual(extractPhones(`Тел: ${text}`), [UZ], text);
  }
});

test("boshqa operator kodlari", () => {
  assert.deepEqual(extractPhones("33 123 45 67"), ["+998331234567"]);
  assert.deepEqual(extractPhones("tel 77-123-45-67"), ["+998771234567"]);
  assert.deepEqual(extractPhones("+998 71 234 56 78"), ["+998712345678"]);
});

test("Rossiya / Qozog'iston raqamlari", () => {
  assert.deepEqual(extractPhones("+7 916 123 45 67"), ["+79161234567"]);
  assert.deepEqual(extractPhones("8 916 123-45-67"), ["+79161234567"]);
});

test("bitta e'londa bir nechta raqam", () => {
  assert.deepEqual(extractPhones("90 123 45 67, 91 234 56 78"), ["+998901234567", "+998912345678"]);
  assert.deepEqual(extractPhones("901234567 912345678"), ["+998901234567", "+998912345678"]);
  assert.deepEqual(extractPhones("90 123 45 67\n91 234 56 78"), ["+998901234567", "+998912345678"]);
});

test("takrorlangan raqam bir marta olinadi", () => {
  assert.deepEqual(extractPhones("90 123 45 67 ... +998901234567"), [UZ]);
});

test("raqam oldiga yopishgan son (tonna, sana) xalaqit bermaydi", () => {
  assert.deepEqual(extractPhones("Тош-Фаргона 20 90 123 45 67"), [UZ]);
  assert.deepEqual(extractPhones("Ertaga 05.11.2026 90 123 45 67"), [UZ]);
});

test("narx, og'irlik, sana va karta raqami telefon deb olinmaydi", () => {
  for (const text of [
    "20 тонна, 3 500 000 сум",
    "Narx 15 000 000",
    "Narx 900 000 000 so'm",
    "3.500.000",
    "Sana 05.11.2026",
    "Karta 8600 1234 5678 9012",
    "Humo 9860 1234 5678 9012",
    "8600123456789012",
    "22 т, 82 куб",
  ]) {
    assert.deepEqual(extractPhones(text), [], text);
  }
});
