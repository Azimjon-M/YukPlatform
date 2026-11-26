// Ilovaga kod yuborishdan oldingi a'zolik tekshiruvi (botMessage.js createMemberCheck) — soxta Telegram bilan
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemberCheck, readChats } from "../src/botMessage.js";

const fakeTelegram = (answers) => async (url, options) => {
  const { chat_id: chat } = JSON.parse(options.body);
  return { json: async () => answers[chat] };
};

test("a'zolik: hammasiga a'zo — ok; chiqib ketgan — missing; Telegram xatosi — null (bilmaymiz)", async () => {
  const refs = readChats("@Yuk_Ekspert, @Yuk_Ekspert_chat");
  assert.deepEqual(refs, ["@Yuk_Ekspert", "@Yuk_Ekspert_chat"]);
  const ok = createMemberCheck("T", refs, { fetchImpl: fakeTelegram({ "@Yuk_Ekspert": { ok: true, result: { status: "member" } }, "@Yuk_Ekspert_chat": { ok: true, result: { status: "administrator" } } }) });
  assert.deepEqual(await ok(1), { ok: true, missing: [] });
  const left = createMemberCheck("T", refs, { fetchImpl: fakeTelegram({ "@Yuk_Ekspert": { ok: true, result: { status: "left" } }, "@Yuk_Ekspert_chat": { ok: false, error_code: 400, description: "Bad Request: user not found" } }) });
  const result = await left(1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((c) => c.url), ["https://t.me/Yuk_Ekspert", "https://t.me/Yuk_Ekspert_chat"]);
  const broken = createMemberCheck("T", refs, { fetchImpl: fakeTelegram({ "@Yuk_Ekspert": { ok: false, error_code: 403, description: "Forbidden" } }) });
  assert.equal(await broken(1), null);
  assert.equal(await createMemberCheck("T", readChats("off"))(1), null);
  assert.equal(createMemberCheck(null, refs), null);
});
