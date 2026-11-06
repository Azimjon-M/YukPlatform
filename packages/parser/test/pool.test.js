import { test } from "node:test";
import assert from "node:assert/strict";
import { createParserPool, HEALTH, nextPacificMidnight, pacificDay, pauseFor, PAUSES } from "../src/pool.js";

const MIN = 60_000;
const err = (status, extra = {}) => Object.assign(new Error(String(status)), { status, ...extra });
// Soxta provayder: e.minute — daqiqalik limit, e.daily — kunlik
const provider = {
  id: "soxta",
  retryAfterMs: (e) => (e.minute ? 30_000 : null),
  isDailyLimit: (e) => Boolean(e.daily),
  isFatal: (e) => [401, 403, 404, 429, 503].includes(e.status),
  describeError: (e) => `xato ${e.status}`,
};

function setup(list, options = {}) {
  let time = Date.UTC(2026, 10, 5, 6, 0); // 05.11.2026 11:00 Toshkent = 22:00 Tinch okeani (oldingi kun)
  const states = [];
  const made = [];
  const pool = createParserPool({
    connections: typeof list === "function" ? list : list.map((c) => ({ provider, ...c })),
    makeParser: (opts) => {
      const parser = { opts, model: opts.model };
      made.push(parser);
      return parser;
    },
    now: () => time,
    onState: (s) => states.push(s),
    ...options,
  });
  return { pool, states, made, advance: (ms) => (time += ms), now: () => time };
}

test("Tinch okeani yarim tuni: Toshkentda 13:00 (qishki vaqt), kun nomi", () => {
  const t = Date.UTC(2026, 10, 5, 6, 0);
  assert.equal(new Date(nextPacificMidnight(t)).toISOString(), "2026-11-05T08:00:00.000Z");
  assert.equal(pacificDay(t), "2026-11-04");
  // Yozgi vaqtga o'tish kuni (2026-03-08): yarim tun hali ham to'g'ri chiqadi
  assert.equal(new Date(nextPacificMidnight(Date.UTC(2026, 2, 8, 12, 0))).toISOString(), "2026-03-09T07:00:00.000Z");
});

test("xato turi → dam olish: daqiqalik, kunlik, band, kalit; e'lonning o'z xatosi — null", () => {
  const t = Date.UTC(2026, 10, 5, 6, 0);
  assert.deepEqual(pauseFor(provider, err(429, { minute: true }), t), { ms: 30_000, reason: "minute" });
  // Kunlik limit: 13:00 gacha 2 soat, lekin 30 daqiqadan keyin bitta so'rov bilan tekshiriladi
  assert.deepEqual(pauseFor(provider, err(429, { daily: true }), t), { ms: PAUSES.probeMs, reason: "daily", resetAt: Date.UTC(2026, 10, 5, 8, 0) });
  assert.deepEqual(pauseFor(provider, err(429, { daily: true }), Date.UTC(2026, 10, 5, 7, 50)).ms, 10 * MIN, "yangilanishga 10 daqiqa qolgan");
  assert.deepEqual(pauseFor(provider, err(429), t), { ms: PAUSES.dailyMs, reason: "daily" });
  assert.deepEqual(pauseFor(provider, err(503), t), { ms: PAUSES.busyMs, reason: "busy" });
  assert.equal(pauseFor(provider, err(403), t).reason, "key");
  assert.equal(pauseFor(provider, err(404), t).reason, "model");
  assert.equal(pauseFor(provider, err(500), t), null);
  // Internet uzilgan (javob umuman kelmagan) — modelning aybi emas, tez qayta urinadi
  assert.deepEqual(pauseFor(provider, new TypeError("fetch failed"), t), { ms: PAUSES.networkMs, reason: "network" });
  assert.equal(pauseFor(provider, Object.assign(new Error("x"), { code: "ECONNRESET" }), t).reason, "network");
});

test("navbat bilan: eng uzoq ishlatilmagani, band bo'lgani berilmaydi", () => {
  const { pool, advance } = setup([{ id: "a", model: "m1" }, { id: "b", model: "m2" }]);
  const first = pool.acquire();
  const second = pool.acquire();
  assert.deepEqual([first.id, second.id], ["a", "b"]);
  assert.equal(pool.acquire(), null, "ikkalasi ham band");
  assert.equal(pool.nextReadyIn(), null);
  first.release({ posts: 10 });
  advance(1000);
  second.release({ posts: 10 });
  assert.equal(pool.acquire().id, "a", "a avvalroq ishlatilgan — navbat unda");
});

