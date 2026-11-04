import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSource } from "../src/sources.js";

test("guruh manzilining har xil yozilishi", () => {
  for (const input of ["@yuk_guruh", "yuk_guruh", "t.me/yuk_guruh", "https://t.me/yuk_guruh", "https://t.me/yuk_guruh/12345", " @yuk_guruh "]) {
    assert.deepEqual(normalizeSource(input), { kind: "username", value: "yuk_guruh" }, input);
  }
});

test("raqamli id", () => {
  assert.deepEqual(normalizeSource("-1001234567890"), { kind: "id", value: "-1001234567890" });
});

test("yopiq guruh taklif havolasi tushunarli xato beradi", () => {
  assert.throws(() => normalizeSource("https://t.me/+AbCdEf123"), /taklif havolasi/);
  assert.throws(() => normalizeSource("t.me/joinchat/AbCdEf"), /taklif havolasi/);
});

test("noto'g'ri manzil", () => {
  assert.throws(() => normalizeSource("salom dunyo"), /tushunarsiz/);
  assert.throws(() => normalizeSource("@ab"), /tushunarsiz/);
});
