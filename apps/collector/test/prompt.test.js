import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { askHidden } from "../src/prompt.js";

// Haqiqiy terminal o'rniga soxta TTY: raw rejim faqat yozib qo'yiladi
function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.setRawMode = (on) => input.rawModes.push(on);
  let shown = "";
  const output = { write: (text) => { shown += text; } };
  return { input, output, shown: () => shown };
}

test("parol ekranda ko'rinmaydi, Backspace ishlaydi", async () => {
  const t = fakeTerminal();
  const answer = askHidden("Parol: ", t);
  t.input.write("maxf");
  t.input.write("\u007f"); // Backspace
  t.input.write("iy\r");
  assert.equal(await answer, "maxiy");
  assert.ok(!t.shown().includes("max"), "parol harflari chiqmasligi kerak");
  assert.ok(t.shown().startsWith("Parol: "));
  assert.deepEqual(t.input.rawModes, [true, false], "raw rejim yoqilib, keyin o'chirilishi kerak");
});

test("bir bo'lakda kelgan (paste qilingan) parol", async () => {
  const t = fakeTerminal();
  const answer = askHidden("Parol: ", t);
  t.input.write("abc123\r\n");
  assert.equal(await answer, "abc123");
});

test("Ctrl+C kirishni bekor qiladi", async () => {
  const t = fakeTerminal();
  const answer = askHidden("Parol: ", t);
  t.input.write("ab\u0003");
  await assert.rejects(answer, /Bekor qilindi/);
  assert.deepEqual(t.input.rawModes, [true, false]);
});
