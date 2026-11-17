import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
