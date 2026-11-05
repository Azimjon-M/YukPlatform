import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decryptText, encryptText, keyHint, loadSecret, openStore } from "../src/index.js";

const secret = Buffer.alloc(32, 7);
const env = { GEMINI_API_KEY: "env-gemini-kalit-1234" };
const access = { secret, env };

test("shifrlash: qaytadi, boshqa kalit yoki o'zgartirilgan matn o'qilmaydi", () => {
  const blob = encryptText("maxfiy-kalit", secret);
  assert.ok(!blob.includes("maxfiy"));
  assert.equal(decryptText(blob, secret), "maxfiy-kalit");
  assert.notEqual(encryptText("maxfiy-kalit", secret), blob, "har safar boshqa iv");
  assert.throws(() => decryptText(blob, Buffer.alloc(32, 8)));
  assert.throws(() => decryptText(`${blob.slice(0, -4)}AAAA`, secret));
  assert.equal(keyHint(" abcdefWXYZ "), "…WXYZ");
});

test("secret.key: bir marta yaratiladi, keyin o'sha o'qiladi", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "yuk-secret-")), "data", "secret.key");
  const first = loadSecret({ file });
  assert.equal(first.length, 32);
  assert.deepEqual(loadSecret({ file }), first);
  assert.equal(Buffer.from(readFileSync(file, "utf8").trim(), "base64").length, 32);
});

test("kalitlar: .env dan bir marta, qo'shish, takror, modellar = ulanishlar", () => {
  const store = openStore({ file: ":memory:" });
  assert.equal(store.seedAiKeys([{ provider: "gemini", models: ["flash-lite"] }], {}), 0, ".env da kalit yo'q");
  assert.equal(store.seedAiKeys([{ provider: "gemini", models: ["flash-lite"] }], env), 1);
  assert.equal(store.seedAiKeys([{ provider: "gemini", models: ["flash-lite"] }], env), 0, "ikkinchi marta qo'shilmaydi");

  const id = store.addAiKey({ provider: "gemini", label: "Ikkinchi", apiKey: " yangi-kalit-5678 ", models: ["a", "b"] }, secret);
  const raw = store.db.prepare("SELECT key_enc FROM ai_keys WHERE id = ?").get(id).key_enc;
  assert.ok(!raw.includes("yangi-kalit"), "bazada ochiq yozilmaydi");
  assert.equal(store.findAiKey("gemini", "yangi-kalit-5678", access), id);
  assert.equal(store.findAiKey("gemini", "env-gemini-kalit-1234", access), 1, ".env dagisi ham topiladi");
  assert.equal(store.findAiKey("claude", "yangi-kalit-5678", access), null);

  const listed = store.listAiKeys(access);
  assert.deepEqual(listed.map((k) => [k.label, k.fromEnv, k.keyHint, k.problem]), [[".env kaliti", true, "…1234", null], ["Ikkinchi", false, "…5678", null]]);
  assert.ok(!JSON.stringify(listed).includes("kalit-5678"), "ro'yxatda kalitning o'zi yo'q");

  const conns = store.aiConnections(access);
  assert.deepEqual(conns.map((c) => [c.id, c.label, c.apiKey]), [
    ["1:flash-lite", ".env kaliti · flash-lite", "env-gemini-kalit-1234"],
    [`${id}:a`, "Ikkinchi · a", "yangi-kalit-5678"],
    [`${id}:b`, "Ikkinchi · b", "yangi-kalit-5678"],
  ]);
  assert.equal(store.aiConnections({ secret, env: {} }).length, 2, ".env da kalit o'chirilsa — o'sha ulanish tushadi");
  assert.match(store.listAiKeys({ secret, env: {} })[0].problem, /GEMINI_API_KEY/);
  assert.match(store.listAiKeys({ secret: Buffer.alloc(32, 1), env })[1].problem, /qayta qo'shing/);
});

test("kalitlar: o'zgartirish, o'chirish; ulanish holati saqlanadi va kalit bilan o'chadi", () => {
  const store = openStore({ file: ":memory:" });
  const id = store.addAiKey({ provider: "gemini", apiKey: "k-1111", models: ["a"] }, secret);
  store.saveAiSlot({ id: `${id}:a`, requests: 12, cooldownUntil: 99 });
  assert.equal(store.aiConnections(access)[0].state.requests, 12);
  assert.equal(store.listAiKeys()[0].models[0].state.cooldownUntil, 99);
  assert.equal(store.updateAiKey(id, { enabled: false, models: ["a", "c"], label: "Yangi nom" }), true);
  assert.equal(store.aiConnections(access).length, 0, "o'chirilgan kalit ishlatilmaydi");
  assert.deepEqual(store.listAiKeys()[0].models.map((m) => m.model), ["a", "c"]);
  assert.equal(store.updateAiKey(999, { enabled: true }), false);
  assert.equal(store.removeAiKey(id), true);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM ai_slots").get().n, 0);
  assert.equal(store.removeAiKey(id), false);
});

test("navbat: exclude — boshqa AI olgan e'lonlar ikkinchi marta olinmaydi", () => {
  const store = openStore({ file: ":memory:" });
  for (let i = 1; i <= 4; i++) store.addPost({ source: "@a", messageId: i, text: `e'lon ${i}`, postedAt: i * 1000 });
  assert.deepEqual(store.takeNewPosts(2, { newest: true }).map((p) => p.id), [4, 3]);
  assert.deepEqual(store.takeNewPosts(2, { newest: true, exclude: [4, 3] }).map((p) => p.id), [2, 1]);
  assert.deepEqual(store.takeNewPosts(10, { exclude: [1, 4] }).map((p) => p.id), [2, 3]);
});
