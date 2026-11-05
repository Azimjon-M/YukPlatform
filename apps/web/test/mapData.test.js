import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByPlace, markerRadius } from "../src/mapData.js";

const item = (id, load) => ({ id, load, post: { postedAt: 0 } });

test("yuklar joy bo'yicha guruhlanadi, eng ko'pi birinchi; joyi yo'qlari sanaladi", () => {
  const items = [
    item(1, { fromCity: "Qo'qon", fromRegion: "fargona", toRegion: "toshkent_sh" }),
    item(2, { fromCity: "Toshkent", fromRegion: "toshkent_sh", toCity: "Samarqand", toRegion: "samarqand" }),
    item(3, { fromRegion: "toshkent_sh", toCity: "Olmaota", toRegion: "xorij", toCountry: "Qozog'iston" }),
    item(4, { toRegion: "andijon" }),
  ];
  const from = groupByPlace(items, "from");
  assert.deepEqual(
    from.groups.map((g) => [g.key, g.items.length]),
    [
      ["toshkent_sh|Toshkent", 2],
      ["fargona|Qo'qon", 1],
    ],
  );
  assert.equal(from.unplaced, 1);
  const to = groupByPlace(items, "to");
  assert.equal(to.groups.length, 4);
  assert.equal(to.unplaced, 0);
});

test("doira kattaligi: eng kattasi 24, eng kichigi 7 dan kam emas", () => {
  assert.equal(markerRadius(10, 10), 24);
  assert.ok(markerRadius(1, 400) >= 7);
  assert.ok(markerRadius(1, 10) < markerRadius(5, 10));
});
