import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capacityChoice,
  capacityKgOf,
  capacityUnit,
  formFromProfile,
  profileFromForm,
  selectClass,
  shipperFormFromProfile,
  shipperProfileFromForm,
  showSides,
  showSize,
  sizeSummary,
  toggle,
} from "../src/form.js";

const PROFILE = {
  vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: ["orqa"] },
  fromAreas: ["andijon"],
  toAreas: ["Rossiya"],
  domestic: true,
  international: true,
  mode: "own",
};

test("botdan kelgan sozlamalar formaga va qaytib profilga aylanadi (yo'nalish formada yo'q)", () => {
  const form = formFromProfile(PROFILE);
  assert.equal(form.sizeMode, "std");
  assert.equal(form.capacity, "22");
  assert.equal(form.intl, "ham");
  assert.equal(form.fromAreas, undefined);
  // Yo'nalish bo'sh ketadi — server saqlaganda haydovchining «📋 Mos yuklar» dagi yo'nalishini qoldiradi
  assert.deepEqual(profileFromForm(form).profile, {
    ...PROFILE,
    vehicle: { ...PROFILE.vehicle, bodyGuess: false },
    fromAreas: [],
    toAreas: [],
    routeAt: null,
  });
});

test("yangi haydovchi: bo'sh forma, xatolar kerakli bo'limni ko'rsatadi", () => {
  let form = formFromProfile(null);
  assert.equal(profileFromForm(form).field, "class");
  form = selectClass(form, "isuzu");
  assert.equal(form.sizeMode, "std");
  assert.equal(profileFromForm(form).field, "body");
  form = { ...form, bodyType: "boshqa", capacity: "ko'p" };
  assert.equal(profileFromForm(form).field, "capacity");
  form = { ...form, capacity: "7,5", sizeMode: "custom", size: { lengthM: "6", widthM: "9", heightM: "2" } };
  assert.equal(profileFromForm(form).field, "size");
  form = { ...form, size: { lengthM: "6,2", widthM: "2,4", heightM: "2,3" } };
  const { profile } = profileFromForm(form);
  assert.equal(profile.vehicle.capacityKg, 7500);
  assert.equal(profile.vehicle.bodyType, null);
  assert.deepEqual(profile.vehicle.body, { lengthM: 6.2, widthM: 2.4, heightM: 2.3 });
});

test("transport turi o'zgarsa sig'im tozalanadi; yengil mashinada kuzov va o'lcham yo'q", () => {
  const mini = selectClass(formFromProfile(PROFILE), "mini_fura");
  assert.equal(mini.capacity, "");
  assert.equal(mini.sizeMode, "std", "Mini furaning ham odatdagi o'lchami bor");
  const car = selectClass(formFromProfile(PROFILE), "yengil_avto");
  assert.deepEqual([car.bodyType, car.sizeMode, showSize(car), showSides(car), sizeSummary(car)], [null, "none", false, false, null]);
  assert.deepEqual(sizeSummary(formFromProfile(PROFILE)), { volumeM3: 90, pallets: 33 });
  assert.equal(sizeSummary({ ...formFromProfile(PROFILE), bodyType: "samosval" }).pallets, null, "samosvalga palet qo'yilmaydi");
  const tractor = { ...formFromProfile(PROFILE), bodyType: "tyagach" };
  assert.deepEqual([showSize(tractor), showSides(tractor)], [false, false]);
});

