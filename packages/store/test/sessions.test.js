import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { LINK_PERIOD_S, createSessions } from "../src/index.js";

const DAY = 24 * 60 * 60 * 1000;

test("sessiya tokeni: o'z kaliti bilan o'qiladi, boshqa kalit yoki buzilgani — null", () => {
  const secret = randomBytes(32);
  const sessions = createSessions(secret, { now: () => 1_800_000_000_000 });
  const token = sessions.issue(555);
  assert.equal(sessions.verify(token), 555);
  assert.equal(createSessions(randomBytes(32)).verify(token), null);
  assert.equal(sessions.verify(`${token}x`), null);
  assert.equal(sessions.verify(token.replace(/^./, "A")), null);
});

test("menyu tugmasi tokeni (link): bir hafta bir xil, keyin yangisi; 4 haftadan ko'p amal qiladi, 5 haftadan keyin — yo'q", () => {
  const secret = randomBytes(32);
  const weekStart = 2970 * LINK_PERIOD_S * 1000; // hafta chegarasi
  let time = weekStart + 1000;
  const sessions = createSessions(secret, { now: () => time });
  const first = sessions.link(42);
  time = weekStart + 6 * DAY;
  assert.equal(sessions.link(42), first, "shu hafta ichida o'zgarmaydi — bot menyuni har xabarda qayta yubormaydi");
  assert.notEqual(sessions.link(43), first, "har odamniki o'zi");
  assert.notEqual(sessions.issue(42), first);
  time = weekStart + 7 * DAY + 1000;
  assert.notEqual(sessions.link(42), first, "yangi hafta — yangi token");

  // Eski token: oxirgi marta berilganidan 4 hafta o'tib ham ishlaydi, 5 haftadan keyin — yo'q
  time = weekStart + 6 * DAY + 28 * DAY;
  assert.equal(sessions.verify(first), 42);
  time = weekStart + 35 * DAY + 1000;
  assert.equal(sessions.verify(first), null);
});
