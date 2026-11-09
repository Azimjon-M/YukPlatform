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

// --- Jonli rejim (2026-11-09): a'zo bo'lingan guruh xabarini Telegram o'zi yuboradi ---

// Soxta o'quvchi: a'zolik ro'yxati + listen() orqali «Telegram yuborgan» xabarni qo'lda chaqiramiz
function liveReader(messagesBySource, joinedValues) {
  const reader = {
    polls: [],
    membershipCalls: 0,
    emit: null,
    stopped: false,
    async latestId(source) {
      return messagesBySource[source.value].at(-1)?.id ?? 0;
    },
    async since(source, minId) {
      reader.polls.push(source.value);
      return messagesBySource[source.value].filter((m) => m.id > minId);
    },
    async membership(list) {
      reader.membershipCalls++;
      return new Map(list.map((s) => [s.value, joinedValues.has(s.value)]));
    },
    async listen(onMessage) {
      reader.emit = onMessage;
      return () => (reader.stopped = true);
    },
  };
  return reader;
}

test("jonli: a'zo guruh xabari darhol navbatga, zaxira tekshiruv takrorlamaydi va tushib qolganini topadi", async (t) => {
  const store = openStore({ file: ":memory:" });
  store.addSource("@azo");
  store.addSource("@begona");
  const AZO = { kind: "username", value: "azo" };
  const BEGONA = { kind: "username", value: "begona" };
  const messages = { azo: [{ id: 1, text: long("eski"), date: 1 }], begona: [{ id: 1, text: long("eski b"), date: 1 }] };
  const reader = liveReader(messages, new Set(["azo"]));
  const logs = [];
  let time = 1_000_000;
  const controller = new AbortController();
  t.after(() => controller.abort()); // test yiqilsa ham aylanish to'xtasin (aks holda jarayon osilib qoladi)
  const done = runLive({
    sources: () => [AZO, BEGONA],
    reader,
    store,
    intervalMs: 10, // haqiqiy 10 ms; «soat» esa time orqali qo'lda suriladi
    joinedIntervalMs: 180_000,
    gapMs: 0,
    log: (m) => logs.push(m),
    signal: controller.signal,
    now: () => time,
  });
  await until(() => store.getCursor("@begona") != null && store.getCursor("@azo") != null);
  assert.equal(store.listSources().find((s) => s.name === "@azo").joined, true, "a'zolik bazaga yozildi");
  assert.equal(store.listSources().find((s) => s.name === "@begona").joined, false);
  assert.ok(logs.some((l) => l.includes("A'zo (jonli tinglanadi): @azo")));

  // Telegram yuborgan jonli xabar — darhol navbatda, via=live
  time += 5_000;
  const fresh = { id: 2, text: long("jonli yuk"), date: time / 1000 - 1 };
  messages.azo.push(fresh);
  reader.emit(AZO, fresh);
  assert.equal(store.takeNewPosts(10, { newest: true })[0]?.messageId, 2);
  assert.ok(logs.some((l) => l.includes("@azo: +1 yangi e'lon (jonli, 1 s)")));
  assert.equal(store.db.prepare("SELECT via FROM posts WHERE message_id = 2").get().via, "live");

  // O'chirilgan / begona chat xabari olinmaydi
  reader.emit({ kind: "username", value: "boshqa" }, { id: 9, text: long("boshqa"), date: 1 });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 1);

  // Jonli kelmay qolgan xabar (id 3) — zaxira tekshiruvda topiladi; id 2 qayta yozilmaydi
  messages.azo.push({ id: 3, text: long("tushib qolgan"), date: time / 1000 });
  time += 180_000;
  await until(() => reader.polls.includes("azo"), 3000);
  await until(() => logs.some((l) => l.includes("jonli kelmay qolgan 1 ta e'lon so'rab olindi — endi har 0.01 s")));
  assert.equal(store.db.prepare("SELECT via FROM posts WHERE message_id = 3").get().via, "poll");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE source = '@azo'").get().n, 2);
  // Tushib qolgani bor — endi har aylanishda so'raladi (soat surilmasa ham); 3 marta toza chiqsa — yana 3 daqiqada bir
  const polled = reader.polls.filter((v) => v === "azo").length;
  await until(() => logs.some((l) => l.includes("@azo: jonli xabarlar to'liq kelyapti — endi har 3 daqiqada")));
  assert.equal(reader.polls.filter((v) => v === "azo").length, polled + 3);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(reader.polls.filter((v) => v === "azo").length, polled + 3, "soat surilmaguncha boshqa so'ralmaydi");
  controller.abort();
  await done;
  assert.equal(reader.stopped, true, "to'xtaganda tinglash ham to'xtaydi");
});

test("jonli: guruhga qo'shilsa 10 daqiqa ichida jonliga o'tadi va endi har aylanishda so'ralmaydi", async () => {
  const store = openStore({ file: ":memory:" });
  const GROUP = { kind: "username", value: "guruh" };
  const joinedSet = new Set();
  const reader = liveReader({ guruh: [{ id: 1, text: long("a"), date: 1 }] }, joinedSet);
  const logs = [];
  let time = 0;
  let rounds = 0;
  const controller = new AbortController();
  await runLive({
    sources: () => {
      rounds++;
      time += 60_000;
      if (rounds === 3) joinedSet.add("guruh"); // shu orada u guruhga qo'shildi
      if (rounds === 12) reader.emit(GROUP, { id: 2, text: long("jonli"), date: time / 1000 }); // jonli xabar keldi
      if (rounds > 16) controller.abort();
      return [GROUP];
    },
    reader,
    store,
    intervalMs: 0,
    gapMs: 0,
    membershipMs: 10 * 60_000,
    joinedIntervalMs: 3 * 60_000,
    log: (m) => logs.push(m),
    signal: controller.signal,
    now: () => time,
  });
  assert.ok(logs.some((l) => l.includes("Jonli guruh yo'q")));
  assert.ok(logs.some((l) => l.includes("@guruh: akkaunt guruhga qo'shilgan — endi jonli")));
  assert.equal(reader.membershipCalls, 2, "a'zolik 10 daqiqada bir marta");
  // 1-aylanish faqat kursorni qo'yadi; 2–11: har daqiqa (10 ta; 11-da a'zoligi bilinadi, lekin jonli xabar hali yo'q);
  // 12-da jonli xabar keldi — endi 3 daqiqada bir (14)
  assert.equal(reader.polls.length, 11);
});

test("jonli tinglash yoqilmasa — hammasi avvalgidek so'rab turiladi", async () => {
  const store = openStore({ file: ":memory:" });
  const reader = liveReader({ yuk_guruh: [{ id: 1, text: long("a"), date: 1 }] }, new Set(["yuk_guruh"]));
  reader.listen = async () => {
    throw new Error("AUTH_KEY_UNREGISTERED");
  };
  const logs = [];
  let rounds = 0;
  const controller = new AbortController();
  await runLive({
    sources: () => {
      if (++rounds > 3) controller.abort();
      return [SOURCE];
    },
    reader,
    store,
    intervalMs: 0,
    gapMs: 0,
    log: (m) => logs.push(m),
    signal: controller.signal,
  });
  assert.match(logs[0], /Jonli tinglash yoqilmadi — AUTH_KEY_UNREGISTERED/);
  assert.equal(reader.membershipCalls, 0);
  assert.equal(reader.polls.length, 2, "har aylanishda so'raladi (birinchisi — kursor)");
});

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("kutish vaqti tugadi");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
