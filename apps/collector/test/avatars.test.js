import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAvatarRefresher } from "../src/avatars.js";

test("yopiq guruh rasmi: bittadan, gapMs oraliq bilan; ochiq guruhga tegilmaydi; rasmi yo'q — «.none»", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-avatars-"));
  let time = 1_000_000_000_000;
  const asked = [];
  const reader = { photo: async (s) => (asked.push(s.value), s.value === "-1002" ? null : Buffer.from("IMG")) };
  const sources = () => [{ kind: "username", value: "ochiq" }, { kind: "id", value: "-1001" }, { kind: "id", value: "-1002" }];
  const tick = createAvatarRefresher({ reader, sources, dir, now: () => time, gapMs: 20_000 });
  await tick();
  await tick();
  assert.deepEqual(asked, ["-1001"], "20 s ichida — bitta");
  time += 21_000;
  await tick();
  assert.deepEqual(asked, ["-1001", "-1002"]);
  assert.equal(readFileSync(path.join(dir, "sources", "-1001.jpg"), "utf8"), "IMG");
  assert.ok(existsSync(path.join(dir, "sources", "-1002.jpg.none")));
});

test("yangi qo'shilgan (auto scan) guruh rasmi — navbatsiz va tez (newGapMs), eskirganlardan oldin; hammasi yangi — 1 daqiqada qayta qaraladi", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-avatars-"));
  let time = Date.now();
  const asked = [];
  const reader = { photo: async (s) => (asked.push(s.value), Buffer.from("IMG")) };
  const list = [{ kind: "id", value: "-1001" }];
  const tick = createAvatarRefresher({ reader, sources: () => list, dir, now: () => time, gapMs: 20_000, newGapMs: 3_000, idleMs: 60_000 });
  await tick();
  assert.deepEqual(asked, ["-1001"]);
  // -1001 rasmi eskirdi (8 kun oldin olingan); shu payt auto scan ikkita yangi guruh qo'shdi
  const old = (Date.now() - 8 * 24 * 3600_000) / 1000;
  utimesSync(path.join(dir, "sources", "-1001.jpg"), old, old);
  list.push({ kind: "id", value: "-1002" }, { kind: "id", value: "-1003" });
  time += 20_100;
  await tick();
  time += 3_100;
  await tick();
  assert.deepEqual(asked, ["-1001", "-1002", "-1003"], "yangilari birinchi, 3 s oraliq bilan");
  time += 3_100;
  await tick();
  assert.equal(asked.at(-1), "-1001", "keyin eskirgani");
  time += 20_100;
  await tick(); // hammasi yangi — 1 daqiqa dam
  list.push({ kind: "id", value: "-1004" });
  time += 30_000;
  await tick();
  assert.equal(asked.length, 4, "1 daqiqa o'tmagan");
  time += 31_000;
  await tick();
  assert.equal(asked.at(-1), "-1004");
});
