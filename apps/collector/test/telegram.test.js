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

// 2026-11-20: @nom so'rash (resolveUsername) cheklanganda id bo'yicha o'qish (yopiq guruh, «🔎 Auto scan») to'xtamasin;
// a'zo bo'lgan guruh @nomi esa dialoglardan olinadi — cheklov paytida ham o'qiladi
test("resolve FLOOD faqat @nom so'rashni to'xtatadi: id va a'zo guruh dialoglardan o'qilaveradi", async () => {
  const { Api } = await import("telegram");
  const { default: bigInt } = await import("big-integer");
  const { createReader } = await import("../src/telegram.js");
  const channel = (id, username) => new Api.Channel({ id: bigInt(id), title: `G${id}`, username, photo: new Api.ChatPhotoEmpty(), date: 0, accessHash: bigInt(1) });
  const member = channel(1001, "Azo_guruh");
  const closed = channel(1002, undefined);
  let resolves = 0;
  const client = {
    async getEntity() {
      resolves++;
      throw Object.assign(new Error("FLOOD"), { errorMessage: "FLOOD", seconds: 600 });
    },
    async *iterDialogs() {
      yield { id: bigInt("-1001001"), entity: member };
      yield { id: bigInt("-1001002"), entity: closed };
    },
    async getMessages() {
      return [];
    },
  };
  const reader = createReader(client);
  await assert.rejects(reader.since({ kind: "username", value: "Begona" }, 0), /FLOOD/);
  assert.equal(resolves, 1);
  await assert.rejects(reader.since({ kind: "username", value: "Begona2" }, 0), /FLOOD_WAIT_/, "cheklov eslab qolindi — Telegram'ga so'ralmaydi");
  assert.equal(resolves, 1);
  assert.deepEqual(await reader.since({ kind: "id", value: "-1001002" }, 0), [], "id — cheklanmaydi");
  assert.deepEqual(await reader.since({ kind: "username", value: "azo_guruh" }, 0), [], "a'zo guruh — dialoglardan");
  assert.equal(resolves, 1);
});
