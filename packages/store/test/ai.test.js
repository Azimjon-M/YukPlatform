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

test(".env kalitlari har provayder uchun alohida bir marta qo'shiladi (eski umumiy belgi — gemini/claude)", () => {
  const store = openStore({ file: ":memory:" });
  const env2 = { GEMINI_API_KEY: "env-gemini-kalit-1234", ONEPRO_API_KEY: "sk-onepro-kalit-9999" };
  const entries = [
    { provider: "gemini", models: ["flash-lite"] },
    { provider: "onepro", models: ["qwen3.8-flash"] },
  ];
  // Eski bazada gemini allaqachon qo'shilgan va umumiy belgi qo'yilgan edi
  store.db.prepare("INSERT INTO settings (key, value) VALUES ('ai_keys_seeded', '1')").run();
  assert.equal(store.seedAiKeys(entries, env2), 1, "faqat yangi provayder (onepro)");
  const keys = store.listAiKeys(access);
  assert.deepEqual(keys.map((k) => [k.provider, k.fromEnv, k.models.map((m) => m.model)]), [["onepro", true, ["qwen3.8-flash"]]]);
  assert.equal(store.seedAiKeys(entries, env2), 0, "ikkinchi marta qo'shilmaydi");
  // O'chirilsa — qayta qo'shilmaydi
  store.removeAiKey(keys[0].id);
  assert.equal(store.seedAiKeys(entries, env2), 0);
  // .env kaliti o'qiladi: ulanishda kalit .env dan
  const fresh = openStore({ file: ":memory:" });
  fresh.seedAiKeys(entries, env2);
  assert.deepEqual(
    fresh.aiConnections({ secret, env: env2 }).map((c) => [c.provider, c.model, c.apiKey]),
    [
      ["gemini", "flash-lite", "env-gemini-kalit-1234"],
      ["onepro", "qwen3.8-flash", "sk-onepro-kalit-9999"],
    ],
  );
  // Shu provayderning kaliti boshqaruv markazida qo'shilgan bo'lsa — .env dagisi qo'shilmaydi
  const ui = openStore({ file: ":memory:" });
  ui.addAiKey({ provider: "onepro", apiKey: "sk-boshqa-1111", models: ["qwen3.8-flash"] }, secret);
  assert.equal(ui.seedAiKeys(entries, env2), 1, "faqat gemini");
  assert.deepEqual(ui.listAiKeys().map((k) => k.provider), ["onepro", "gemini"]);
});

test(".env dagi Groq va OpenRouter kalitlari (2026-11-09) ham bir marta qo'shiladi, kalit .env dan o'qiladi", () => {
  const store = openStore({ file: ":memory:" });
  const entries = [
    { provider: "groq", models: ["openai/gpt-oss-120b"] },
    { provider: "openrouter", models: ["a:free"] },
  ];
  // OpenRouter kaliti hali yozilmagan — belgilanmaydi, keyinroq yozilsa qo'shiladi
  assert.equal(store.seedAiKeys(entries, { GROQ_API_KEY: "gsk_sinov_1234" }), 1);
  assert.equal(store.seedAiKeys(entries, { GROQ_API_KEY: "gsk_sinov_1234", OPENROUTER_API_KEY: "sk-or-v1-sinov-5678" }), 1, "endi OpenRouter");
  assert.equal(store.seedAiKeys(entries, { GROQ_API_KEY: "gsk_sinov_1234", OPENROUTER_API_KEY: "sk-or-v1-sinov-5678" }), 0);
  const env3 = { GROQ_API_KEY: "gsk_sinov_1234", OPENROUTER_API_KEY: "sk-or-v1-sinov-5678" };
  assert.deepEqual(
    store.aiConnections({ secret, env: env3 }).map((c) => [c.provider, c.model, c.apiKey]),
    [
      ["groq", "openai/gpt-oss-120b", "gsk_sinov_1234"],
      ["openrouter", "a:free", "sk-or-v1-sinov-5678"],
    ],
  );
  assert.deepEqual(store.listAiKeys(access).map((k) => [k.provider, k.keyHint]), [
    ["groq", "…1234"],
    ["openrouter", "…5678"],
  ]);

  // enabled: false — ro'yxatda bor, lekin bot ishlatmaydi (aniqligi past provayder); yoqilsa — ulanish paydo bo'ladi
  const off = openStore({ file: ":memory:" });
  assert.equal(off.seedAiKeys([{ provider: "groq", models: ["openai/gpt-oss-120b"], enabled: false }], env3), 1);
  const [row] = off.listAiKeys(access);
  assert.equal(row.enabled, false);
  assert.deepEqual(off.aiConnections({ secret, env: env3 }), []);
  off.updateAiKey(row.id, { enabled: true });
  assert.equal(off.aiConnections({ secret, env: env3 }).length, 1);
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

test("boshqaruv buyruqlari: uyg'otish va «muammoli» belgisini olib tashlash — control ga yoziladi, data darhol tuzatiladi", () => {
  let time = 1000;
  const store = openStore({ file: ":memory:", now: () => time });
  const id = store.addAiKey({ provider: "gemini", apiKey: "k-2222", models: ["a"] }, secret);
  const slot = `${id}:a`;
  assert.equal(store.aiConnections(access)[0].control, null);
  store.saveAiSlot({ id: slot, requests: 5, cooldownUntil: 9e12, reason: "daily", resetAt: 9e12, problem: { since: 1 }, faults: [1, 2], recent: "xx" });
  time = 2000;
  store.wakeAiSlot(slot);
  let [c] = store.aiConnections(access);
  assert.deepEqual(c.control, { wakeAt: 2000 });
  assert.deepEqual([c.state.cooldownUntil, c.state.reason, c.state.resetAt, c.state.requests], [null, null, null, 5]);
  assert.ok(c.state.problem, "uyg'otish belgini olmaydi");
  time = 3000;
  store.resetAiSlotHealth(slot);
  [c] = store.aiConnections(access);
  assert.deepEqual(c.control, { wakeAt: 3000, healthResetAt: 3000 });
  assert.deepEqual([c.state.problem, c.state.faults, c.state.recent], [null, [], ""]);
  // Bot keyin o'z holatini yozadi — control o'chmaydi (bot uni "ko'rdim" deb state'da belgilaydi)
  store.saveAiSlot({ ...c.state, wakeSeen: 3000, healthSeen: 3000 });
  assert.deepEqual(store.aiConnections(access)[0].control, { wakeAt: 3000, healthResetAt: 3000 });
  // Holati hali yo'q ulanish ham uyg'otiladi
  store.updateAiKey(id, { models: ["a", "b"] });
  store.wakeAiSlot(`${id}:b`);
  assert.equal(store.aiConnections(access)[1].control.wakeAt, 3000);
});

test("navbat: exclude — boshqa AI olgan e'lonlar ikkinchi marta olinmaydi", () => {
  const store = openStore({ file: ":memory:" });
  for (let i = 1; i <= 4; i++) store.addPost({ source: "@a", messageId: i, text: `e'lon ${i}`, postedAt: i * 1000 });
  assert.deepEqual(store.takeNewPosts(2, { newest: true }).map((p) => p.id), [4, 3]);
  assert.deepEqual(store.takeNewPosts(2, { newest: true, exclude: [4, 3] }).map((p) => p.id), [2, 1]);
  assert.deepEqual(store.takeNewPosts(10, { exclude: [1, 4] }).map((p) => p.id), [2, 3]);
});
