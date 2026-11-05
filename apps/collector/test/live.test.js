import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { pollSource, sourceLabel } from "../src/live.js";

const SOURCE = { kind: "username", value: "yuk_guruh" };
const long = (s) => `${s} — Toshkentdan Samarqandga 20 t tent kerak`;

// Soxta guruh: xabarlar ro'yxati, since() minId dan keyingilarini qaytaradi
function fakeReader(messages) {
  return {
    calls: 0,
    async latestId() {
      return messages.at(-1)?.id ?? null;
    },
    async since(_source, minId) {
      this.calls++;
      return messages.filter((m) => m.id > minId);
    },
  };
}

test("birinchi marta faqat kuzatish boshlanadi, keyin yangi xabarlar navbatga tushadi", async () => {
  const store = openStore({ file: ":memory:" });
  const messages = [{ id: 10, text: long("eski"), date: 1 }];
  const reader = fakeReader(messages);

  const first = await pollSource(SOURCE, reader, store);
  assert.equal(first.started, true);
  assert.equal(store.takeNewPosts().length, 0, "eski xabarlar olinmaydi");

  messages.push({ id: 11, text: long("yangi"), date: 2 }, { id: 12, text: "qisqa", date: 3 });
  const second = await pollSource(SOURCE, reader, store);
  assert.deepEqual({ added: second.added, short: second.short }, { added: 1, short: 1 });
  const [post] = store.takeNewPosts();
  assert.equal(post.source, "@yuk_guruh");
  assert.equal(post.link, "https://t.me/yuk_guruh/11");
  assert.equal(post.postedAt, 2000);
  assert.equal(store.getCursor("@yuk_guruh"), 12);

  const third = await pollSource(SOURCE, reader, store);
  assert.equal(third.added, 0, "o'sha xabarlar qayta olinmaydi");
});

test("backfill: oxirgi N ta xabardan boshlaydi; takror matn AI'ga bormaydi", async () => {
  const store = openStore({ file: ":memory:" });
  const messages = [
    { id: 1, text: long("a"), date: 1 },
    { id: 2, text: long("b"), date: 2 },
    { id: 3, text: `🔥 ${long("b")} 🔥`, date: 3 },
  ];
  const result = await pollSource(SOURCE, fakeReader(messages), store, { backfill: 2 });
  assert.deepEqual({ added: result.added, duplicate: result.duplicate }, { added: 1, duplicate: 1 });
});

test("guruh nomi bazada @ bilan, raqamli id o'zgarishsiz", () => {
  assert.equal(sourceLabel(SOURCE), "@yuk_guruh");
  assert.equal(sourceLabel({ kind: "id", value: "-100123" }), "-100123");
});
