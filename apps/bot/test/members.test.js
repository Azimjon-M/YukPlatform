// Kanal va guruhga a'zolik (members.js): soxta Telegram bilan — internetga chiqmaydi
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_MS,
  SUB_CHECK,
  UNKNOWN_CACHE_MS,
  chatInfo,
  createMembership,
  isMember,
  joinPrompt,
  notMemberError,
  readRequiredChats,
  remindText,
} from "../src/members.js";

test("REQUIRED_CHATS: ro'yxat, takror va o'chirish; noto'g'ri nom — xato", () => {
  assert.deepEqual(readRequiredChats("@Yuk_Ekspert, @Yuk_Ekspert_chat @Yuk_Ekspert"), ["@Yuk_Ekspert", "@Yuk_Ekspert_chat"]);
  assert.deepEqual(readRequiredChats("-1003866695906"), ["-1003866695906"]);
  for (const off of [undefined, "", "  ", "0", "off", "yo'q"]) assert.deepEqual(readRequiredChats(off), []);
  assert.throws(() => readRequiredChats("Yuk_Ekspert"), /@kanal_nomi/);
  assert.throws(() => readRequiredChats("https://t.me/Yuk_Ekspert"), /@kanal_nomi/);
});

test("a'zo holatlari: creator / administrator / member va cheklangan a'zo — a'zo; left / kicked — yo'q", () => {
  for (const status of ["creator", "administrator", "member"]) assert.equal(isMember({ status }), true, status);
  assert.equal(isMember({ status: "restricted", is_member: true }), true);
  assert.equal(isMember({ status: "restricted", is_member: false }), false);
  for (const status of ["left", "kicked"]) assert.equal(isMember({ status }), false, status);
  assert.equal(isMember(null), false);
  assert.equal(notMemberError({ error_code: 400, description: "Bad Request: user not found" }), true);
  assert.equal(notMemberError({ error_code: 400, description: "Bad Request: chat not found" }), false);
  assert.equal(notMemberError({ error_code: 403, description: "Forbidden" }), false);
});

test("chat haqida: @nomdan havola, getChat bo'lsa — nomi va turi", () => {
  assert.deepEqual(chatInfo("@Yuk_Ekspert"), { ref: "@Yuk_Ekspert", id: null, title: "@Yuk_Ekspert", type: "channel", url: "https://t.me/Yuk_Ekspert" });
  assert.equal(chatInfo("@Yuk_Ekspert_chat").type, "supergroup");
  const chat = { id: -1004325450686, type: "supergroup", title: "Yuk Exspert Chat", username: "Yuk_Ekspert_chat" };
  assert.deepEqual(chatInfo("@Yuk_Ekspert_chat", chat), { ref: "@Yuk_Ekspert_chat", id: chat.id, title: "Yuk Exspert Chat", type: "supergroup", url: "https://t.me/Yuk_Ekspert_chat" });
  // -100... va username'siz — taklif havolasi (bot admin bo'lsa getChat beradi)
  assert.equal(chatInfo("-1001", { id: -1001, type: "channel", title: "Yopiq", invite_link: "https://t.me/+abc" }).url, "https://t.me/+abc");
});

// Soxta Telegram: members[chat][user] = status yoki Error
function fakeApi(members) {
  const calls = [];
  const api = {
    async getChat(ref) {
      return { "@kanal": { id: -100, type: "channel", title: "Yuk Ekspert", username: "kanal" }, "@guruh": { id: -200, type: "supergroup", title: "Yuk Chat", username: "guruh" } }[ref];
    },
    async getChatMember(chatId, userId) {
      calls.push([chatId, userId]);
      const value = members[chatId]?.[userId] ?? "left";
      if (value instanceof Error) throw value;
      return { status: value, user: { id: userId } };
    },
  };
  return { api, calls };
}

const tgError = (code, description) => Object.assign(new Error(description), { error_code: code, description });

test("tekshiruv: ikkalasiga a'zo — ok; natija 10 daqiqa eslab qolinadi; «a'zo emas» — fresh bilan qayta so'raladi", async () => {
  let time = 0;
  const members = { [-100]: { 1: "member", 2: "member" }, [-200]: { 1: "administrator" } };
  const { api, calls } = fakeApi(members);
  const checked = [];
  const m = createMembership({ api, refs: ["@kanal", "@guruh"], now: () => time, onChecked: (id, r) => checked.push([id, r]) });
  await m.init(999);

  assert.equal((await m.check(1)).ok, true);
  const two = await m.check(2);
  assert.deepEqual([two.ok, two.missing.map((c) => c.ref)], [false, ["@guruh"]]);
  assert.deepEqual(checked, [[1, { ok: true, missing: [] }], [2, { ok: false, missing: ["@guruh"] }]]);
  const asked = calls.length;

  await m.check(1);
  await m.check(2);
  assert.equal(calls.length, asked, "eslab qolingan — Telegram'ga so'rov yo'q");

  // 2-odam guruhga qo'shildi: oddiy tekshiruv hali eskisini beradi, fresh — qayta so'raydi
  members[-200][2] = "member";
  assert.equal((await m.check(2)).ok, false);
  assert.equal((await m.check(2, { fresh: true })).ok, true);
  // a'zo natijasi fresh bo'lsa ham eslab qolingani ishlatiladi
  const before = calls.length;
  await m.check(1, { fresh: true });
  assert.equal(calls.length, before);

  // 10 daqiqadan keyin — qayta so'raladi (chiqib ketgan bo'lishi mumkin)
  members[-100][1] = "left";
  time += CACHE_MS;
  assert.equal((await m.check(1)).ok, false);
  m.forget(2);
  await m.check(2);
  assert.equal(calls.length, before + 4);
});

