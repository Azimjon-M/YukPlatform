import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyFits,
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
  assert.equal(vehicleCapacityKg({ truckClass: "isuzu" }), 5000, "sig'im yozilmasa — sinfning eng ko'pi (Isuzu 5 t)");
  assert.equal(vehicleCapacityKg({ truckClass: "katta_isuzu" }), 10000);
  assert.equal(vehiclePallets({ ...FURA, bodyType: "samosval" }), null, "samosvalga palet qo'yilmaydi");
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

test("eski «hammasini ko'rish» (mode all) endi yo'q: mashinaga mos bo'lmagan yuk yuborilmaydi", () => {
  const big = load({ weightT: 24, truckClass: "fura" });
  const isuzuDriver = { vehicle: ISUZU, mode: "own", fromAreas: ["toshkent_sh"] };
  assert.equal(matchLoad(big, isuzuDriver).ok, false);
  assert.equal(matchLoad(big, { ...isuzuDriver, mode: "all" }).ok, false, "bazadagi eski profil ham");
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

test("katta fura va katta Isuzu: AI «fura» / «isuzu» degan yuklarni oladi, og'irlikni sig'im hal qiladi", () => {
  const kattaFura = { truckClass: "katta_fura", bodyType: "tent", capacityKg: 40_000 };
  const fura = { truckClass: "fura", bodyType: "tent", capacityKg: 25_000 };
  assert.equal(loadFitsVehicle(load({ truckClass: "fura", weightT: 35 }), kattaFura).ok, true);
  assert.deepEqual(loadFitsVehicle(load({ truckClass: "fura", weightT: 35 }), fura).reasons, ["og'irligi 35 tonna, mashina 25 tonna ko'taradi"]);
  assert.equal(loadFitsVehicle(load({ truckClass: "isuzu", weightT: 8 }), { truckClass: "katta_isuzu", capacityKg: 10_000 }).ok, true);
  assert.deepEqual(loadFitsVehicle(load({ truckClass: "kamaz" }), fura).reasons, ["Kamaz kerak"], "Kamaz yuki furaga emas");
  assert.deepEqual(loadFitsVehicle(load({ weightT: 0.3 }), { truckClass: "yengil_avto", capacityKg: 200 }).reasons, ["og'irligi 300 kg, mashina 200 kg ko'taradi"]);
});

test("kuzov almashinuvi: ref izotermik yukni ham oladi, plashatka — konteynerni; eski kodlar (bort, tral) — plashatka", () => {
  assert.equal(bodyFits("izoterm", "ref"), true);
  assert.equal(bodyFits("ref", "izoterm"), false, "sovutgichsiz kuzov ref yukini olmaydi");
  assert.equal(bodyFits("konteyner", "ploshatka"), true);
  assert.equal(bodyFits("bort", "ploshatka"), true);
  assert.equal(bodyFits("tral", "ploshatka"), true);
  assert.equal(bodyFits("sementavoz", "sisterna"), true);
  assert.equal(bodyFits("tent", "ref"), false);
  assert.equal(bodyFits(null, "ref"), true, "kuzov aytilmagan — cheklov yo'q");
  assert.deepEqual(loadFitsVehicle(load({ bodyType: "ref" }), { bodyType: "tent" }).reasons, ["Refrijerator / Ref kuzov kerak"]);
});