test("limitga tushgan ulanish dam oladi, qolgani ishlaydi; muddat o'tgach qaytadi", () => {
  const { pool, advance, states } = setup([{ id: "a", model: "m1" }, { id: "b", model: "m2" }]);
  const a = pool.acquire();
  assert.deepEqual(a.fail(err(429, { minute: true })), { ms: 30_000, reason: "minute" });
  a.release();
  assert.equal(states.at(-1).reason, "minute");
  assert.match(states.at(-1).lastError, /429/);
  const b = pool.acquire();
  assert.equal(b.id, "b");
  b.release();
  assert.equal(pool.acquire().id, "b", "a hali dam olyapti");
  assert.equal(pool.nextReadyIn(), 30_000);
  advance(30_000);
  assert.equal(pool.acquire().id, "a");
  assert.equal(pool.list().find((s) => s.id === "a").reason, null, "dam olish tugadi");
});

test("bugungi so'rovlar sanaladi va yangi kunda noldan; holat bazadan tiklanadi", () => {
  const { pool, made, advance, states } = setup([{ id: "a", model: "m1", state: { day: "2026-11-04", requests: 40, cooldownUntil: 0 } }]);
  const lease = pool.acquire();
  made[0].opts.onRequest();
  made[0].opts.onRequest();
  lease.release({ posts: 20 });
  assert.deepEqual([states.at(-1).requests, states.at(-1).posts], [42, 20]);
  advance(3 * 60 * MIN); // Tinch okeanida yangi kun boshlandi
  const next = pool.acquire();
  made[0].opts.onRequest();
  next.release({ posts: 10 });
  assert.deepEqual([states.at(-1).day, states.at(-1).requests, states.at(-1).posts], ["2026-11-05", 1, 10]);
});

test("kunlik limit bazada saqlangan bo'lsa, bot qayta ishga tushganda ham dam olishda qoladi", () => {
  const { pool, now } = setup([{ id: "a", model: "m1", state: { cooldownUntil: Date.UTC(2026, 10, 5, 8, 0), reason: "daily" } }]);
  assert.equal(pool.acquire(), null);
  assert.equal(pool.nextReadyIn(), Date.UTC(2026, 10, 5, 8, 0) - now());
});

test("ro'yxat yangilanadi: yangi kalit qo'shiladi, o'chirilgani ishini tugatib chiqadi, kalit o'zgarsa — yangi parser", () => {
  let list = [{ id: "a", provider, model: "m1", apiKey: "k1" }];
  const { pool, made, advance } = setup(() => list, { refreshMs: 1000 });
  const a = pool.acquire();
  assert.equal(made[0].opts.apiKey, "k1");
  assert.equal(made[0].opts.attempts, 1, "pool'da SDK qayta urinmaydi — e'lonlar darhol boshqa ulanishga o'tadi");
  assert.equal(made[0].opts.splitOnError, false, "xatoda guruh shu ulanishda bo'linmaydi");
  list = [{ id: "b", provider, model: "m2", apiKey: "k2" }];
  assert.equal(pool.size(), 1, "refreshMs o'tmaguncha eski ro'yxat");
  advance(1000);
  assert.equal(pool.size(), 1, "a ishlayapti — yashirin, b bor");
  assert.equal(pool.acquire().id, "b");
  a.release();
  assert.deepEqual(pool.list().map((s) => s.id), ["b"]);
  list = [{ id: "b", provider, model: "m2", apiKey: "k3" }];
  advance(1000);
  pool.size();
  assert.equal(made.at(-1).opts.apiKey, "k3");
});

test("xato bo'lsa: boshqa ulanish bor — bu 1 daqiqa dam oladi (e'lonlar boshqasiga), yolg'iz bo'lsa — null", () => {
  const two = setup([{ id: "a", model: "m1" }, { id: "b", model: "m2" }]);
  const a = two.pool.acquire();
  assert.deepEqual(a.fail(err(500)), { ms: PAUSES.errorMs, reason: "error" });
  a.release();
  assert.equal(two.pool.acquire().id, "b", "a dam olyapti — e'lonlarni b oladi");

  const one = setup([{ id: "a", model: "m1" }]);
  const lone = one.pool.acquire();
  assert.equal(lone.fail(err(500)), null, "boshqa ulanish yo'q — ishchi e'lonlarni bittadan tahlil qiladi");
  lone.release();
  assert.equal(one.pool.acquire().id, "a");
});

// Ulanishga xato berdirib, dam olishi tugaguncha vaqtni suradi
function failOnce(ctx, id, error) {
  const lease = ctx.pool.acquire();
  assert.equal(lease.id, id);
  const pause = lease.fail(error);
  lease.release();
  ctx.advance(pause?.ms ?? 0);
  return pause;
}

