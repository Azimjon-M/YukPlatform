import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { CHAT_TEXT, chatParser, createLoadChat, postResult } from "../src/loadChat.js";

const LOAD = { fromRegion: "andijon", fromCity: "Andijon", toRegion: "toshkent_sh", toCity: "Toshkent", weightT: 20, cargo: "un", phones: [] };

function setup(parsed) {
  const store = openStore({ file: ":memory:", now: () => 1_000 });
  store.saveDriver(77, { name: "Ali", role: "yuk_beruvchi", active: true });
  const chat = createLoadChat({ store, scope: "qoshni", now: () => 1_000, parse: async () => parsed });
  return { store, chat, user: () => store.getDriver(77) };
}

test("yuk chati: raqamsiz matn → raqam so'raladi → yozgan raqam → tasdiqlash → navbatga (via app)", async () => {
  const { store, chat, user } = setup({ ok: true, postType: "yuk_bor", loads: [LOAD], by: "rules" });
  let view = await chat.read(77, "Andijondan Toshkentga 20 tonna un", user());
  assert.equal(view.stage, "phone");
  view = await chat.read(77, "90 123 45 67", user());
  assert.equal(view.stage, "confirm");
  assert.ok(view.cards[0].some((line) => line.includes("+998901234567")));
  assert.equal(chat.current(77, user()).stage, "confirm"); // qayta ochganda davom etadi
  const sent = chat.send(77, user());
  assert.equal(sent.ok, true);
  const post = store.shipperPosts(77)[0];
  assert.equal(post.via, "app");
  assert.equal(postResult(post).done, false);
  assert.equal(chat.current(77, user()), null);
  assert.deepEqual(store.getDriver(77).loadPhones, ["+998901234567"]);
  store.close();
});

test("yuk chati: tushunmadi / bo'sh mashina / AI band — oddiy javob, qoralama yo'q", async () => {
  for (const [parsed, text] of [
    [{ ok: true, postType: "boshqa", loads: [] }, CHAT_TEXT.notLoad],
    [{ ok: true, postType: "mashina_bor", loads: [LOAD] }, CHAT_TEXT.truck],
    [null, CHAT_TEXT.busy],
  ]) {
    const { store, chat, user } = setup(parsed);
    const view = await chat.read(77, "salom", user());
    assert.equal(view.stage, null);
    assert.equal(view.text, text);
    assert.equal(chat.send(77, user()).reason, "stale");
    store.close();
  }
});

test("yuk chati: saqlangan raqamni tanlash, bekor qilish", async () => {
  const { store, chat, user } = setup({ ok: true, postType: "yuk_bor", loads: [LOAD] });
  store.setLoadPhones(77, ["+998931112233"]);
  const view = await chat.read(77, "Andijondan Toshkentga 20 tonna un", user());
  assert.deepEqual(view.phones.map((p) => p.phone), ["+998931112233"]);
  assert.equal(chat.setPhone(77, "abc", user()).stage, "phone"); // tushunilmadi — raqam oynasi qoladi
  assert.equal(chat.setPhone(77, "+998931112233", user()).stage, "confirm");
  assert.equal(chat.cancel(77), true);
  assert.equal(chat.current(77, user()), null);
  store.close();
});

test("yuk chati: yo'nalish yoki yuk yozilmagan — nimasi yetishmasligi aytiladi, matni tahrirlash uchun qaytadi", async () => {
  const { store, chat, user } = setup({ ok: true, postType: "yuk_bor", loads: [{ fromRegion: "andijon", phones: [] }] });
  const view = await chat.read(77, "Andijondan yuk bor", user());
  assert.equal(view.stage, null);
  assert.match(view.text, /qayerdan → qayerga/);
  assert.match(view.text, /nima yuk/);
  assert.equal(view.editText, "Andijondan yuk bor");
  assert.equal(chat.current(77, user()), null);
  store.close();
});

test("yuk chati: raqam oynasida karta ham, tahrirlash matni ham bor; yozilgan raqam qabul qilinadi", async () => {
  const { store, chat, user } = setup({ ok: true, postType: "yuk_bor", loads: [LOAD] });
  const view = await chat.read(77, "Andijondan Toshkentga 20 tonna un", user());
  assert.equal(view.stage, "phone");
  assert.ok(view.cards[0][0].includes("Andijon"));
  assert.equal(view.editText, "Andijondan Toshkentga 20 tonna un");
  const done = chat.setPhone(77, "93 111 22 33", user());
  assert.equal(done.stage, "confirm");
  assert.equal(chat.send(77, user()).ok, true);
  store.close();
});

test("postResult: natija matnlari", () => {
  assert.equal(postResult({ status: "new" }).done, false);
  assert.match(postResult({ status: "done", loads: 1, sent: 4 }).text, /4 ta mos haydovchiga/);
  assert.match(postResult({ status: "done", loads: 1, sent: 0 }).text, /mos haydovchi topilmadi/);
  assert.match(postResult({ status: "done", loads: 0, sent: 0 }).text, /allaqachon/);
  assert.equal(postResult({ status: "failed", error: "x" }).ok, false);
});

test("chatParser: bir xil matn — doim bir xil javob (AI tasodifiga bog'liq emas)", async () => {
  const { parseByRules } = await import("@yuk/parser");
  // AI «e'lon emas» desa ham, AI umuman javob bermasa ham — natija bir xil
  for (const ai of [async () => ({ ok: true, postType: "boshqa", loads: [] }), async () => null, async () => { throw new Error("x"); }]) {
    const parse = chatParser({ rules: parseByRules, ai });
    const a = await parse("10 tonna shagʻal bor anjandan fargonaga");
    assert.equal(a.postType, "yuk_bor");
    assert.equal(a.loads[0].fromRegion, "andijon");
    assert.equal(a.loads[0].toRegion, "fargona");
    // tanilmagan joy: algoritmning qisman natijasi + qaysi so'z tanilmagani
    const b = await parse("10 tonna shagʻal bor xyzobodan fargonaga");
    assert.equal(b.postType, "yuk_bor");
    assert.deepEqual(b.unknown, ["xyzobodan"]);
  }
});

test("yuk chati: tanilmagan joy — aynan o'sha so'z so'raladi", async () => {
  const { parseByRules } = await import("@yuk/parser");
  const store = openStore({ file: ":memory:", now: () => 1_000 });
  store.saveDriver(77, { name: "Ali", active: true });
  const chat = createLoadChat({ store, scope: "qoshni", now: () => 1_000, parse: chatParser({ rules: parseByRules }) });
  const view = await chat.read(77, "10 tonna shagʻal bor xyzobodan fargonaga", store.getDriver(77));
  assert.equal(view.stage, null);
  assert.match(view.text, /«xyzobodan» qaysi joy/);
  assert.equal(view.editText, "10 tonna shagʻal bor xyzobodan fargonaga");
  store.close();
});
