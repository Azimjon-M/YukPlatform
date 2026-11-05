import { test } from "node:test";
import assert from "node:assert/strict";
import { CITY_COORDS, COUNTRIES, REGIONS, lookupCity, normalizePlaces, placePoint } from "../src/index.js";

// Koordinatasini bilmagan joylar — xaritada viloyat nuqtasiga tushadi
const UNKNOWN = new Set(["Jomasho'y", "Ravon", "Qarluq"]);

test("har bir viloyat shahrining koordinatasi bor va O'zbekiston ichida", () => {
  for (const region of REGIONS) {
    for (const raw of region.cities) {
      const city = raw.replace(/\s*\(.*\)$/, "");
      if (UNKNOWN.has(city)) continue;
      const point = CITY_COORDS[region.id]?.[city];
      assert.ok(point, `${region.id}: ${city} koordinatasi yo'q`);
      const [lat, lon] = point;
      assert.ok(lat > 37 && lat < 45.7 && lon > 55.9 && lon < 73.2, `${city}: ${point} O'zbekistondan tashqarida`);
    }
  }
});

test("qo'shni davlatlar shaharlarining koordinatasi bor", () => {
  for (const name of ["Qozog'iston", "Qirg'iziston", "Tojikiston", "Turkmaniston", "Afg'oniston"]) {
    const country = COUNTRIES.find((c) => c.name === name);
    for (const city of country.cities) assert.ok(CITY_COORDS[name]?.[city], `${name}: ${city}`);
  }
});

test("shahar: aniq nuqta va viloyat bilan yozuv", () => {
  const p = placePoint({ fromCity: "Chirchiq", fromRegion: "toshkent" }, "from");
  assert.equal(p.exact, true);
  assert.equal(p.key, "toshkent|Chirchiq");
  assert.equal(p.label, "Toshkent vil., Chirchiq");
  assert.ok(Math.abs(p.lat - 41.47) < 0.05 && Math.abs(p.lon - 69.58) < 0.05);
  assert.equal(placePoint({ toCity: "Qo'qon", toRegion: "fargona" }, "to").label, "Farg'ona, Qo'qon");
});

test("Toshkent: shahar, faqat 'Toshkent shahri' va viloyatga yozilgan shahar — bitta nuqta", () => {
  const a = placePoint({ fromCity: "Toshkent", fromRegion: "toshkent_sh" }, "from");
  const b = placePoint({ fromRegion: "toshkent_sh" }, "from");
  const c = placePoint({ fromCity: "Ташкент", fromRegion: "toshkent" }, "from");
  assert.equal(a.key, "toshkent_sh|Toshkent");
  assert.equal(b.key, a.key);
  assert.equal(c.key, a.key);
});

test("AI shaharni boshqa viloyatga yozsa ham ro'yxatdagi joyi olinadi", () => {
  assert.equal(placePoint({ fromCity: "Koson", fromRegion: "buxoro" }, "from").key, "qashqadaryo|Koson");
});

test("xorij: boshqa yozilishlar (Almaty) bitta nomga; ro'yxatda yo'q shahar — davlat nuqtasi", () => {
  const almaty = placePoint({ toCity: "Almaty", toRegion: "xorij", toCountry: "Qozog'iston" }, "to");
  assert.equal(almaty.key, "Qozog'iston|Olmaota");
  assert.equal(almaty.label, "Qozog'iston, Olmaota");
  assert.equal(placePoint({ toCity: "Алматы", toRegion: "xorij", toCountry: "Qozog'iston" }, "to").key, almaty.key);
  const unknown = placePoint({ toCity: "Kichkina qishloq", toRegion: "xorij", toCountry: "Qozog'iston" }, "to");
  assert.deepEqual([unknown.key, unknown.exact, unknown.label], ["country:Qozog'iston", false, "Qozog'iston"]);
});

test("faqat viloyat — viloyat nuqtasi (aniq emas); hech narsa yo'q — null", () => {
  const p = placePoint({ toRegion: "surxondaryo" }, "to");
  assert.deepEqual([p.key, p.exact, p.label], ["region:surxondaryo", false, "Surxondaryo viloyati"]);
  assert.equal(placePoint({ toCity: "Jomasho'y", toRegion: "namangan" }, "to").key, "region:namangan");
  assert.equal(placePoint({}, "from"), null);
  assert.equal(placePoint(null, "from"), null);
});

test("xorijiy shaharlarning boshqa yozilishi parserda ham bitta nomga keladi", () => {
  assert.deepEqual(lookupCity("Almaty"), { name: "Olmaota", region: "xorij", country: "Qozog'iston" });
  assert.equal(lookupCity("Chimkent").name, "Shymkent");
  const out = normalizePlaces({ toCity: "Almata", toCountry: "Qozog'iston" });
  assert.equal(out.toCity, "Olmaota");
  assert.equal(out.toRegion, "xorij");
});
