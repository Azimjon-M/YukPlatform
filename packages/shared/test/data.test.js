// Umumiy ma'lumotlar bir-biriga mos va to'liqligini tekshiradi
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_TYPE_IDS,
  CATEGORY_IDS,
  COUNTRIES,
  REGIONS,
  TRUCK_CLASSES,
  TRUCK_CLASS_IDS,
  sameArea,
} from "../src/index.js";

const unique = (list) => new Set(list).size === list.length;

test("id lar takrorlanmaydi", () => {
  assert.ok(unique(REGIONS.map((r) => r.id)));
  assert.ok(unique(TRUCK_CLASS_IDS));
  assert.ok(unique(BODY_TYPE_IDS));
  assert.ok(unique(COUNTRIES.map((c) => c.name)));
});

test("bitta shahar ikki viloyatda turmaydi", () => {
  const all = REGIONS.flatMap((r) => r.cities);
  const repeated = all.filter((city, i) => all.indexOf(city) !== i);
  assert.deepEqual(repeated, []);
});

test("haydovchi aytgan joylar ro'yxatda bor", () => {
  const cityRegion = (city) => REGIONS.find((r) => r.cities.includes(city))?.id;
  assert.equal(cityRegion("Baxmal"), "jizzax");
  assert.equal(cityRegion("Yangiyer"), "sirdaryo");
  assert.equal(cityRegion("To'ytepa"), "toshkent");
  assert.equal(cityRegion("Chelak"), "samarqand");
});

test("mashina sinflari: sig'imi va toifasi to'g'ri", () => {
  const byId = Object.fromEntries(TRUCK_CLASSES.map((t) => [t.id, t]));
  assert.deepEqual(byId.fura.capacityT, [20, 26]);
  assert.equal(byId.fura.pallets, 33);
  assert.equal(byId.labo.capacityT[1], 0.7);
  for (const t of TRUCK_CLASSES) {
    assert.ok(CATEGORY_IDS.includes(t.category), t.id);
    assert.ok(t.capacityT[0] < t.capacityT[1], t.id);
  }
});

test("Toshkent shahri va viloyati bitta hudud", () => {
  assert.equal(sameArea("toshkent_sh", "toshkent"), true);
  assert.equal(sameArea("toshkent", "toshkent_sh"), true);
  assert.equal(sameArea("fargona", "fargona"), true);
  assert.equal(sameArea("fargona", "andijon"), false);
  assert.equal(sameArea(null, "fargona"), false);
});
