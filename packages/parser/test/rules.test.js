// Qoidaviy parser (src/rules) testlari. AI chaqirilmaydi — hammasi lug'at va qoidalar.
// Telefon raqamlari soxta (+998 90 000 00 0X).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByRules } from "../src/index.js";
import { readNumbers } from "../src/rules/numbers.js";
import { findPlace } from "../src/rules/places.js";
import { editDistance, toLatin, wordKey } from "../src/rules/text.js";

const PHONE = "+998900000001";
// Ishonchli natijaning yagona yukini qaytaradi (bo'lmasa — nega ishonchsizligini ko'rsatib yiqiladi)
function one(text) {
  const r = parseByRules(`${text}\n${PHONE}`);
  assert.equal(r.confident, true, `ishonchsiz: ${r.reasons.join("; ")}`);
  assert.equal(r.loads.length, 1);
  return r.loads[0];
}
const unsure = (text) => parseByRules(`${text}\n${PHONE}`);

test("toLatin: kirill → lotin, 'е' so'z boshida ye", () => {
  assert.equal(toLatin("Нукусдан Янгийўлга"), "nukusdan yangiyo'lga");
  assert.equal(toLatin("Ташкент"), "tashkent");
  assert.equal(toLatin("Ер"), "yer");
});

test("wordKey: imlo farqlari bir xil kalit", () => {
  assert.equal(wordKey("Qo'qon"), wordKey("kokon"));
  assert.equal(wordKey("isuzzu"), wordKey("isuzu"));
  assert.equal(wordKey("Xorazm"), wordKey("horazm"));
});

test("editDistance: Damerau (yonma-yon harflar almashuvi = 1)", () => {
  assert.equal(editDistance("samarqand", "samraqand"), 1);
  assert.equal(editDistance("andijon", "adijon"), 1);
  assert.equal(editDistance("buxoro", "navoiy", 2), 3); // chegaradan oshdi — max + 1
});

test("findPlace: aniq, imlo xatosi bilan, noaniq", () => {
  assert.equal(findPlace("Samarqand").entry.region, "samarqand");
  assert.equal(findPlace("Samarkant").entry.name, "Samarqand");
  assert.equal(findPlace("Samarkant", { exact: true }), null);
  // Bitta joyning ikki yozilishi (toshkent / toshken) teng masofada — tenglik emas
  assert.equal(findPlace("toshket").entry.name, "Toshkent");
  assert.equal(findPlace("Vodiy").ambiguous, true);
});

test("readNumbers: og'irlik, narx, hajm", () => {
  const kinds = (line) => readNumbers(line).facts.map((f) => [f.kind, f.weightT ?? f.price ?? f.volumeM3 ?? null]);
  assert.deepEqual(kinds("20-22 tonna"), [["weight", 22]]);
  assert.deepEqual(kinds("3800 so'm"), [["price", 3_800_000]]);
  assert.deepEqual(kinds("kilosiga 200 so'm"), [["price", 200]]);
  assert.deepEqual(kinds("4,5 mln"), [["price", 4_500_000]]);
  assert.deepEqual(kinds("60.kub"), [["volume", 60]]); // readNumbers lotin matn oladi (toLatin dan keyin)
  assert.deepEqual(kinds("5 kilo"), [["weight", 0.005]]);
});

test("oddiy e'lon: yo'nalish, mashina, og'irlik", () => {
  const load = one("Нукусдан Янгийўлга 20 тонна тент фура кк");
  assert.equal(load.fromCity, "Nukus");
  assert.equal(load.toCity, "Yangiyo'l");
  assert.equal(load.toRegion, "toshkent");
  assert.equal(load.truckClass, "fura");
  assert.equal(load.bodyType, "tent");
  assert.equal(load.weightT, 20);
  assert.deepEqual(load.phones, [PHONE]);
});

test("viloyat + undagi joy → aniqrog'i; tuman → Toshkent shahri", () => {
  assert.equal(one("Samarqand Urgutdan Toshkentga 10 tonna yuk bor").fromCity, "Urgut");
  const load = one("Sergelidan Andijonga isuzu kerak 5 tonna");
  assert.equal(load.fromCity, "Toshkent");
  assert.equal(load.fromPlace, "Sergeli");
});