test("yuk ko'tarish: Labo va yengil mashinada kg, qolganida tonna; birlik adashsa ham to'g'ri", () => {
  assert.deepEqual([capacityUnit("labo"), capacityUnit("yengil_avto"), capacityUnit("isuzu"), capacityUnit("katta_fura")], ["kg", "kg", "tonna", "tonna"]);
  assert.equal(capacityKgOf("300", "kg"), 300);
  assert.equal(capacityKgOf("0,7", "kg"), 700, "kg joyiga tonna yozilsa");
  assert.equal(capacityKgOf("7,5", "tonna"), 7500);
  assert.equal(capacityKgOf("700", "tonna"), 700, "tonna joyiga kg yozilsa");
  assert.ok(Number.isNaN(capacityKgOf("ko'p", "tonna")));
  assert.deepEqual([capacityChoice(0.3, "kg"), capacityChoice(40, "tonna")], ["300", "40"]);

  const car = { ...selectClass(formFromProfile(null), "yengil_avto"), capacity: "400" };
  const { profile } = profileFromForm(car);
  assert.deepEqual(profile.vehicle, { truckClass: "yengil_avto", bodyType: null, capacityKg: 400, body: null, bodyGuess: false, loadingSides: [] });
  assert.match(profileFromForm({ ...car, capacity: "" }).error, /400 kg/);
});

test("«Bilmayman» — odatdagi o'lcham olinadi va belgilanadi; eski profil: «Yonidan» → o'ng va chap, bort → plashatka", () => {
  const form = { ...selectClass(formFromProfile(null), "katta_isuzu"), bodyType: "ref", capacity: "10", sizeMode: "none" };
  const { profile } = profileFromForm(form);
  assert.deepEqual(profile.vehicle.body, { lengthM: 7.2, widthM: 2.4, heightM: 2.3 });
  assert.equal(profile.vehicle.bodyGuess, true);
  assert.equal(formFromProfile(profile).sizeMode, "none", "qayta ochilganda ham «Bilmayman»");
  assert.deepEqual(sizeSummary(form), { volumeM3: 39.7, pallets: 10 }, "devorga 2 sm bo'shliq: eniga 3 ta palet sig'maydi");

  const old = formFromProfile({ ...PROFILE, vehicle: { ...PROFILE.vehicle, bodyType: "bort", loadingSides: ["orqa", "yon"] } });
  assert.equal(old.bodyType, "ploshatka");
  assert.deepEqual(old.loadingSides, ["orqa", "ong", "chap"]);
  assert.equal(formFromProfile({ ...PROFILE, vehicle: { ...PROFILE.vehicle, body: null } }).sizeMode, "none", "o'lchami yozilmagan eski profil");
});

test("«Qayerda ishlaysiz?»: qo'shni — xalqaro bor; ichki — faqat O'zbekiston", () => {
  const form = { ...formFromProfile(PROFILE), intl: "ham" };
  const qoshni = profileFromForm(form, "qoshni").profile;
  assert.deepEqual([qoshni.fromAreas, qoshni.domestic, qoshni.international], [[], true, true]);
  const ichki = profileFromForm(form, "ichki").profile;
  assert.deepEqual([ichki.domestic, ichki.international], [true, false]);
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
});

test("yuk beruvchi formasi: bo'sh — hammasi; profilga va qaytib; faqat O'zbekiston tanlansa davlat tashlanadi", () => {
  const empty = shipperProfileFromForm(shipperFormFromProfile(null), "qoshni").profile;
  assert.deepEqual(empty, { fromAreas: [], toAreas: [], domestic: true, international: false, truckClasses: [], bodyTypes: [] });

  const shipper = { fromAreas: ["samarqand", "Qozog'iston"], toAreas: [], domestic: true, international: true, truckClasses: ["fura", "isuzu"], bodyTypes: ["tent"] };
  const form = shipperFormFromProfile(shipper);
  assert.equal(form.intl, "ham");
  assert.deepEqual(shipperProfileFromForm(form, "qoshni").profile, shipper);
  const domestic = shipperProfileFromForm({ ...form, intl: "yoq" }, "qoshni").profile;
  assert.deepEqual([domestic.fromAreas, domestic.international], [["samarqand"], false]);
  // "Boshqa" kuzov va noma'lum mashina turi tashlanadi
  const odd = shipperProfileFromForm({ ...form, truckClasses: ["raketa", "fura"], bodyTypes: ["boshqa", "ref"] }, "qoshni").profile;
  assert.deepEqual([odd.truckClasses, odd.bodyTypes], [["fura"], ["ref"]]);
});
