import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupCity, normalizePlaces, placeKey } from "../src/places.js";

test("nom kaliti: apostrof, harf kattaligi, izoh farq qilmaydi", () => {
  assert.equal(placeKey("Qo'qon"), placeKey("QOʻQON"));
  assert.equal(placeKey("Qo'qon"), placeKey("Qoqon"));
  assert.equal(placeKey("Yangibozor (Xorazm)"), "yangibozor");
});

test("ro'yxatdagi shahar viloyat va davlatini beradi", () => {
  assert.deepEqual(lookupCity("Koson"), { name: "Koson", region: "qashqadaryo", country: "O'zbekiston" });
  assert.equal(lookupCity("Qoqon").name, "Qo'qon");
  assert.equal(lookupCity("Шурчи").name, "Sho'rchi");
  assert.equal(lookupCity("Toshkent").region, "toshkent_sh");
  assert.deepEqual(lookupCity("Poti"), { name: "Poti", region: "xorij", country: "Gruziya" });
  assert.equal(lookupCity("Noma'lum qishloq"), null);
  assert.equal(lookupCity(null), null);
});

test("ikki joyda bor nom (Yangibozor) o'zgartirilmaydi", () => {
  assert.equal(lookupCity("Yangibozor"), null);
});

test("AI adashtirgan viloyat ro'yxat bo'yicha to'g'rilanadi", () => {
  const load = { fromCity: "Qamashi", fromRegion: "qashqadaryo", toCity: "Koson", toRegion: "buxoro", toCountry: null, fromCountry: null };
  const fixed = normalizePlaces(load);
  assert.equal(fixed.toRegion, "qashqadaryo");
  assert.equal(fixed.toCountry, "O'zbekiston");
  assert.equal(load.toRegion, "buxoro", "asl obyekt o'zgarmaydi");
});

test("shahar noma'lum bo'lsa AI yozgani qoladi", () => {
  const load = { fromCity: null, fromRegion: "surxondaryo", toCity: "Lotfobod", toRegion: "xorij", toCountry: "Eron" };
  assert.deepEqual(normalizePlaces(load), load);
});