test("og'zaki qo'shimchalar: -an, qozoqcha -ten, ruscha kelishik", () => {
  assert.equal(one("Urgutan Navoiyga yuk bor 5 tonna isuzu").fromCity, "Urgut");
  assert.equal(one("Шымкенттен Тошкентка фура керак юк бор").fromCountry, "Qozog'iston");
  const ru = one("Груз из Ташкента в Самарканд 20 тонн тент");
  assert.equal(ru.fromCity, "Toshkent");
  assert.equal(ru.toCity, "Samarqand");
});

test("AI qoidalari: kuzov yolg'iz sinf emas; 15 t dan og'ir — fura", () => {
  assert.equal(one("Qarshidan Buxoroga plashatka kerak").truckClass, null);
  assert.equal(one("Toshkentdan Samarqandga 22 tonna tent kerak").truckClass, "fura");
  assert.equal(one("Toshkentdan Samarqandga 8 tonna tent kerak").truckClass, null);
});

test("ruscha ko'plik va imlo xatolari: тенты, рефов, isizu, teyet fura", () => {
  assert.equal(one("Toshkentdan Andijonga 20 tonna yuk bor tenti kerak").bodyType, "tent");
  assert.equal(one("Toshkentdan Andijonga 5 tonna yuk bor isizu kerak").truckClass, "isuzu");
  assert.equal(one("Andijon Qo'rg'ontepadan Farg'onaga teyet fura kk").bodyType, "tent");
});

test("yuklash tomoni: «usti ochiladigon» — ustidan", () => {
  assert.deepEqual(one("Samarqanddan Gulistonga 7 tonna metallom bor isuzu kerak usti ochiladigon").loadingSides, ["ust"]);
});

test("ishonchsiz: noma'lum joy, ko'p yo'nalish, bo'sh mashina, savol", () => {
  assert.match(unsure("Hasanboydan Toshkentga 20 tonna yuk bor").reasons.join(), /noma'lum joy/);
  assert.match(unsure("Toshkent - Andijon\n20 tonna\nSamarqand - Buxoro\n10 tonna\nyuk bor").reasons.join(), /joy|yuk/);
  assert.match(unsure("тошкентдан Самаркандга шаланда бор").reasons.join(), /bo'sh mashina/);
  assert.match(unsure("Toshkent Navoiy yuk olamiz 24 tonnagacha tentofka").reasons.join(), /bo'sh mashina/);
  assert.match(unsure("Самарканддан видийгами тошкентгами йук бормиди").reasons.join(), /savol/);
  assert.match(unsure("Жиззах Сирдарё юк ёпилди").reasons.join(), /yopilgan/);
});

test("ishonchsiz: har xil sinf sanalgan, mashinaga o'xshash noma'lum so'z", () => {
  assert.match(unsure("Toshkent - Andijon katta isuzu yoki mini fura kerak 13 tonna yuk bor").reasons.join(), /bir nechta mashina turi/);
  assert.match(unsure("Toshkentdan Andijonga 20 tonna yuk bor linteyka kerak").reasons.join(), /noaniq mashina/);
});

test("ishonchsiz: yuk belgisi yo'q (yuk ham, mashina ham bo'lishi mumkin)", () => {
  assert.match(unsure("Ташкент бишкек тент мега").reasons.join(), /aniq emas/);
});

test("xizmat xabari — boshqa, yuklarsiz", () => {
  const r = parseByRules("Akmal, guruh qoidalariga amal qiling. Reklama tarqatmang!");
  assert.equal(r.confident, true);
  assert.equal(r.postType, "boshqa");
  assert.deepEqual(r.loads, []);
});

test("doiradan tashqari yo'nalish ham ishonchli (bot uni baribir yubormaydi)", () => {
  const load = one("Москва - Ташкент 20 тонн тент груз есть");
  assert.equal(load.fromCountry, "Rossiya");
  assert.equal(load.toCity, "Toshkent");
});
