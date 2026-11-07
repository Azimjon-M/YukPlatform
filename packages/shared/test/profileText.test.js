import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProfile, emptyShipperProfile, profileRows } from "../src/index.js";

const DRIVER = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, loadingSides: ["orqa", "ust"] },
  routeAt: 1,
  fromAreas: ["toshkent_sh"],
  toAreas: [],
  domestic: true,
  international: false,
  mode: "own",
};

test("haydovchi profili: qatorlar (web «Tekshiring») va bot matni bir xil manbadan", () => {
  const rows = profileRows(DRIVER, "qoshni");
  assert.deepEqual(rows.map((r) => r.id), ["vehicle", "size", "sides", "intl", "route"]);
  assert.equal(rows[0].value, "Isuzu, Tent / furgon, 5 tonna");
  assert.equal(rows[1].value, "4,85 × 2,15 × 1,95 m (≈ 20,3 kub, 8 palet)");
  const text = describeProfile(DRIVER, "qoshni");
  assert.match(text, /^🚚 Transport: Isuzu, Tent \/ furgon, 5 tonna\n📏 Kuzov: /);
  assert.match(text, /↕️ Yuklash: orqasidan, ustidan/);
  assert.match(text, /\n🌍 Faqat O'zbekiston\n📍 Yo'nalish: Toshkent shahri → istalgan joy$/);
  // Ro'yxatdan o'tish formasida yo'nalish yo'q (botdagi «📋 Mos yuklar» da tanlanadi)
  assert.ok(!profileRows(DRIVER, "qoshni", "haydovchi", { web: true }).some((r) => r.id === "route"));
  assert.match(describeProfile({ ...DRIVER, fromAreas: [], routeAt: null }, "qoshni"), /📍 Yo'nalish: tanlanmagan/);
  // O'lchami yo'q mashina — «Kuzov» qatori yo'q; «Bilmayman» — odatdagi o'lcham deb yoziladi
  assert.ok(!profileRows({ ...DRIVER, vehicle: { ...DRIVER.vehicle, body: null } }).some((r) => r.id === "size"));
  assert.match(profileRows({ ...DRIVER, vehicle: { ...DRIVER.vehicle, bodyGuess: true } })[1].value, /— odatdagi o'lcham$/);
  // Tyagach va samosvalda yuklash tomoni so'ralmaydi; samosvalda palet yo'q; yengil mashina — kg bilan
  const tipper = { ...DRIVER, vehicle: { ...DRIVER.vehicle, truckClass: "kamaz", bodyType: "samosval", capacityKg: 30_000 } };
  assert.ok(!profileRows(tipper).some((r) => r.id === "sides"));
  assert.equal(profileRows(tipper)[1].value, "4,85 × 2,15 × 1,95 m (≈ 20,3 kub)");
  assert.equal(profileRows({ ...DRIVER, vehicle: { truckClass: "yengil_avto", bodyType: null, capacityKg: 400, body: null } })[0].value, "Yengil mashina, 400 kg");
});

test("yuk beruvchi profili va «ichki» doira: web'da 🌍 qatori yo'q (u yerda xalqaro savoli ham yo'q)", () => {
  const shipper = { ...emptyShipperProfile(), fromAreas: ["andijon"], truckClasses: ["isuzu"] };
  const rows = profileRows(shipper, "qoshni", "yuk_beruvchi");
  assert.deepEqual(rows.map((r) => r.id), ["from", "to", "classes", "bodies", "intl"]);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.value), ["Andijon vil.", "istalgan joy", "Isuzu", "istalgan"]);
  assert.ok(!profileRows(shipper, "ichki", "yuk_beruvchi", { web: true }).some((r) => r.id === "intl"));
  assert.ok(profileRows(shipper, "ichki", "yuk_beruvchi").some((r) => r.id === "intl"), "bot matni o'zgarmaydi");
  assert.match(describeProfile(shipper, "qoshni", "yuk_beruvchi"), /^📍 Yuk qayerda: Andijon vil\.\n🏁 Qayerga: istalgan joy\n🚚 Transport: Isuzu/);
});
