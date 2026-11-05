import { test } from "node:test";
import assert from "node:assert/strict";
import { formFromProfile, profileFromForm, selectClass, sizeSummary, toggle } from "../src/form.js";

const PROFILE = {
  vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: ["orqa"] },
  fromAreas: ["andijon"],
  toAreas: ["Rossiya"],
  domestic: true,
  international: true,
  mode: "own",
};

test("botdan kelgan sozlamalar formaga va qaytib profilga aylanadi", () => {
  const form = formFromProfile(PROFILE);
  assert.equal(form.sizeMode, "std");
  assert.equal(form.capacity, "22");
  assert.equal(form.intl, "ham");
  assert.deepEqual(profileFromForm(form).profile, PROFILE);
});

test("yangi haydovchi: bo'sh forma, xatolar kerakli bo'limni ko'rsatadi", () => {
  let form = formFromProfile(null);
  assert.equal(profileFromForm(form).field, "class");
  form = selectClass(form, "isuzu");
  assert.equal(form.sizeMode, "std");
  assert.equal(profileFromForm(form).field, "body");
  form = { ...form, bodyType: "boshqa", capacity: "ko'p" };
  assert.equal(profileFromForm(form).field, "capacity");
  form = { ...form, capacity: "7,5", sizeMode: "custom", size: { lengthM: "6", widthM: "9", heightM: "2" } };
  assert.equal(profileFromForm(form).field, "size");
  form = { ...form, size: { lengthM: "6,2", widthM: "2,4", heightM: "2,3" } };
  const { profile } = profileFromForm(form);
  assert.equal(profile.vehicle.capacityKg, 7500);
  assert.equal(profile.vehicle.bodyType, null);
  assert.deepEqual(profile.vehicle.body, { lengthM: 6.2, widthM: 2.4, heightM: 2.3 });
});

test("mashina turi o'zgarsa sig'im tozalanadi; sinfda standart o'lcham bo'lmasa — o'lchamsiz", () => {
  const form = selectClass(formFromProfile(PROFILE), "mini_fura");
  assert.equal(form.capacity, "");
  assert.equal(form.sizeMode, "none");
  assert.equal(sizeSummary(form), null);
  assert.deepEqual(sizeSummary(formFromProfile(PROFILE)), { volumeM3: 90, pallets: 33 });
});

test("faqat O'zbekiston tanlansa, xorijiy davlatlar tashlanadi", () => {
  const form = { ...formFromProfile(PROFILE), intl: "yoq", toAreas: ["Rossiya", "toshkent"] };
  const { profile } = profileFromForm(form);
  assert.deepEqual(profile.toAreas, ["toshkent"]);
  assert.equal(profile.international, false);
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
});
