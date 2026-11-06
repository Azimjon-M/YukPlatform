import { test } from "node:test";
import assert from "node:assert/strict";
import {
  truckPlaceText,
  truckVehicleText,
  decodeProfile,
  emptyShipperProfile,
  encodeProfile,
  isAdmin,
  matchTruck,
  parseAdminIds,
  planAllows,
  roleOf,
  sanitizeProfileFor,
  sanitizeShipperProfile,
  validRole,
} from "../src/index.js";

// Bo'sh mashina e'loni (parser "mashina_bor" ni yuk maydonlarida yozadi)
const truck = (extra = {}) => ({
  fromCity: "Samarqand", fromRegion: "samarqand", fromCountry: "O'zbekiston",
  toCity: "Toshkent", toRegion: "toshkent_sh", toCountry: "O'zbekiston",
  truckClass: "fura", bodyType: "tent", weightT: 22,
  ...extra,
});

test("rol: faqat ikki xil; rolsiz eski yozuv profili bilan — haydovchi", () => {
  assert.equal(validRole("yuk_beruvchi"), "yuk_beruvchi");
  assert.equal(validRole("admin"), null, "admin — rol emas, alohida huquq");
  assert.equal(roleOf({ role: null, profile: { vehicle: {} } }), "haydovchi");
  assert.equal(roleOf({ role: null, profile: null }), null);
  assert.equal(roleOf({ role: "yuk_beruvchi", profile: null }), "yuk_beruvchi");
});

test("admin: .env dagi ADMIN_IDS yoki boshqaruv markazidagi belgi", () => {
  assert.deepEqual(parseAdminIds("123, 456 x 789"), [123, 456, 789]);
  assert.equal(isAdmin({ chatId: 456, isAdmin: false }, [123, 456]), true);
  assert.equal(isAdmin({ chatId: 7, isAdmin: true }, []), true);
  assert.equal(isAdmin({ chatId: 7, isAdmin: false }, [123]), false);
  assert.equal(isAdmin(null, [123]), false);
});

test("obuna: hozircha hamma uchun yuboriladi (pullik obuna uchun joy)", () => {
  assert.equal(planAllows({ plan: "free" }, { kind: "yuk" }), true);
  assert.equal(planAllows({}, {}), true);
});

test("yuk beruvchi profili: ro'yxatdan tashqarisi tashlanadi, doira hisobga olinadi", () => {
  const { profile } = sanitizeShipperProfile(
    {
      fromAreas: ["samarqand", "yo'q_joy", "Rossiya"],
      toAreas: ["toshkent_sh", "Qozog'iston"],
      truckClasses: ["fura", "raketa", "fura"],
      bodyTypes: ["tent", "boshqa", "ref"],
      international: true,
    },
    { scope: "qoshni" },
  );
  assert.deepEqual(profile, {
    fromAreas: ["samarqand"],
    toAreas: ["toshkent_sh", "Qozog'iston"],
    domestic: true,
    international: true,
    truckClasses: ["fura"],
    bodyTypes: ["tent", "ref"],
  });
  assert.deepEqual(sanitizeShipperProfile({ international: true }, { scope: "ichki" }).profile.international, false, "ichki doirada xalqaro yo'q");
  assert.match(sanitizeShipperProfile({ domestic: false, international: false }).error, /bittasini/);
  assert.deepEqual(sanitizeShipperProfile({}).profile, emptyShipperProfile());
});

test("sanitizeProfileFor: rolga qarab, rolsiz — xato", () => {
  assert.ok(sanitizeProfileFor("yuk_beruvchi", {}).profile);
  assert.match(sanitizeProfileFor("haydovchi", {}).error, /Mashina turini/);
  assert.match(sanitizeProfileFor(null, {}).error, /haydovchi yoki yuk beruvchi/);
});

test("decodeProfile: yuk beruvchi profili ?p= orqali ham o'tadi", () => {
  const profile = { ...emptyShipperProfile(), fromAreas: ["samarqand"], truckClasses: ["isuzu"] };
  assert.deepEqual(decodeProfile(encodeProfile(profile), { role: "yuk_beruvchi" }), profile);
  assert.equal(decodeProfile(encodeProfile(profile)), null, "haydovchi profili sifatida yaroqsiz (mashina turi yo'q)");
});

test("matchTruck: yo'nalish, mashina turi va kuzov; yozilmagan narsa cheklov emas", () => {
  const shipper = { ...emptyShipperProfile(), fromAreas: ["samarqand"], toAreas: ["toshkent"], truckClasses: ["fura"], bodyTypes: ["tent"] };
  assert.deepEqual(matchTruck(truck(), shipper), { ok: true, reasons: [] }, "Toshkent shahri = Toshkent viloyati");
  assert.deepEqual(matchTruck(truck({ fromRegion: "buxoro", fromCity: "Buxoro" }), shipper).reasons, ["boshqa joyda"]);
  assert.deepEqual(matchTruck(truck({ toRegion: "xorazm", toCity: "Urganch" }), shipper).reasons, ["boshqa tomonga boradi"]);
  assert.deepEqual(matchTruck(truck({ truckClass: "isuzu" }), shipper).reasons, ["isuzu kerak emas"]);
  assert.deepEqual(matchTruck(truck({ bodyType: "ref" }), shipper).reasons, ["ref kuzov kerak emas"]);

  // "Samarqanddan yuk olaman" — qayerga yozilmagan: istalgan joyga boradi
  assert.equal(matchTruck(truck({ toCity: null, toRegion: null, toCountry: null }), shipper).ok, true);
  // Mashina turi yozilmagan — cheklov yo'q
  assert.equal(matchTruck(truck({ truckClass: null, bodyType: null }), shipper).ok, true);
  // Yuk beruvchi hech narsa tanlamagan — hamma O'zbekiston ichidagi bo'sh mashina
  assert.equal(matchTruck(truck({ truckClass: "labo" }), emptyShipperProfile()).ok, true);
});

test("matchTruck: xalqaro mashina faqat xalqaro rejimdagi yuk beruvchiga", () => {
  const kz = truck({ toCity: "Olmaota", toRegion: "xorij", toCountry: "Qozog'iston" });
  assert.deepEqual(matchTruck(kz, emptyShipperProfile()).reasons, ["xalqaro mashina"]);
  assert.equal(matchTruck(kz, { ...emptyShipperProfile(), international: true }).ok, true);
  assert.deepEqual(matchTruck(truck(), { ...emptyShipperProfile(), domestic: false, international: true }).reasons, ["O'zbekiston ichidagi mashina"]);
});

test("bo'sh mashina matni: qayerga yozilmasa — istalgan joyga; tonna — ko'taradi", () => {
  const truck = { fromRegion: "samarqand", fromCity: "Samarqand", truckClass: "fura", bodyType: "tent", weightT: 22 };
  assert.equal(truckPlaceText(truck, "from"), "Samarqand");
  assert.equal(truckPlaceText(truck, "to"), "istalgan joyga");
  assert.equal(truckPlaceText({}, "from"), "?");
  assert.equal(truckPlaceText({ toRegion: "xorij", toCountry: "Qozog'iston" }, "to"), "Qozog'iston");
  assert.equal(truckVehicleText(truck), "Fura · tent · 22 t ko'taradi");
  assert.equal(truckVehicleText({}), "");
});
