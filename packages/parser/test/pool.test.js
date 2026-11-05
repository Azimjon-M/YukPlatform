import { test } from "node:test";
import assert from "node:assert/strict";
import { createParserPool, nextPacificMidnight, pacificDay, pauseFor, PAUSES } from "../src/pool.js";

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
  assert.deepEqual(pauseFor(provider, err(429, { daily: true }), t), { ms: 2 * 60 * MIN, reason: "daily" });
  assert.deepEqual(pauseFor(provider, err(429), t), { ms: PAUSES.dailyMs, reason: "daily" });
  assert.deepEqual(pauseFor(provider, err(503), t), { ms: PAUSES.busyMs, reason: "busy" });
  assert.equal(pauseFor(provider, err(403), t).reason, "key");
  assert.equal(pauseFor(provider, err(404), t).reason, "model");
  assert.equal(pauseFor(provider, err(500), t), null);
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
  assert.equal(made[0].opts.attempts, 2, "pool'da SDK kam urinadi — boshqa ulanishga tezroq o'tadi");
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
