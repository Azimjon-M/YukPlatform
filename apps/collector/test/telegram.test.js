import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/telegram.js";

// 8a236e5 da readConfig tasodifan o'chib ketgan edi: createClient «readConfig is not defined» bilan yiqilib,
// collector umuman ulanmasdi. Testlar Telegram'ga ulanmaydi, shuning uchun buni hech kim sezmagan — endi seziladi
test("readConfig: .env dagi TG_API_ID va TG_API_HASH; yo'q bo'lsa — tushunarli xato", () => {
  assert.deepEqual(readConfig({ TG_API_ID: "12345", TG_API_HASH: "abc" }), { apiId: 12345, apiHash: "abc" });
  assert.throws(() => readConfig({}), /TG_API_ID va TG_API_HASH topilmadi/);
  assert.throws(() => readConfig({ TG_API_ID: "x", TG_API_HASH: "abc" }), /topilmadi/);
});
