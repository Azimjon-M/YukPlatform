import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { LINK_PERIOD_S, createCallLinks, createSessions } from "../src/index.js";

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

test("«📞 Telefon qilish» havolasi: imzolangan, raqamning o'zi yo'q; buzilgani yoki boshqa kalitniki — null", () => {
  const secret = randomBytes(32);
  const calls = createCallLinks(secret);
  const token = calls.make({ loadId: 12345, phone: 1, chatId: 987654321 });
  assert.deepEqual(calls.read(token), { loadId: 12345, phone: 1, chatId: 987654321 });
  assert.ok(token.length < 50, `qisqa: ${token}`);
  assert.ok(!token.includes("998"), "raqam tokenda yo'q");

  // Boshqa yuk id — imzo mos kelmaydi (birov id'larni terib raqam yig'olmaydi)
  const [, phone, chat, signature] = token.split(".");
  assert.equal(calls.read(["9iy", phone, chat, signature].join(".")), null);
  assert.equal(calls.read(`${token.slice(0, -2)}xx`), null);
  assert.equal(createCallLinks(randomBytes(32)).read(token), null, "boshqa kalit");
  // Sessiya tokeni qo'ng'iroq havolasi o'rnida ishlamaydi (va aksincha)
  assert.equal(createSessions(secret).verify(token), null);
  assert.equal(calls.read(createSessions(secret).issue(5)), null);
  for (const bad of [undefined, "", "a.b.c", "1.0.1.x", "x".repeat(200)]) assert.equal(calls.read(bad), null);
  assert.throws(() => calls.make({ loadId: -1, chatId: 1 }));
});

test("qo'ng'iroq havolasi: tezkor e'lon tokeni (p.…) — yuk tokeni bilan almashtirib bo'lmaydi", () => {
  const secret = randomBytes(32);
  const calls = createCallLinks(secret);
  const token = calls.makePost({ postId: 777, phone: 0, chatId: 42 });
  assert.match(token, /^p\./);
  assert.deepEqual(calls.read(token), { postId: 777, phone: 0, chatId: 42 });
  // Imzo "p" bilan birga: "p." ni olib tashlab yuk tokeni qilib bo'lmaydi
  assert.equal(calls.read(token.slice(2)), null);
  assert.equal(calls.read(`${token.slice(0, -2)}xx`), null);
  assert.throws(() => calls.makePost({ postId: -5, chatId: 1 }));
});
