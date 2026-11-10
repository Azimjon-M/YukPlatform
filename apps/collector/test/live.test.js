import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { activityRates, addMessage, floodSeconds, pollIntervals, pollSource, runLive, senderUsername, sourceLabel, StalledError } from "../src/live.js";

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

test("e'lonni yozgan odamning username'i navbatga yoziladi (noto'g'risi — null)", async () => {
  const store = openStore({ file: ":memory:" });
  addMessage(SOURCE, { id: 1, text: long("a"), date: 1, sender: "ish_beruvchi" }, store);
  addMessage(SOURCE, { id: 2, text: long("b"), date: 2, sender: "yo'q emas" }, store);
  addMessage(SOURCE, { id: 3, text: long("c"), date: 3 }, store);
  assert.deepEqual(store.takeNewPosts().map((p) => p.sender), ["ish_beruvchi", null, null]);
});

test("GramJS jo'natuvchisi: faqat oddiy odamning username'i", () => {
  const user = (extra) => ({ className: "User", username: "ali_99", ...extra });
  assert.equal(senderUsername(user()), "ali_99");
  assert.equal(senderUsername(user({ username: null, usernames: [{ username: "eski", active: false }, { username: "yangi_nom", active: true }] })), "yangi_nom");
  assert.equal(senderUsername(user({ username: null })), null);
  assert.equal(senderUsername(user({ bot: true })), null, "bot");
  assert.equal(senderUsername(user({ deleted: true })), null, "o'chirilgan akkaunt");
  assert.equal(senderUsername({ className: "Channel", username: "kanal_nomi" }), null, "kanal nomidan yozilgan");
  assert.equal(senderUsername(undefined), null);
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


// --- Navbat (2026-11-09): har guruh faolligiga qarab so'raladi ---

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const S = (value) => ({ kind: "username", value });

test("pollIntervals: kvadrat ildiz qoidasi — jami so'rovlar budjetga teng, faol guruh tezroq", () => {
  const free = pollIntervals(new Map([["a", 4], ["b", 1], ["c", 0.25]]), { budgetPerMin: 20, minMs: 0, maxMs: Infinity });
  const perMin = [...free.values()].reduce((total, ms) => total + MIN / ms, 0);
  assert.ok(Math.abs(perMin - 20) < 0.1, `daqiqasiga ${perMin}`);
  assert.ok(Math.abs(free.get("b") / free.get("a") - 2) < 0.01, "4 barobar ko'p yozadigan — 2 barobar tez");

  const real = pollIntervals(new Map([["a", 4], ["jim", 0], ["yangi", null]]), { budgetPerMin: 20 });
  assert.equal(real.get("a"), 20_000, "eng tezi — 20 s");
  assert.equal(real.get("yangi"), 60_000, "faolligi bilinmaydigan yangi guruh — 60 s");
  assert.ok(real.get("jim") > real.get("a") && real.get("jim") <= 10 * MIN);
  assert.equal(pollIntervals(new Map([["jim", 0], ["jim2", 0]]), { budgetPerMin: 0.1 }).get("jim"), 10 * MIN, "eng siyragi — 10 daqiqa");
});

test("activityRates: oxirgi 3 soat, kunlik o'rtachaning yarmidan kam emas; yosh guruh — null", () => {
  const time = 10 * DAY;
  const createdAt = new Map([["@eski", 0], ["@yosh", time - 5 * MIN], ["@soatlik", time - HOUR]]);
  const activity = { "@eski": { recent: 90, day: 2880 }, "@soatlik": { recent: 30, day: 30 } };
  const rates = activityRates(["@eski", "@yosh", "@soatlik", "@bazada_yoq"], { activity, createdAt, time });
  assert.equal(rates.get("@eski"), 1, "3 soatda 90 ta = 0.5, lekin kunlik 2/daq ning yarmi = 1 (collector o'chiq turgan bo'lishi mumkin)");
  assert.equal(rates.get("@yosh"), null, "15 daqiqadan yosh — hali bilinmaydi");
  assert.equal(rates.get("@soatlik"), 0.5, "1 soatlik guruh: 30 ta / 60 daqiqa");
  assert.equal(rates.get("@bazada_yoq"), 0);
});

test("floodSeconds: GramJS FloodWaitError va matndagi FLOOD_WAIT_N", () => {
  assert.equal(floodSeconds({ errorMessage: "FLOOD", seconds: 30 }), 30);
  assert.equal(floodSeconds(new Error("FLOOD_WAIT_420")), 420);
  assert.equal(floodSeconds(new Error("CHANNEL_PRIVATE")), null);
});

// Baza: guruhlar 2 kun oldin qo'shilgan, kursor 100 da; historyPerMin — oxirgi 3 soatda daqiqasiga nechta e'lon yozilgan
function setup(names, { historyPerMin = {} } = {}) {
  const clock = { t: Date.UTC(2026, 10, 9, 7, 0) };
  const store = openStore({ file: ":memory:", now: () => clock.t });
  clock.t -= 2 * DAY;
  for (const name of names) store.addSource(`@${name}`);
  clock.t += 2 * DAY;
  for (const [name, perMin] of Object.entries(historyPerMin)) {
    const count = Math.round(perMin * 180);
    for (let i = 0; i < count; i++) {
      store.addPost({ source: `@${name}`, messageId: 10_000 + i, text: long(`tarix ${name} ${i}`), postedAt: clock.t - 3 * HOUR + ((i + 0.5) * 3 * HOUR) / count });
    }
  }
  for (const name of names) store.setCursor(`@${name}`, 100);
  return { clock, store };
}

// Soxta Telegram: schedule — guruh har necha ms da bitta xabar yozadi (0 — o'zi yozmaydi, post() bilan qo'lda).
// since/latestId/tops faqat «hozirgacha» yozilganini ko'radi. joined — akkaunt a'zo bo'lgan guruhlar (o'zgartirsa bo'ladi);
// topsForAll — Telegram a'zo bo'lmagan guruhning oxirgi xabar raqamini ham beradimi
function fakeTelegram(clock, schedule, { joined = [], topsForAll = false } = {}) {
  const posts = {};
  for (const [name, every] of Object.entries(schedule)) {
    posts[name] = [];
    if (every) for (let at = clock.t + every; at <= clock.t + 3 * HOUR; at += every) posts[name].push({ id: 101 + posts[name].length, at });
  }
  const visible = (name) => posts[name].filter((p) => p.at <= clock.t);
  const top = (name) => visible(name).at(-1)?.id ?? 100;
  const tg = {
    polls: {},
    pollTimes: [],
    topsCalls: 0,
    failNext: null,
    joined,
    post(name) {
      const post = { id: (posts[name].at(-1)?.id ?? 100) + 1, at: clock.t };
      posts[name].push(post);
      return post;
    },
    async latestId(source) {
      return top(source.value);
    },
    async since(source, minId) {
      if (tg.failNext) {
        const error = tg.failNext;
        tg.failNext = null;
        throw error;
      }
      tg.polls[source.value] = (tg.polls[source.value] ?? 0) + 1;
      tg.pollTimes.push(clock.t);
      return visible(source.value)
        .filter((p) => p.id > minId)
        .map((p) => ({ id: p.id, text: long(`${source.value} xabar ${p.id}`), date: Math.floor(p.at / 1000) }));
    },
    async membership(list) {
      return new Map(list.map((s) => [s.value, tg.joined.includes(s.value)]));
    },
    async tops(list) {
      tg.topsCalls++;
      return new Map(list.filter((s) => topsForAll || tg.joined.includes(s.value)).map((s) => [s.value, top(s.value)]));
    },
  };
  return tg;
}

// runLive soxta soat bilan: sleep vaqtni suradi (haqiqatda kutmaydi), `minutes` o'tgach to'xtaydi.
// events — [[daqiqa, () => ...]]: shu paytda bajariladi (masalan, guruhga xabar yozish)
async function simulate({ clock, minutes, events = [], logs = [], ...options }) {
  const controller = new AbortController();
  const start = clock.t;
  const end = start + minutes * MIN;
  const pending = events.map(([minute, run]) => ({ at: start + minute * MIN, run })).sort((a, b) => a.at - b.at);
  await runLive({
    log: (message) => logs.push(message),
    signal: controller.signal,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
      while (pending.length && pending[0].at <= clock.t) pending.shift().run();
      if (clock.t >= end) controller.abort();
    },
    ...options,
  });
  return logs;
}

const pollOnly = (tg) => ({ latestId: tg.latestId, since: tg.since });
const sourceRow = (store, name) => store.listSources().find((s) => s.name === name);

test("navbat: tez yozadigan guruh tez-tez, jim guruh siyrak so'raladi; oraliq bazaga yoziladi", async () => {
  const { clock, store } = setup(["tez", "jim"], { historyPerMin: { tez: 4, jim: 0.01 } });
  const start = clock.t;
  const tg = fakeTelegram(clock, { tez: 15_000, jim: 20 * MIN });
  await simulate({ clock, minutes: 30, sources: [S("tez"), S("jim")], reader: pollOnly(tg), store, budgetPerMin: 4 });

  assert.ok(tg.polls.tez >= 80, `tez: ${tg.polls.tez} marta`);
  assert.ok(tg.polls.jim >= 5 && tg.polls.jim <= 8, `jim: ${tg.polls.jim} marta`);
  assert.equal(sourceRow(store, "@tez").pollMs, 20_000);
  // Boshida ~5 daq; 20-daqiqada jim guruh ham bitta yozdi — 3 soatda 3 ta bo'ldi, oralig'i ~4 daqiqaga qisqardi
  const jimMs = sourceRow(store, "@jim").pollMs;
  assert.ok(jimMs > 3.5 * MIN && jimMs < 5.5 * MIN, `jim har ${jimMs} ms`);
  assert.equal(sourceRow(store, "@tez").watch, "poll");
  // Tez guruhning e'loni ko'pi bilan ~20 s da navbatda
  const worst = store.db.prepare("SELECT MAX(created_at - posted_at) AS ms FROM posts WHERE source = '@tez' AND created_at > ?").get(start).ms;
  assert.ok(worst <= 23_000, `eng ko'p kechikish ${worst} ms`);
});

test("yangi guruh darhol boshlanadi; ro'yxat bo'sh bo'lsa ogohlantiradi", async () => {
  const { clock, store } = setup([]);
  const tg = fakeTelegram(clock, { yangi: 0 });
  let calls = 0;
  const logs = await simulate({ clock, minutes: 1, sources: () => (++calls > 2 ? [S("yangi")] : []), reader: pollOnly(tg), store });
  assert.match(logs[0], /guruh yo'q/);
  assert.ok(logs.includes("@yangi: kuzatish boshlandi"));
  assert.equal(store.getCursor("@yangi"), 100);
});

test("a'zo guruh: yangisi bo'lmasa so'ralmaydi, bo'lsa ~15 s ichida o'qiladi", async () => {
  const { clock, store } = setup(["azo", "begona"], { historyPerMin: { azo: 0.02, begona: 0.02 } });
  const tg = fakeTelegram(clock, { azo: 0, begona: 0 }, { joined: ["azo"] });
  const logs = await simulate({ clock, minutes: 12, sources: [S("azo"), S("begona")], reader: tg, store, events: [[5, () => tg.post("azo")]] });

  assert.ok(logs.some((l) => l.includes("A'zo guruhlar (yangisi bo'lsa darhol o'qiladi): @azo")));
  assert.ok(logs.some((l) => l.includes("faqat a'zo bo'lingan guruhlar uchun ishlaydi")), "sinov: a'zo bo'lmaganniki berilmadi");
  assert.equal(tg.polls.azo, 2, "boshida bir marta + yangi xabar bo'lganda bir marta");
  assert.ok(tg.polls.begona > 10, "a'zo bo'lmagani o'z navbati bilan");
  const post = store.db.prepare("SELECT created_at - posted_at AS ms FROM posts WHERE source = '@azo' AND message_id = 101").get();
  assert.ok(post.ms <= 20_000, `kechikish ${post.ms} ms`);
  assert.ok(tg.topsCalls >= 40, `«yangisi bormi» ${tg.topsCalls} marta (har 15 s)`);
  assert.equal(sourceRow(store, "@azo").joined, true);
  assert.equal(sourceRow(store, "@azo").watch, "tops");
  assert.equal(sourceRow(store, "@begona").watch, "poll");
});

test("a'zo guruh yangisi bo'lmasa ham 10 daqiqada bir o'qiladi (zaxira); qo'shilganini 10 daqiqada sezadi", async () => {
  const { clock, store } = setup(["guruh"], { historyPerMin: { guruh: 0.02 } });
  const tg = fakeTelegram(clock, { guruh: 0 }, { joined: [] });
  const logs = await simulate({ clock, minutes: 25, sources: [S("guruh")], reader: tg, store, events: [[3, () => tg.joined.push("guruh")]] });
  assert.ok(logs.some((l) => l.includes("Akkaunt kuzatilayotgan guruhlarning hech biriga a'zo emas")));
  assert.ok(logs.some((l) => l.includes("@guruh: akkaunt guruhga qo'shilgan — endi yangisi bo'lsa darhol o'qiladi")));
  assert.equal(sourceRow(store, "@guruh").watch, "tops");
  // 0–10 daq: o'z navbati bilan (har 20 s); a'zolik 10-daqiqada bilindi; keyin faqat zaxira — yana 10 daqiqadan keyin
  const after = tg.pollTimes.filter((t) => t > tg.pollTimes[0] + 11 * MIN).length;
  assert.equal(after, 1, `a'zo bo'lgandan keyin ${after} marta`);
});

test("Telegram a'zo bo'lmagan guruh raqamini ham bersa — hammasi bitta so'rov bilan kuzatiladi", async () => {
  const { clock, store } = setup(["a", "b"]);
  const tg = fakeTelegram(clock, { a: 0, b: 0 }, { topsForAll: true });
  const logs = await simulate({ clock, minutes: 6, sources: [S("a"), S("b")], reader: tg, store, events: [[3, () => tg.post("b")]] });
  assert.ok(logs.some((l) => l.includes("hamma guruh bitta so'rov bilan kuzatiladi")));
  assert.deepEqual(tg.polls, { a: 1, b: 2 }, "faqat boshida va yangisi bo'lganda");
  assert.equal(sourceRow(store, "@b").watch, "tops");
});

test("«yangisi bormi» ishlamasa — hamma guruh o'z navbati bilan so'raladi", async () => {
  const { clock, store } = setup(["azo"]);
  const tg = fakeTelegram(clock, { azo: 0 }, { joined: ["azo"] });
  tg.tops = async () => {
    tg.topsCalls++;
    throw new Error("PEER_ID_INVALID");
  };
  const logs = await simulate({ clock, minutes: 3, sources: [S("azo")], reader: tg, store });
  assert.ok(logs.some((l) => l.includes("«Yangisi bormi» tekshiruvi ishlamadi — PEER_ID_INVALID. 10 daqiqa")));
  assert.equal(tg.topsCalls, 1, "10 daqiqa qayta urinilmaydi");
  assert.ok(tg.polls.azo >= 5);
});

test("jonli xabar darhol navbatga; ketma-ket kelsa kursor suriladi va guruh qayta o'qilmaydi", async () => {
  const { clock, store } = setup(["azo"]);
  const tg = fakeTelegram(clock, { azo: 0 }, { joined: ["azo"] });
  let emit = null;
  let stopped = false;
  tg.listen = async (onMessage) => {
    emit = onMessage;
    return () => (stopped = true);
  };
  const live = () => {
    const post = tg.post("azo");
    emit(S("azo"), { id: post.id, text: long("jonli yuk"), date: Math.floor(clock.t / 1000) - 1 });
    emit(S("boshqa"), { id: 9, text: long("begona chat"), date: 1 }); // kuzatilmaydigan chat — olinmaydi
  };
  const logs = await simulate({ clock, minutes: 6, sources: [S("azo")], reader: tg, store, events: [[3, live]] });
  assert.ok(logs.includes("@azo: +1 yangi e'lon (jonli, 1 s)"));
  assert.equal(store.db.prepare("SELECT via FROM posts WHERE message_id = 101").get().via, "live");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 1);
  assert.equal(store.getCursor("@azo"), 101);
  assert.equal(tg.polls.azo, 1, "faqat boshidagi o'qish — jonli kelgani qayta so'ralmadi");
  assert.equal(stopped, true, "to'xtaganda tinglash ham to'xtaydi");
});

test("jonli tinglash yoqilmasa — guruhlar so'rab turiladi", async () => {
  const { clock, store } = setup(["yuk_guruh"]);
  const tg = fakeTelegram(clock, { yuk_guruh: 0 });
  const reader = {
    ...pollOnly(tg),
    listen: async () => {
      throw new Error("AUTH_KEY_UNREGISTERED");
    },
  };
  const logs = await simulate({ clock, minutes: 2, sources: [SOURCE], reader, store });
  assert.match(logs[0], /Jonli tinglash yoqilmadi — AUTH_KEY_UNREGISTERED/);
  assert.ok(tg.polls.yuk_guruh >= 3);
});

test("FLOOD_WAIT: Telegram aytgan vaqtgacha hech narsa so'ralmaydi", async () => {
  const { clock, store } = setup(["tez"], { historyPerMin: { tez: 4 } });
  const tg = fakeTelegram(clock, { tez: 15_000 });
  const floodAt = clock.t + 2 * MIN;
  const flood = () => (tg.failNext = Object.assign(new Error("A wait of 30 seconds is required"), { errorMessage: "FLOOD", seconds: 30 }));
  const logs = await simulate({ clock, minutes: 4, sources: [S("tez")], reader: pollOnly(tg), store, events: [[2, flood]] });
  assert.ok(logs.some((l) => l.includes("FLOOD_WAIT 30 s")));
  assert.equal(tg.pollTimes.filter((t) => t > floodAt && t < floodAt + 30_000).length, 0);
  assert.ok(tg.pollTimes.some((t) => t >= floodAt + 30_000), "keyin davom etadi");
});

test("topilmagan guruh tobora siyrakroq so'raladi, boshqalar ishlayveradi", async () => {
  const { clock, store } = setup(["yoq", "bor"]);
  store.db.prepare("DELETE FROM cursors WHERE source = '@yoq'").run();
  const tg = fakeTelegram(clock, { bor: 0, yoq: 0 });
  let attempts = 0;
  const reader = {
    ...pollOnly(tg),
    latestId: async (source) => {
      if (source.value !== "yoq") return tg.latestId(source);
      attempts++;
      throw Object.assign(new Error('No user has "yoq" as username'), { errorMessage: "USERNAME_NOT_OCCUPIED" });
    },
  };
  const logs = await simulate({ clock, minutes: 30, sources: [S("yoq"), S("bor")], reader, store });
  assert.equal(attempts, 5, "0, 1, 3, 7, 15-daqiqada (keyingisi 31-da)");
  assert.ok(logs.includes("@yoq: o'qib bo'lmadi — USERNAME_NOT_OCCUPIED (2-marta, keyingisi 2 daq dan keyin)"));
  assert.ok(tg.polls.bor > 50);
});

test("qo'riqchi: so'rovlar 5 daqiqa davomida faqat xato bersa — jarayon to'xtaydi", async () => {
  const { clock, store } = setup(["yuk_guruh"]);
  const reader = { latestId: async () => 100, since: () => new Promise(() => {}) }; // aloqa uzilgan: javob hech qachon kelmaydi
  const logs = [];
  await assert.rejects(
    simulate({ clock, minutes: 60, sources: [SOURCE], reader, store, pollTimeoutMs: 5, logs }),
    (error) => error instanceof StalledError && /aloqa uzildi/.test(error.message),
  );
  assert.equal(logs.filter((l) => l.includes("javob kelmadi")).length, 4, "0, 1, 3, 7-daqiqada urindi");
});

test("qo'riqchi: jim turish va ora-sira xato — uzilish emas", async () => {
  const { clock, store } = setup(["yuk_guruh"]);
  const tg = fakeTelegram(clock, { yuk_guruh: 0 });
  let calls = 0;
  const reader = {
    latestId: tg.latestId,
    since: async (source, minId) => {
      if (++calls % 3 === 0) throw new Error("tasodifiy xato");
      return tg.since(source, minId);
    },
  };
  await simulate({ clock, minutes: 60, sources: [SOURCE], reader, store }); // StalledError bo'lsa test yiqiladi
  assert.ok(calls > 20);
});

// --- A'zo bo'lish navbati (2026-11-09, «sekin qo'sh») ---

// Soxta Telegram'ga join/mute: answers — guruh → "requested" yoki xato (bo'lmasa — qo'shiladi)
function withJoin(tg, clock, answers = {}) {
  tg.joins = [];
  tg.muted = [];
  tg.join = async (source) => {
    tg.joins.push([source.value, clock.t]);
    const answer = typeof answers[source.value] === "function" ? answers[source.value]() : answers[source.value];
    if (answer instanceof Error) throw answer;
    if (answer === "requested") return "requested";
    tg.joined.push(source.value);
    return "joined";
  };
  tg.mute = async (source) => {
    tg.muted.push(source.value);
  };
  return tg;
}
const tgError = (code, extra = {}) => Object.assign(new Error(code), { errorMessage: code, ...extra });

test("a'zo bo'lish: 5 daqiqada bittadan, eng faoli birinchi, qo'shilgach bildirishnoma o'chiriladi; yopiq qabul — so'rov", async () => {
  const { clock, store } = setup(["kam", "kop", "orta"], { historyPerMin: { kam: 0.1, kop: 2, orta: 0.5 } });
  for (const n of ["kam", "kop", "orta"]) store.requestJoin(`@${n}`);
  const start = clock.t;
  const tg = withJoin(fakeTelegram(clock, { kam: 0, kop: 0, orta: 0 }), clock, { orta: "requested" });
  const logs = await simulate({ clock, minutes: 12, sources: [S("kam"), S("kop"), S("orta")], reader: tg, store });

  assert.deepEqual(tg.joins.map(([name]) => name), ["kop", "orta", "kam"], "eng ko'p yozadigani birinchi");
  assert.ok(tg.joins[0][1] - start >= MIN, "birinchisi ishga tushgandan 1 daqiqa keyin");
  assert.ok(tg.joins[1][1] - tg.joins[0][1] >= 5 * MIN && tg.joins[2][1] - tg.joins[1][1] >= 5 * MIN, "orasida 5 daqiqa");
  assert.deepEqual(tg.muted, ["kop", "kam"], "so'rov yuborilganniki hali o'chirilmaydi");
  assert.ok(logs.includes("@kop: akkaunt guruhga qo'shildi, bildirishnomasi o'chirildi; navbatda yana 2 ta, keyingisi 5 daq dan keyin"));
  assert.ok(logs.some((l) => l.startsWith("@orta: guruhda a'zolikni admin tasdiqlaydi — so'rov yuborildi")));
  assert.deepEqual(
    store.listSources().map((s) => [s.name, s.joinState, s.joined]),
    [["@kam", "joined", true], ["@kop", "joined", true], ["@orta", "requested", false]],
  );
});

test("a'zo bo'lish: admin tasdiqlasa — a'zo va bildirishnoma o'chiriladi; allaqachon a'zo — so'rovsiz", async () => {
  const { clock, store } = setup(["sorov", "azo"]);
  store.setJoinState("@sorov", "requested");
  store.requestJoin("@azo");
  const tg = withJoin(fakeTelegram(clock, { sorov: 0, azo: 0 }, { joined: ["azo"] }), clock);
  const logs = await simulate({ clock, minutes: 12, sources: [S("sorov"), S("azo")], reader: tg, store, events: [[4, () => tg.joined.push("sorov")]] });
  assert.deepEqual(tg.joins, [], "Telegram'ga a'zo bo'lish so'rovi yuborilmadi");
  assert.ok(logs.includes("@sorov: guruh admini a'zolik so'rovini tasdiqladi, bildirishnomasi o'chirildi"));
  assert.deepEqual(tg.muted, ["sorov"]);
  assert.deepEqual(store.listSources().map((s) => [s.name, s.joinState]), [["@azo", "joined"], ["@sorov", "joined"]]);
});

test("a'zo bo'lish: 24 soatlik limit, FLOOD_WAIT, xato va guruhlar limiti", async () => {
  const names = ["g1", "g2", "g3", "g4", "g5"];
  const { clock, store } = setup(names, { historyPerMin: { g1: 5, g2: 4, g3: 3, g4: 2, g5: 1 } });
  for (const n of names) store.requestJoin(`@${n}`);
  let floods = 0;
  const tg = withJoin(fakeTelegram(clock, Object.fromEntries(names.map((n) => [n, 0]))), clock, {
    g1: () => (floods++ ? undefined : tgError("FLOOD", { seconds: 600 })), // birinchi urinishda «sekinroq»
    g2: tgError("CHANNEL_PRIVATE"),
  });
  const logs = await simulate({ clock, minutes: 60, sources: names.map(S), reader: tg, store, joinsPerDay: 2 });

  assert.ok(logs.includes("A'zo bo'lish: Telegram vaqtincha chekladi (FLOOD_WAIT 600 s) — keyingisi 15 daq dan keyin"));
  assert.ok(tg.joins[1][1] - tg.joins[0][1] >= 15 * MIN, "FLOOD dan keyin 10 + 5 daqiqa kutdi");
  assert.deepEqual(tg.joins.map(([name]) => name), ["g1", "g1", "g2", "g3"], "g1 qayta urinildi, g2 xato, g3 — ikkinchi a'zolik, keyin limit");
  assert.ok(logs.some((l) => l.startsWith("@g2: a'zo bo'lib bo'lmadi — CHANNEL_PRIVATE")));
  assert.ok(logs.includes("A'zo bo'lish: 24 soatda 2 ta limit tugadi — navbatdagi 2 tasi keyinroq"));
  const row = (n) => store.listSources().find((s) => s.name === n);
  assert.deepEqual([row("@g2").joinState, row("@g2").joinError], ["error", "CHANNEL_PRIVATE"]);
  assert.equal(row("@g5").joinState, "wanted", "limit tugagani navbatda qoladi");

  // Akkaunt 500 guruh limitiga yetgan — boshqa urinilmaydi
  const more = setup(["x", "y"]);
  for (const n of ["x", "y"]) more.store.requestJoin(`@${n}`);
  const full = withJoin(fakeTelegram(more.clock, { x: 0, y: 0 }), more.clock, { x: tgError("CHANNELS_TOO_MUCH"), y: tgError("CHANNELS_TOO_MUCH") });
  const fullLogs = await simulate({ clock: more.clock, minutes: 20, sources: [S("x"), S("y")], reader: full, store: more.store });
  assert.equal(full.joins.length, 1);
  assert.ok(fullLogs.includes("A'zo bo'lish to'xtadi: akkaunt guruhlar limitiga yetgan (CHANNELS_TOO_MUCH)"));
});
