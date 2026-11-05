import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeProfile, emptyProfile, encodeProfile, intlChoices, intlLabel, intlOption, matchLoad, regionLabel, sanitizeProfile } from "../src/index.js";

const PROFILE = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, loadingSides: ["orqa", "yon"] },
  fromAreas: ["toshkent", "andijon"],
  toAreas: ["Rossiya"],
  domestic: true,
  international: true,
  mode: "own",
};

test("to'g'ri profil o'zgarmasdan o'tadi va match.js bilan ishlaydi", () => {
  const { profile, error } = sanitizeProfile(PROFILE);
  assert.equal(error, undefined);
  assert.deepEqual(profile, PROFILE);
  assert.equal(matchLoad({ fromRegion: "andijon", toRegion: "xorij", toCountry: "Rossiya", weightT: 4 }, profile).ok, true);
});

test("Mini App'dan kelgan begona maydonlar va noto'g'ri qiymatlar tashlanadi", () => {
  const { profile } = sanitizeProfile({
    ...PROFILE,
    admin: true,
    vehicle: { ...PROFILE.vehicle, bodyType: "boshqa", capacityKg: "7500.4", loadingSides: ["orqa", "orqa", "tom", 5] },
    fromAreas: ["andijon", "andijon", "Marsda", null],
    mode: "hammasi",
  });
  assert.equal(profile.admin, undefined);
  assert.equal(profile.vehicle.bodyType, null);
  assert.equal(profile.vehicle.capacityKg, 7500);
  assert.deepEqual(profile.vehicle.loadingSides, ["orqa"]);
  assert.deepEqual(profile.fromAreas, ["andijon"]);
  assert.equal(profile.mode, "own");
});

test("majburiy maydonlar va chegaralar", () => {
  assert.match(sanitizeProfile(null).error, /kelmadi/);
  assert.match(sanitizeProfile(emptyProfile()).error, /Mashina turini/);
  assert.match(sanitizeProfile({ vehicle: { truckClass: "fura", capacityKg: 99_000 } }).error, /tonna/);
  assert.match(sanitizeProfile({ vehicle: { truckClass: "fura", bodyType: "raketa", capacityKg: 20_000 } }).error, /Kuzov turi/);
  assert.match(sanitizeProfile({ vehicle: { ...PROFILE.vehicle, body: { lengthM: 40, widthM: 2, heightM: 2 } } }).error, /o'lchami/);
  assert.match(sanitizeProfile({ ...PROFILE, domestic: false, international: false }).error, /bittasini/);
});

test("manzil uchun kodlash: qaytarib o'qiladi, buzilgani null", () => {
  const text = encodeProfile(PROFILE);
  assert.match(text, /^[\w-]+$/);
  assert.deepEqual(decodeProfile(text), PROFILE);
  assert.equal(decodeProfile("buzilgan!!"), null);
  assert.equal(decodeProfile(""), null);
});

test("yorliqlar", () => {
  assert.equal(regionLabel("andijon"), "Andijon vil.");
  assert.equal(regionLabel("Rossiya"), "Rossiya");
  assert.equal(intlOption(PROFILE), "ham");
});

test("yo'nalish doirasi: Mini App'dan kelgan uzoq davlat tashlanadi, ichki doirada xalqaro o'chadi", () => {
  const input = { ...PROFILE, fromAreas: ["andijon", "Rossiya", "Qozog'iston", "xorij"], toAreas: ["Xitoy"], domestic: true, international: true };
  const qoshni = sanitizeProfile(input, { scope: "qoshni" }).profile;
  assert.deepEqual([qoshni.fromAreas, qoshni.toAreas], [["andijon", "Qozog'iston", "xorij"], []]);
  const ichki = sanitizeProfile({ ...input, domestic: false }, { scope: "ichki" }).profile;
  assert.deepEqual([ichki.fromAreas, ichki.domestic, ichki.international], [["andijon"], true, false]);
  assert.deepEqual(sanitizeProfile(input, { scope: "hammasi" }).profile.toAreas, ["Xitoy"]);
  assert.deepEqual(sanitizeProfile(input).profile.toAreas, ["Xitoy"], "doirasiz — avvalgidek");
  assert.deepEqual(decodeProfile(encodeProfile(input), { scope: "qoshni" }).toAreas, []);

  assert.equal(intlChoices("ichki"), null);
  assert.equal(intlChoices().options.faqat.label, "Faqat qo'shni davlatlar");
  assert.equal(intlLabel({ domestic: true, international: true }), "O'zbekiston va qo'shni davlatlar");
  assert.equal(intlLabel({ domestic: true, international: true }, "hammasi"), "O'zbekiston va xalqaro");
});
