import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPosts } from "@yuk/parser/posts";
import { appendPosts, cleanText, selectNewPosts } from "../src/samples.js";

const A = "Тошкент - Фаргона 20т тент 90 123 45 67";
const B = "Samarqanddan Moskvaga ref kerak 22t, 91 234 56 78";

test("xabar ichidagi --- qatori e'lonni bo'lib yubormaydi", () => {
  const text = "Тошкент - Фаргона\n---\n20т тент 90 123 45 67";
  const file = appendPosts("", [cleanText(text)]);
  assert.equal(splitPosts(file).length, 1);
});

test("qisqa xabarlar va takrorlar tashlanadi (fayldagilar bilan ham)", () => {
  const existing = appendPosts("", [A]);
  const { posts, short, duplicate } = selectNewPosts(
    [B, "ok", "Rahmat!", "  " + A.toUpperCase() + "  ", B],
    existing,
    { minLength: 20 },
  );
  assert.deepEqual(posts, [B]);
  assert.equal(short, 2);
  assert.equal(duplicate, 2);
});

test("bo'sh faylga va mavjud faylga qo'shish to'g'ri formatda", () => {
  const first = appendPosts("", [A]);
  const second = appendPosts(first, [B]);
  assert.deepEqual(splitPosts(second), [A, B]);
  assert.equal(appendPosts(second, []), second);
});

test("Windows qator oxiri va ortiqcha bo'sh qatorlar tozalanadi", () => {
  assert.equal(cleanText("bir  \r\n\r\n\r\n\r\nikki\r\n"), "bir\n\nikki");
});