test("«user not found» — a'zo emas; boshqa xato — bilmaymiz: o'tkaziladi, bazaga yozilmaydi, 1 daqiqadan keyin qayta", async () => {
  let time = 0;
  const logs = [];
  const members = { [-100]: { 1: tgError(400, "Bad Request: user not found"), 2: tgError(400, "Bad Request: CHAT_ADMIN_REQUIRED") }, [-200]: { 1: "member", 2: "member" } };
  const { api, calls } = fakeApi(members);
  const checked = [];
  const m = createMembership({ api, refs: ["@kanal", "@guruh"], now: () => time, log: (t) => logs.push(t), onChecked: (id, r) => checked.push(id) });
  await m.init();

  const one = await m.check(1);
  assert.deepEqual([one.ok, one.missing.map((c) => c.ref)], [false, ["@kanal"]]);
  const two = await m.check(2);
  assert.deepEqual([two.ok, two.unknown.map((c) => c.ref)], [true, ["@kanal"]], "Telegram javob bermasa — botni yopib qo'ymaymiz");
  assert.deepEqual(checked, [1], "bilmagan natija bazaga yozilmaydi");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /tekshirib bo'lmadi \(@kanal\)/);

  const asked = calls.length;
  await m.check(2);
  assert.equal(calls.length, asked);
  time += UNKNOWN_CACHE_MS;
  await m.check(2);
  assert.equal(calls.length, asked + 2);
  assert.equal(logs.length, 1, "ogohlantirish 10 daqiqada bir marta");
});

test("ishga tushganda: bot admin bo'lmasa yoki chat topilmasa — ogohlantirish", async () => {
  const logs = [];
  const { api } = fakeApi({ [-100]: { 999: "administrator" }, [-200]: { 999: "member" } });
  const m = createMembership({ api: { ...api, getChat: async (ref) => (ref === "@yoq" ? Promise.reject(tgError(400, "Bad Request: chat not found")) : api.getChat(ref)) }, refs: ["@kanal", "@guruh", "@yoq"], log: (t) => logs.push(t) });
  const chats = await m.init(999);
  assert.deepEqual(chats.map((c) => c.title), ["Yuk Ekspert", "Yuk Chat", "@yoq"]);
  assert.equal(logs.length, 2);
  assert.ok(logs.some((t) => /@guruh da admin emas/.test(t)));
  assert.ok(logs.some((t) => /@yoq topilmadi/.test(t)));
  assert.equal(m.watches({ id: -200, type: "supergroup" }), true);
  assert.equal(m.watches({ id: -300, type: "supergroup", username: "boshqa" }), false);
  assert.equal(m.watches({ id: -301, type: "channel", username: "Kanal" }), true, "nomi bo'yicha ham (katta-kichik harf farqsiz)");
});

test("xabar matni va tugmalar: faqat a'zo bo'lmaganiga havola, oxirida «✅ A'zo bo'ldim»", () => {
  const kanal = chatInfo("@kanal", { id: -100, type: "channel", title: "Yuk Ekspert", username: "kanal" });
  const guruh = chatInfo("@guruh", { id: -200, type: "supergroup", title: "Yuk <Chat>", username: "guruh" });
  const both = joinPrompt([kanal, guruh], [kanal, guruh]);
  assert.match(both.text, /kanal va guruhimizga a'zo bo'ling/);
  assert.match(both.text, /👉 <b>Yuk Ekspert<\/b> — kanal\n👉 <b>Yuk &lt;Chat&gt;<\/b> — guruh/);
  assert.deepEqual(
    both.keyboard.inline_keyboard.map((row) => row.map((b) => b.url ?? b.callback_data)),
    [["https://t.me/kanal"], ["https://t.me/guruh"], [SUB_CHECK]],
  );
  const one = joinPrompt([kanal, guruh], [guruh]);
  assert.match(one.text, /guruhimizga a'zo bo'ling/);
  assert.match(one.text, /✅ <b>Yuk Ekspert<\/b>[\s\S]*👉 <b>Yuk &lt;Chat&gt;<\/b>/);
  assert.equal(one.keyboard.inline_keyboard.flat()[0].text, "💬 Guruhga a'zo bo'lish");

  assert.match(remindText([kanal, guruh], [kanal], { one: "bo'sh mashina", many: "bo'sh mashinalar" }).text, /mos yangi bo'sh mashina chiqdi, lekin yuborilmadi/);
  assert.match(remindText([kanal, guruh], [kanal], { reason: "left" }).text, /Siz Yuk Ekspertdan chiqdingiz — yuklar endi yuborilmaydi/);
});
