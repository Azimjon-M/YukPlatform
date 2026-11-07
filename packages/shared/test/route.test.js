// Haydovchining yo'nalishi (bot «📋 Mos yuklar» va web «Yuklar»): joylar, sonlar, saqlash
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_ANY, applyRoute, routeAreaLabel, routeAreas, routeCounts, routeSide, validRouteArea } from "../src/index.js";

const DRIVER = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: null, loadingSides: [] },
  fromAreas: [],
  toAreas: [],
  domestic: true,
  international: false,
  routeAt: null,
};
const row = (load) => ({ load: { loadingSides: [], phones: ["+998900000001"], ...load } });
const ROWS = [
  row({ fromRegion: "andijon", toRegion: "toshkent_sh", weightT: 3 }),
  row({ fromRegion: "andijon", toRegion: "namangan", weightT: 4 }),
  row({ fromRegion: "andijon", toRegion: "buxoro", weightT: 20 }), // Isuzuga sig'maydi
  row({ fromRegion: "xorij", fromCountry: "Qozog'iston", toRegion: "toshkent_sh", weightT: 2 }),
];
const counts = (result) => Object.fromEntries(result.areas.filter((a) => a.count).map((a) => [a.id, a.count]));

test("joylar «Qayerda ishlaysiz?» ga qarab: faqat O'zbekiston — viloyatlar; qo'shnilar bilan — davlatlar ham", () => {
  const domestic = routeAreas(DRIVER, "qoshni");
  assert.equal(domestic.length, 14, "12 viloyat, Qoraqalpog'iston va Toshkent shahri");
  assert.ok(!domestic.some((a) => a.label.includes("🌍")));
  const intl = routeAreas({ ...DRIVER, international: true }, "qoshni").map((a) => a.id);
  assert.ok(intl.includes("Qozog'iston") && intl.includes("Afg'oniston") && !intl.includes("Rossiya"));
  assert.ok(routeAreas({ ...DRIVER, international: true }, "hammasi").some((a) => a.id === "xorij"));
  assert.equal(routeAreas({ ...DRIVER, international: true }, "ichki").length, 14, "ichki doirada xorij yo'q");
  assert.equal(validRouteArea(DRIVER, "qoshni", "Qozog'iston"), false);
  assert.equal(validRouteArea(DRIVER, "qoshni", ROUTE_ANY), true);
  assert.equal(validRouteArea(DRIVER, "qoshni", { id: "andijon" }), false, "so'rovdan kelgan narsa — faqat joy kodi");
  assert.equal(routeAreaLabel(DRIVER, "qoshni", "andijon"), "Andijon vil.");
});

test("sonlar: «Qayerdan?» — har joydan, «Qayerga?» — tanlangan joydan; sig'maydigan va xalqaro sanalmaydi", () => {
  const from = routeCounts({ profile: DRIVER, scope: "qoshni", rows: ROWS });
  assert.deepEqual(counts(from), { andijon: 2 });
  assert.equal(from.any, 2);
  const to = routeCounts({ profile: DRIVER, scope: "qoshni", rows: ROWS, from: "andijon" });
  // Toshkent shahri = viloyati (sameArea): shahar yuki viloyat tugmasida ham sanaladi
  assert.deepEqual(counts(to), { toshkent_sh: 1, toshkent: 1, namangan: 1 });
  assert.equal(to.any, 2);
  const anyFrom = routeCounts({ profile: { ...DRIVER, international: true }, scope: "qoshni", rows: ROWS, from: ROUTE_ANY });
  assert.deepEqual(counts(anyFrom), { toshkent_sh: 2, toshkent: 2, namangan: 1 }, "Qozog'istondan Toshkentga — xalqaro haydovchiga");
  assert.equal(anyFrom.any, 3);
});

test("saqlash va hozirgi tanlov: bitta joy — kodi, istalgan — \"*\", eski formadagi bir nechta joy — null", () => {
  const chosen = applyRoute(DRIVER, "andijon", ROUTE_ANY, 123);
  assert.deepEqual([chosen.fromAreas, chosen.toAreas, chosen.routeAt], [["andijon"], [], 123]);
  assert.equal(routeSide(chosen, "from"), "andijon");
  assert.equal(routeSide(chosen, "to"), ROUTE_ANY);
  assert.equal(routeSide(DRIVER, "from"), null, "hali tanlanmagan");
  assert.equal(routeSide({ ...DRIVER, fromAreas: ["andijon", "namangan"] }, "from"), null);
  assert.equal(routeSide(null, "from"), null);
});
