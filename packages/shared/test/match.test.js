import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDrivers,
  isInternational,
  loadFitsVehicle,
  matchLoad,
  routeMatches,
  vehicleCapacityKg,
  vehiclePallets,
  vehicleVolumeM3,
} from "../src/index.js";

const FURA = { truckClass: "fura", bodyType: "tent", capacityKg: 25000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: ["orqa", "yon", "ust"] };
const ISUZU = { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, loadingSides: ["orqa"] };

const load = (extra = {}) => ({
  fromCity: "Toshkent", fromRegion: "toshkent_sh", fromCountry: "O'zbekiston",
  toCity: "Samarqand", toRegion: "samarqand", toCountry: "O'zbekiston",
  weightT: null, volumeM3: null, pallets: null, truckClass: null, bodyType: null, loadingSides: [],
  ...extra,
});

test("kuzov o'lchamidan kub, palet va sig'im", () => {
  assert.equal(vehicleVolumeM3(FURA), 90);
  assert.equal(vehiclePallets(FURA), 33, "13.6 m furaga 33 ta yevropalet");
  assert.equal(vehiclePallets(ISUZU), 8);
  assert.equal(vehicleVolumeM3({}), null);
  assert.equal(vehicleCapacityKg({ truckClass: "isuzu" }), 9000, "sig'im yozilmasa — sinfning eng ko'pi");
  assert.equal(vehicleCapacityKg(ISUZU), 5000);
});

test("og'irlik, hajm, palet sig'masa — mos emas va sababi aytiladi", () => {
  assert.equal(loadFitsVehicle(load({ weightT: 5 }), ISUZU).ok, true);
  const heavy = loadFitsVehicle(load({ weightT: 6 }), ISUZU);
  assert.equal(heavy.ok, false);
  assert.match(heavy.reasons[0], /6 t/);
  assert.equal(loadFitsVehicle(load({ volumeM3: 105 }), FURA).ok, false, "mega fura 105 kub oddiy furaga sig'maydi");
  assert.equal(loadFitsVehicle(load({ pallets: 33 }), FURA).ok, true);
  assert.equal(loadFitsVehicle(load({ pallets: 10 }), ISUZU).ok, false);
});

test("sinf va kuzov yozilgan bo'lsa — aynan shu; yozilmagan bo'lsa — cheklov yo'q", () => {
  assert.equal(loadFitsVehicle(load({ truckClass: "fura" }), ISUZU).ok, false);
  assert.equal(loadFitsVehicle(load({ truckClass: "isuzu" }), ISUZU).ok, true);
  assert.equal(loadFitsVehicle(load({ bodyType: "ref" }), FURA).ok, false);
  assert.equal(loadFitsVehicle(load(), ISUZU).ok, true, "hech narsa yozilmagan yuk hammaga mos");
});

test("yuklash tomoni: birortasi bo'lsa yetadi, 'yon' chap/o'ngni ham qamraydi", () => {
  assert.equal(loadFitsVehicle(load({ loadingSides: ["ust"] }), ISUZU).ok, false);
  assert.equal(loadFitsVehicle(load({ loadingSides: ["ust", "orqa"] }), ISUZU).ok, true);
  assert.equal(loadFitsVehicle(load({ loadingSides: ["yon"] }), { ...ISUZU, loadingSides: ["chap"] }).ok, true);
  assert.equal(loadFitsVehicle(load({ loadingSides: ["ong"] }), { ...ISUZU, loadingSides: ["chap"] }).ok, false);
});

test("xalqaro yuk faqat xalqaro rejimdagi haydovchiga", () => {
  const abroad = load({ toCity: "Boku", toRegion: "xorij", toCountry: "Ozarbayjon" });
  assert.equal(isInternational(abroad), true);
  assert.equal(isInternational(load()), false);
  assert.equal(routeMatches(abroad, {}).ok, false);
  assert.equal(routeMatches(abroad, { international: true }).ok, true);
  assert.equal(routeMatches(load(), { international: true, domestic: false }).ok, false, "faqat xalqaro rejim");
});

test("yo'nalish: viloyat, Toshkent shahri = viloyati, davlat nomi, qaytish yuki", () => {
  const fromSurxon = load({ fromCity: null, fromRegion: "surxondaryo" });
  assert.equal(routeMatches(fromSurxon, { fromAreas: ["surxondaryo"] }).ok, true, "faqat viloyat yozilgan yuk shu viloyatdagilarga");
  assert.equal(routeMatches(fromSurxon, { fromAreas: ["toshkent"] }).ok, false);
  assert.equal(routeMatches(load(), { fromAreas: ["toshkent"] }).ok, true, "Toshkent shahri yuki viloyatdagi haydovchiga ham");
  const fromRussia = load({ fromCity: "Krasnodar", fromRegion: "xorij", fromCountry: "Rossiya", toCity: "Andijon", toRegion: "andijon" });
  assert.equal(routeMatches(fromRussia, { international: true, fromAreas: ["Rossiya"], toAreas: ["andijon"] }).ok, true, "Rossiyadan uyga qaytish");
  assert.equal(routeMatches(fromRussia, { international: true, fromAreas: ["xorij"] }).ok, true);
  assert.equal(routeMatches(fromRussia, { international: true, fromAreas: ["Qozog'iston"] }).ok, false);
});

test("'hammasi' rejimi mashinani tekshirmaydi, yo'nalishni tekshiradi", () => {
  const big = load({ weightT: 24, truckClass: "fura" });
  const isuzuDriver = { vehicle: ISUZU, mode: "own", fromAreas: ["toshkent_sh"] };
  assert.equal(matchLoad(big, isuzuDriver).ok, false);
  assert.equal(matchLoad(big, { ...isuzuDriver, mode: "all" }).ok, true);
  assert.equal(matchLoad(big, { ...isuzuDriver, mode: "all", fromAreas: ["andijon"] }).ok, false);
});

test("yuk kimlarga yuboriladi", () => {
  const drivers = [
    { id: 1, vehicle: FURA, fromAreas: ["toshkent"] },
    { id: 2, vehicle: ISUZU, fromAreas: ["toshkent"] },
    { id: 3, vehicle: FURA, fromAreas: ["andijon"] },
  ];
  assert.deepEqual(findDrivers(load({ weightT: 20 }), drivers).map((d) => d.id), [1]);
  assert.deepEqual(findDrivers(load({ weightT: 3 }), drivers).map((d) => d.id), [1, 2]);
});
