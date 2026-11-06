import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { pollSource, runLive, sourceLabel, StalledError } from "../src/live.js";

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

test("manbalar ro'yxati har aylanishda qayta o'qiladi; bo'sh bo'lsa ogohlantiradi", async () => {
  const store = openStore({ file: ":memory:" });
  const controller = new AbortController();
  const logs = [];
  const rounds = [[], [{ kind: "username", value: "yangi" }]];
  let round = 0;
  const seen = [];
  const reader = {
    latestId: async (source) => {
      seen.push(source.value);
      return 10;
    },
    since: async () => [],
  };
  await runLive({
    sources: () => {
      if (round >= rounds.length) controller.abort();
      return rounds[round++] ?? [];
    },
    reader,
    store,
    intervalMs: 0,
    gapMs: 0,
    log: (message) => logs.push(message),
    signal: controller.signal,
  });
  assert.match(logs[0], /guruh yo'q/);
  assert.deepEqual(seen, ["yangi"]);
});

test("qo'riqchi: Telegram javob bermay qolsa, osilgan so'rov xato bo'ladi va jarayon to'xtaydi", async () => {
  const store = openStore({ file: ":memory:" });
  store.setCursor("@yuk_guruh", 5);
  let time = 0;
  const reader = {
    async latestId() {
      return 5;
    },
    // Aloqa uzilgan: so'rov hech qachon tugamaydi
    since() {
      time += 60_000; // har urinishda "1 daqiqa o'tdi"
      return new Promise(() => {});
    },
  };
  const logs = [];
  await assert.rejects(
    runLive({ sources: [SOURCE], reader, store, intervalMs: 0, gapMs: 0, pollTimeoutMs: 5, deadAfterMs: 3 * 60_000, now: () => time, log: (m) => logs.push(m) }),
    (error) => error instanceof StalledError && /aloqa uzildi/.test(error.message),
  );
  assert.equal(logs.length, 3);
  assert.match(logs[0], /javob kelmadi/);
});

test("qo'riqchi: o'qish ishlab tursa yoki guruh bo'lmasa, to'xtamaydi", async () => {
  const store = openStore({ file: ":memory:" });
  let time = 0;
  let rounds = 0;
  const controller = new AbortController();
  const reader = fakeReader([{ id: 1, text: long("a"), date: 1 }]);
  await runLive({
    sources: () => {
      time += 10 * 60_000;
      if (++rounds > 4) controller.abort();
      return rounds % 2 ? [SOURCE] : [];
    },
    reader,
    store,
    intervalMs: 0,
    gapMs: 0,
    deadAfterMs: 60_000,
    now: () => time,
    log: () => {},
    signal: controller.signal,
  });
  assert.ok(rounds > 4);
});