test("muammoli: oxirgi 10 so'rovdan 3 tasi xato — belgilanadi, oxirgi navbatda beriladi, uzoqroq dam oladi", () => {
  const ctx = setup([{ id: "a", model: "m1" }, { id: "b", model: "m2" }]);
  const b = ctx.pool.acquire(); // b ni band qilib turamiz — a navbatda birinchi bo'lsin
  assert.equal(b.id, "a");
  b.release({ posts: 5 });
  ctx.advance(1000);
  const keepB = ctx.pool.acquire();
  assert.equal(keepB.id, "b");
  assert.equal(failOnce(ctx, "a", err(503)).flagged, undefined);
  assert.equal(failOnce(ctx, "a", err(500)).flagged, undefined);
  const third = failOnce(ctx, "a", err(503));
  assert.equal(third.flagged, true);
  assert.equal(third.ms, PAUSES.problemMs, "muammoli — kamida 15 daqiqa");
  const state = ctx.pool.list().find((s) => s.id === "a");
  assert.equal(state.problem.faults, 3);
  assert.match(state.problem.error, /503/);
  keepB.release({ posts: 5 });
  ctx.advance(1000);
  // a uzoqroq ishlatilmagan bo'lsa ham, sog'lom b birinchi
  assert.equal(ctx.pool.acquire().id, "b");
  assert.equal(ctx.pool.acquire().id, "a", "sog'lomi band — muammolisi ham ishlatiladi");
});

test("muammoli: limitlar va internet xato hisoblanmaydi; 24 soatda 4 ta xato — belgilanadi", () => {
  const ctx = setup([{ id: "a", model: "m1" }, { id: "b", model: "m2" }]);
  const first = ctx.pool.acquire(); // a
  first.release({ posts: 1 });
  const holdB = ctx.pool.acquire(); // b band turadi
  for (const e of [err(429, { minute: true }), err(429, { daily: true }), new TypeError("fetch failed"), err(429, { minute: true })]) failOnce(ctx, "a", e);
  assert.equal(ctx.pool.list().find((s) => s.id === "a").problem ?? null, null);
  // Xatolar orasida 10 tadan muvaffaqiyatli so'rov: "oxirgi 10 tadan 3 tasi" qoidasi ishlamaydi, 24 soat qoidasi ishlaydi
  for (let i = 0; i < HEALTH.maxFaults; i++) {
    const pause = failOnce(ctx, "a", err(503));
    assert.equal(Boolean(pause.flagged), i === HEALTH.maxFaults - 1, `${i + 1}-xato`);
    for (let j = 0; j < HEALTH.recentSize; j++) {
      const lease = ctx.pool.acquire();
      lease.release({ posts: 1 });
    }
  }
  holdB.release();
});

test("muammoli belgisi 24 soat xatosiz o'tsa yechiladi", () => {
  const ctx = setup([{ id: "a", model: "m1", state: { problem: { since: 0, lastFaultAt: Date.UTC(2026, 10, 4, 7, 0), faults: 4 } } }]);
  assert.ok(ctx.pool.list()[0].problem, "hali 23 soat o'tgan");
  ctx.advance(60 * MIN);
  ctx.pool.acquire().release();
  assert.equal(ctx.pool.list()[0].problem, null);
});

test("boshqaruv markazi buyruqlari: «Sinash» ishladi — dam olish bekor; belgini olib tashlash; har biri bir marta", () => {
  let list = [{ id: "a", provider, model: "m1", apiKey: "k", state: { cooldownUntil: Date.UTC(2026, 10, 5, 8, 0), reason: "daily", problem: { since: 1, lastFaultAt: Date.UTC(2026, 10, 5, 5, 0) }, faults: [1] } }];
  const ctx = setup(() => list, { refreshMs: 1000 });
  assert.equal(ctx.pool.acquire(), null, "kunlik limitda dam olyapti");
  const wakeAt = ctx.now();
  list = [{ ...list[0], control: { wakeAt } }];
  ctx.advance(1000);
  const lease = ctx.pool.acquire();
  assert.ok(lease, "uyg'otildi");
  assert.equal(ctx.states.at(-1).wakeSeen, wakeAt);
  lease.fail(err(429, { daily: true }));
  lease.release();
  ctx.advance(1000);
  assert.equal(ctx.pool.acquire(), null, "eski buyruq qayta bajarilmaydi");
  assert.ok(ctx.pool.list()[0].problem);
  list = [{ ...list[0], control: { wakeAt, healthResetAt: ctx.now() } }];
  ctx.advance(1000);
  const slot = ctx.pool.list()[0];
  assert.equal(slot.problem, null);
  assert.deepEqual(slot.faults, []);
  assert.ok(slot.cooldownUntil > ctx.now(), "belgini olib tashlash dam olishni o'zgartirmaydi (API wakeAt ham yuboradi)");
});
