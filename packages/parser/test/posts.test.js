import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPosts } from "../src/posts.js";

test("e'lonlar --- bo'yicha bo'linadi, bo'shlari tashlanadi", () => {
  const text = "birinchi\n2-qator\n---\nikkinchi\n  ----  \n\n---\nuchinchi - bu yerda chiziqcha bor\n";
  assert.deepEqual(splitPosts(text), ["birinchi\n2-qator", "ikkinchi", "uchinchi - bu yerda chiziqcha bor"]);
});

test("Windows qator oxiri (\\r\\n) bilan ham ishlaydi", () => {
  assert.deepEqual(splitPosts("bir\r\n---\r\nikki\r\n"), ["bir", "ikki"]);
});

test("bo'sh fayl — bo'sh ro'yxat", () => {
  assert.deepEqual(splitPosts(""), []);
  assert.deepEqual(splitPosts("\n\n---\n"), []);
});
