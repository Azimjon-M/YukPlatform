import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhones, maskPhones, hasContact } from "../src/phones.js";

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
  // Haqiqiy e'lonlarda uchragan yangi kodlar
  assert.deepEqual(extractPhones("Tent kerak 871234567"), ["+998871234567"]);
  assert.deepEqual(extractPhones("87-123-45-67"), ["+998871234567"]);
  assert.deepEqual(extractPhones("фура керак ,70 123 45 67"), ["+998701234567"]);
});

test("Rossiya / Qozog'iston raqamlari", () => {
  assert.deepEqual(extractPhones("+7 916 123 45 67"), ["+79161234567"]);
  assert.deepEqual(extractPhones("8 916 123-45-67"), ["+79161234567"]);
  assert.deepEqual(extractPhones("+7 701 123 45 67"), ["+77011234567"]);
});

test("qo'shni davlatlar raqamlari", () => {
  assert.deepEqual(extractPhones("Минск - Душанбе +992 88 800 12 34"), ["+992888001234"]);
  assert.deepEqual(extractPhones("Бишкек +996 555 123 456"), ["+996555123456"]);
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

test("maskPhones: telefon yashiriladi, tonna va narx qoladi", () => {
  assert.equal(maskPhones("Тош-Фаргона 20 90 123 45 67"), "Тош-Фаргона 20 [telefon]");
  assert.equal(maskPhones("Tel: +998 90 123-45-67, 91 234 56 78"), "Tel: [telefon], [telefon]");
  assert.equal(maskPhones("22 т, narx 3 500 000 so'm"), "22 т, narx 3 500 000 so'm");
  assert.equal(maskPhones("Минск +992 88 800 12 34\nok"), "Минск [telefon]\nok");
  assert.deepEqual(extractPhones(maskPhones("90 123 45 67 va +7 916 123 45 67")), [], "yashirilgandan keyin raqam qolmaydi");
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

test("hasContact: telefon raqami yoki yozgan odamning username'i — aloqa bor; ikkalasi ham yo'q — aloqasiz", () => {
  assert.equal(hasContact({ text: "Toshkentdan Samarqandga 20 tonna, tel 90 000 00 01" }), true);
  assert.equal(hasContact({ text: "Toshkentdan Samarqandga 20 tonna, aloqa saytda", sender: "ali_logist" }), true);
  assert.equal(hasContact({ text: "Toshkentdan Samarqandga 20 tonna, narxi 4 500 000 so'm, aloqa @yukbor_bot orqali" }), false);
  assert.equal(hasContact({ text: "+998*********" }), false, "yashirilgan raqam — raqam emas");
  assert.equal(hasContact({}), false);
});
