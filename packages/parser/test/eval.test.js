import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, matchLoads, sameValue, upgradeLegacyLoad } from "../src/eval.js";

test("qiymatlarni solishtirish: harf, apostrof, son, massiv", () => {
  assert.ok(sameValue("Qo'qon", "qoʻqon"));
  assert.ok(sameValue(22, 22.1));
  assert.ok(!sameValue(22, 21));
  assert.ok(sameValue(null, undefined));
  assert.ok(sameValue([], undefined));
  assert.ok(sameValue(["ust", "orqa"], ["orqa", "ust"]));
  assert.ok(!sameValue(null, "tent"));
});

test("yuklar yo'nalish bo'yicha juftlanadi, tartibi farq qilsa ham", () => {
  const expected = [{ fromCity: "Qarshi", toCity: "Samarqand" }, { fromCity: "Qamashi", toCity: "Koson" }];
  const actual = [{ fromCity: "Qamashi", toCity: "Koson", id: 2 }, { fromCity: "Qarshi", toCity: "Samarqand", id: 1 }];
  assert.deepEqual(matchLoads(expected, actual).map((l) => l.id), [1, 2]);
});

test("baholash: maydonlar bo'yicha foiz va xatolar ro'yxati", () => {
  const gold = [
    { index: 1, textStart: "A", postType: "yuk_bor", loads: [{ fromCity: "Andijon", bodyType: null, weightT: 22 }] },
    { index: 2, textStart: "B", postType: "boshqa", loads: [] },
  ];
  const results = [
    { index: 1, text: "A...", ok: true, postType: "yuk_bor", loads: [{ fromCity: "Andijon", bodyType: "tent", weightT: 22 }] },
    { index: 2, text: "B...", ok: true, postType: "boshqa", loads: [] },
  ];
  const report = evaluate(gold, results);
  assert.deepEqual(report.fields.postType, { ok: 2, total: 2 });
  assert.deepEqual(report.fields.bodyType, { ok: 0, total: 1 });
  assert.deepEqual(report.fields.weightT, { ok: 1, total: 1 });
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].field, "bodyType");
  assert.deepEqual(report.warnings, []);
});

test("eski natijadagi vehicle maydoni yangi ko'rinishga o'tadi", () => {
  assert.equal(upgradeLegacyLoad({ vehicle: "tent" }).bodyType, "tent");
  assert.equal(upgradeLegacyLoad({ vehicle: "isuzu" }).truckClass, "isuzu");
  assert.equal(upgradeLegacyLoad({ vehicle: null }).bodyType, null);
  const fresh = { bodyType: "ref" };
  assert.equal(upgradeLegacyLoad(fresh), fresh);
});
