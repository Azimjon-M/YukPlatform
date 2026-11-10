import assert from "node:assert/strict";
import { test } from "node:test";
import { REGIONS, routeAreas, scopeCountries } from "@yuk/shared";
import { areaPoint, nearestArea, tapAction } from "../src/routeMap.js";

test("har viloyat va qo'shni davlatning xaritada nuqtasi bor, Xorijda — yo'q", () => {
  for (const region of REGIONS.filter((r) => r.id !== "xorij")) assert.ok(areaPoint(region.id), region.id);
  for (const name of scopeCountries("qoshni")) assert.ok(areaPoint(name), name);
  assert.equal(areaPoint("xorij"), null);
  assert.equal(areaPoint("yoq-joy"), null);
});

test("xarita doiralari bir-biriga juda yaqin emas (kamida ~80 km)", () => {
  const areas = routeAreas({ international: true }, "qoshni");
  const km = ([lat1, lon1], [lat2, lon2]) => {
    const dLat = (lat2 - lat1) * 111;
    const dLon = (lon2 - lon1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    return Math.hypot(dLat, dLon);
  };
  for (const a of areas) {
    for (const b of areas) {
      if (a.id >= b.id) continue;
      assert.ok(km(areaPoint(a.id), areaPoint(b.id)) > 80, `${a.id} — ${b.id}: ${Math.round(km(areaPoint(a.id), areaPoint(b.id)))} km`);
    }
  }
});

test("bosilgan joyga eng yaqin doira, uzoq bo'lsa — hech biri", () => {
  const points = [
    { id: "andijon", x: 100, y: 100 },
    { id: "namangan", x: 120, y: 100 },
  ];
  assert.equal(nearestArea(points, { x: 104, y: 102 }, 30), "andijon");
  assert.equal(nearestArea(points, { x: 116, y: 98 }, 30), "namangan");
  assert.equal(nearestArea(points, { x: 300, y: 300 }, 30), null);
  assert.equal(nearestArea([], { x: 0, y: 0 }, 30), null);
});

test("bosish: doiraning ustida — tanlanadi; ikki doira orasida va xarita uzoqda — kattalashadi; yaqinlashtirilgan — eng yaqini", () => {
  const points = [
    { id: "namangan", x: 100, y: 100 },
    { id: "andijon", x: 124, y: 104 },
  ];
  const opts = { maxPx: 34, hitPx: 11, canZoom: true };
  assert.deepEqual(tapAction(points, { x: 103, y: 101 }, opts), { pick: "namangan" }, "doira ustida");
  assert.deepEqual(tapAction(points, { x: 112, y: 102 }, opts), { zoom: true }, "o'rtasida");
  assert.deepEqual(tapAction(points, { x: 112, y: 102 }, { ...opts, canZoom: false }), { pick: "namangan" });
  assert.deepEqual(tapAction([points[0]], { x: 125, y: 100 }, opts), { pick: "namangan" }, "yonida boshqasi yo'q");
  assert.equal(tapAction(points, { x: 300, y: 300 }, opts), null);
});
