// Yuk beruvchi formasi (shipperLoad.js): tekshirish, yuk ko'rinishi, formaga qaytarish. Raqamlar soxta (+998 90 000 00 0X)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIPPER_LOAD_PHONES, sanitizeShipperLoad, shipperLoadAreas, shipperLoadForm, shipperLoadText, shipperPhones, typedPhone } from "../src/index.js";

const FORM = { from: "andijon", fromCity: "Asaka", to: "toshkent_sh", cargo: "un", weight: "20", weightUnit: "tonna", phones: ["90 000 00 01"] };

test("yozilgan raqam: bo'sh joy, +998, 8 bilan, qo'shni davlat — bitta ko'rinishga; noto'g'risi — null", () => {
  assert.equal(typedPhone("90 000 00 01"), "+998900000001");
  assert.equal(typedPhone("+998 (90) 000-00-01"), "+998900000001");
  assert.equal(typedPhone("998900000001"), "+998900000001");
  assert.equal(typedPhone("8 90 000 00 01"), "+998900000001");
  assert.equal(typedPhone("+7 701 000 00 01"), "+77010000001");
  assert.equal(typedPhone("+992 90 000 0001"), "+992900000001");
  assert.equal(typedPhone("12 345 67 89"), null, "bunday kod yo'q");
  assert.equal(typedPhone("90 123 45"), null, "to'liq emas");
  assert.equal(typedPhone("90 000 00 00"), null, "raqam emas");
  assert.equal(typedPhone(""), null);
  assert.deepEqual(shipperPhones(["90 000 00 01", " ", "+998900000001"]), { phones: ["+998900000001"] }, "takror va bo'shi tashlanadi");
  assert.match(shipperPhones([]).error, /Telefon raqamini yozing/);
  assert.match(shipperPhones(["salom"]).error, /noto'g'ri/);
  assert.match(shipperPhones(["90 000 00 01", "90 000 00 02", "90 000 00 03"]).error, new RegExp(`${SHIPPER_LOAD_PHONES} ta`));
});

test("forma → yuk: parser bergandek ko'rinish, shahar ro'yxatdan, toifa og'irlikdan", () => {
  const { load } = sanitizeShipperLoad(
    { ...FORM, truckClass: "fura", bodyType: "bort", price: "3 000 000", negotiable: true, payment: "naqd", when: "  ertaga   ertalab ", note: "<b>tez</b>" },
    { scope: "qoshni" },
  );
  assert.equal(load.fromRegion, "andijon");
  assert.equal(load.fromCity, "Asaka");
  assert.equal(load.fromCountry, "O'zbekiston");
  assert.equal(load.toRegion, "toshkent_sh");
  assert.equal(load.toCity, null);
  assert.equal(load.weightT, 20);
  assert.equal(load.category, "fura");
  assert.equal(load.bodyType, "ploshatka", "eski kod yangisiga");
  assert.equal(load.price, 3_000_000);
  assert.equal(load.currency, "UZS");
  assert.equal(load.priceUnit, "reys");
  assert.equal(load.when, "ertaga ertalab");
  assert.equal(load.note, "<b>tez</b>", "HTML — xabarga qo'yilganda escape qilinadi (format.js)");
  assert.deepEqual(load.phones, ["+998900000001"]);
  assert.equal(shipperLoadText(load), "Andijon, Asaka → Toshkent shahri · un · 20 tonna · Fura · plashatka · 3 000 000 so'm · kelishiladi · naqd · ertaga ertalab · <b>tez</b> · +998900000001");

  const small = sanitizeShipperLoad({ ...FORM, weight: "700", weightUnit: "kg", price: "" }, { scope: "qoshni" }).load;
  assert.equal(small.weightT, 0.7);
  assert.equal(small.category, "yengil");
  assert.equal(small.price, null);
  assert.equal(small.currency, null);
  // Shahar boshqa viloyatda bo'lsa — viloyati ro'yxatdan (Chust — Namangan)
  assert.equal(sanitizeShipperLoad({ ...FORM, fromCity: "Chust" }, { scope: "qoshni" }).load.fromRegion, "namangan");
  // Qo'shni davlat
  const kz = sanitizeShipperLoad({ ...FORM, to: "Qozog'iston", toCity: "Olmaota" }, { scope: "qoshni" }).load;
  assert.equal(kz.toRegion, "xorij");
  assert.equal(kz.toCountry, "Qozog'iston");
});

test("forma xatolari: qaysi maydon ekani bilan; doiradan tashqari va ichki doirada qo'shni davlat — yo'q", () => {
  const error = (patch, scope = "qoshni") => {
    const { error: text, field } = sanitizeShipperLoad({ ...FORM, ...patch }, { scope });
    return [field, text];
  };
  assert.deepEqual(error({ from: "" })[0], "from");
  assert.deepEqual(error({ to: "Rossiya" })[0], "to", "Rossiya — doirada yo'q");
  assert.deepEqual(error({ weight: "" }), ["weight", "Yuk og'irligini yozing"]);
  assert.deepEqual(error({ weight: "abc" })[0], "weight");
  assert.deepEqual(error({ weight: "500" })[0], "weight", "500 tonna — juda ko'p");
  assert.deepEqual(error({ price: "-5" })[0], "price");
  assert.deepEqual(error({ phones: [] })[0], "phones");
  assert.deepEqual(error({ to: "Qozog'iston" }, "ichki")[0], "to");
  assert.equal(sanitizeShipperLoad(null).error, "Ma'lumot kelmadi");
  // Qozog'iston → Qirg'iziston: O'zbekistonga tegmaydi
  assert.match(error({ from: "Qozog'iston", fromCity: "", to: "Qirg'iziston" })[1], /qo'shni davlatlar orasidagi/);
  assert.ok(shipperLoadAreas("ichki").every((a) => !a.label.includes("🌍")));
});

test("yuk → forma: botda tushunilgan yuk formada tuzatish uchun ochiladi", () => {
  const { load } = sanitizeShipperLoad({ ...FORM, to: "Qozog'iston", toCity: "Olmaota", truckClass: "isuzu", weight: "5" }, { scope: "qoshni" });
  const form = shipperLoadForm(load, "qoshni");
  assert.equal(form.from, "andijon");
  assert.equal(form.to, "Qozog'iston");
  assert.equal(form.toCity, "Olmaota");
  assert.equal(form.weight, "5");
  assert.equal(form.weightUnit, "tonna");
  assert.deepEqual(form.phones, ["+998900000001"]);
  assert.deepEqual(sanitizeShipperLoad(form, { scope: "qoshni" }).load, load, "formadan qayta o'tsa — o'sha yuk");
  assert.equal(shipperLoadForm({ fromRegion: "xorij", fromCountry: "Rossiya", weightT: 0.3 }, "qoshni").from, "", "doirada yo'q davlat");
  assert.equal(shipperLoadForm({ weightT: 0.3 }, "qoshni").weight, "300");
});
