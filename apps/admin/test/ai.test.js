import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiSummaryText,
  aiTotals,
  healthBadge,
  newModels,
  pacificDay,
  providerOptionLabel,
  secondsText,
  slotStatus,
  sortSlots,
  testLoadText,
  testResultText,
  todayStats,
  todayText,
} from "../src/aiStatus.js";
import { configChecklist } from "../src/metrics.js";

const TZ = { timeZone: "Asia/Tashkent" };
// 2026-11-05 10:00 Toshkent = 05:00 UTC = 2026-11-04 21:00 Tinch okeani (PST)
const NOW = Date.UTC(2026, 10, 5, 5, 0);
const DAY = pacificDay(NOW);
const KEY = { id: 1, enabled: true, problem: null };
const at = (h, m = 0) => Date.UTC(2026, 10, 5, h - 5, m); // Toshkent vaqti → ms

const state = (extra = {}) => ({ day: DAY, requests: 10, posts: 80, errors: 1, lastUsedAt: NOW - 60_000, cooldownUntil: null, reason: null, busy: false, ...extra });

test("Tinch okeani kuni: Toshkentda 13:00 gacha — hali kechagi kun", () => {
  assert.equal(pacificDay(NOW), "2026-11-04");
  assert.equal(pacificDay(at(13, 30)), "2026-11-05");
});

test("bugungi hisoblar: kechagi holat nolga tushadi", () => {
  assert.deepEqual(todayStats(state(), NOW), { requests: 10, posts: 80, errors: 1 });
  assert.deepEqual(todayStats(state({ day: "2026-11-03" }), NOW), { requests: 0, posts: 0, errors: 0 });
  assert.deepEqual(todayStats(null, NOW), { requests: 0, posts: 0, errors: 0 });
  assert.equal(todayText({ requests: 123, posts: 1230, errors: 2 }), "bugun: 123 so'rov · 1 230 e'lon · 2 xato");
  assert.equal(todayText({ requests: 0, posts: 0, errors: 0 }), "bugun: 0 so'rov · 0 e'lon");
});

test("ulanish holati: dam olish, xato, ishlayapti, tayyor, o'chirilgan", () => {
  const opts = { now: NOW, ...TZ };
  const daily = slotStatus(KEY, state({ cooldownUntil: at(13), reason: "daily" }), opts);
  assert.deepEqual([daily.kind, daily.label, daily.detail], ["resting", "Dam olyapti", "13:00 da qayta tekshiriladi · kunlik limit"]);
  assert.equal(slotStatus(KEY, state({ cooldownUntil: at(10, 1), reason: "minute" }), opts).detail, "10:01 gacha · daqiqalik limit");
  assert.equal(slotStatus(KEY, state({ cooldownUntil: at(10, 1), reason: "network" }), opts).detail, "10:01 gacha · internet uzildi");
  assert.equal(slotStatus(KEY, state({ cooldownUntil: at(10, 1), reason: "error" }), opts).detail, "10:01 gacha · xato — e'lonlar boshqa modelga berildi");
  const broken = slotStatus(KEY, state({ cooldownUntil: at(16), reason: "key" }), opts);
  assert.deepEqual([broken.kind, broken.label, broken.tone], ["error", "Xato", "critical"]);
  assert.match(broken.detail, /kalit xato · 16:00 da qayta uriniladi/);
  // Dam olish muddati o'tgan — yana tayyor
  assert.equal(slotStatus(KEY, state({ cooldownUntil: NOW - 1, reason: "daily" }), opts).kind, "ready");
  // busy faqat bot ishlayotganda
  assert.equal(slotStatus(KEY, state({ busy: true }), { ...opts, botRunning: true }).label, "Ishlayapti");
  assert.equal(slotStatus(KEY, state({ busy: true }), { ...opts, botRunning: false }).label, "Tayyor");
  assert.equal(slotStatus(KEY, null, opts).detail, "hali ishlatilmagan");
  assert.equal(slotStatus({ ...KEY, enabled: false }, state(), opts).kind, "off");
  assert.deepEqual(slotStatus({ ...KEY, problem: ".env da GEMINI_API_KEY yozilmagan" }, state(), opts).detail, ".env da GEMINI_API_KEY yozilmagan");
});

test("yig'indi: faol, dam olayotgan, eng yaqin muddat, bugungi so'rovlar", () => {
  const keys = [
    {
      ...KEY,
      models: [
        { model: "a", state: state({ busy: true }) },
        { model: "b", state: state({ cooldownUntil: at(13), reason: "daily" }) },
        { model: "c", state: state({ cooldownUntil: at(10, 5), reason: "busy" }) },
        { model: "d", state: null },
      ],
    },
    { id: 2, enabled: true, problem: null, models: [{ model: "e", state: state({ cooldownUntil: at(15), reason: "model", day: "2026-11-01" }) }] },
    { id: 3, enabled: false, problem: null, models: [{ model: "f", state: state() }] },
  ];
  const t = aiTotals(keys, { now: NOW, botRunning: true });
  assert.equal(t.connections, 5);
  assert.equal(t.active, 2);
  assert.equal(t.working, 1);
  assert.equal(t.resting, 2);
  assert.equal(t.failing, 1);
  assert.equal(t.soonest, at(10, 5));
  assert.equal(t.requests, 40, "o'chirilgan kalitning bugungi so'rovlari ham, kechagisi — yo'q");
  assert.equal(t.posts, 320);
  assert.equal(aiSummaryText(t), "2 / 5 faol · 2 tasi dam olyapti · 1 tasi xato");
  assert.equal(aiSummaryText(aiTotals([])), "ulanish yo'q — AI sahifasida kalit qo'shing");
});

test("«muammoli» belgisi: 24 soatdagi xatolar, eskirgani ko'rsatilmaydi, ro'yxatda birinchi", () => {
  const HOUR = 3_600_000;
  const bad = state({ problem: { since: NOW - 2 * HOUR, lastFaultAt: NOW - HOUR, faults: 4, error: "503 band" }, faults: [NOW - 30 * HOUR, NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR] });
  const badge = healthBadge(bad, NOW);
  assert.deepEqual([badge.label, badge.detail, badge.error], ["Muammoli", "24 soatda 3 ta xato · oxirgi navbatda ishlatiladi", "503 band"]);
  assert.equal(healthBadge(state({ problem: { since: 1, lastFaultAt: NOW - 25 * HOUR } }), NOW), null, "bot ishlamasa ham eskirgan belgi yo'q");
  assert.equal(healthBadge(state(), NOW), null);
  assert.equal(healthBadge(null, NOW), null);

  const models = [{ model: "a", state: state() }, { model: "b", state: bad }, { model: "c", state: null }, { model: "d", state: bad }];
  assert.deepEqual(sortSlots(models, NOW).map((m) => m.model), ["b", "d", "a", "c"]);
  const t = aiTotals([{ ...KEY, models }], { now: NOW });
  assert.equal(t.problems, 2);
  assert.equal(aiSummaryText(t), "4 / 4 faol · 2 tasi muammoli");
});

test("modellar, provayder nomi, sinov natijasi", () => {
  assert.deepEqual(newModels(["x", "y", "z"], ["y"]), ["x", "z"]);
  assert.equal(providerOptionLabel({ title: "Google Gemini", free: true }), "Google Gemini — bepul");
  assert.equal(providerOptionLabel({ title: "Anthropic Claude", free: false }), "Anthropic Claude — pullik");
  assert.equal(providerOptionLabel({ title: "1pro.uz (Qwen)", free: null, limitNote: "kuniga 1 mln token" }), "1pro.uz (Qwen) — kuniga 1 mln token");
  assert.equal(secondsText(1234), "1,2 s");
  assert.equal(testLoadText({ from: "Toshkent", to: "samarqand", weightT: 20, cargo: "un", truckClass: "fura", bodyType: "tent" }), "Toshkent → Samarqand vil., 20 tonna un · fura, tent");
  assert.equal(testLoadText({ from: "Toshkent", to: null }), "Toshkent → ?");
  assert.deepEqual(testResultText({ ok: true, ms: 1200, loads: [{ from: "Toshkent", to: "Samarqand", weightT: 20, cargo: "un" }] }), {
    ok: true,
    title: "✓ 1,2 s",
    text: "Toshkent → Samarqand, 20 tonna un",
  });
  assert.equal(testResultText({ ok: true, ms: 900, loads: [] }).text, "Javob keldi, lekin yuk ajratilmadi — boshqa modelni sinab ko'ring");
  assert.deepEqual(testResultText({ ok: false, error: "Kunlik limit tugadi" }), { ok: false, title: "✖ Ishlamadi", text: "Kunlik limit tugadi" });
});

test("bosh sahifa ro'yxati: AI ulanishlari bitta qator bo'lib, AI sahifasiga olib boradi", () => {
  const config = { botToken: true, channel: "@k", telegramApi: true, miniappUrl: null, parser: { provider: "gemini", keys: { gemini: true, claude: false } } };
  const withAi = configChecklist(config, { connections: 3, active: 2, resting: 1, failing: 0 });
  assert.deepEqual(
    withAi.map((r) => r.id),
    ["bot", "channel", "tg", "ai", "miniapp"],
  );
  const ai = withAi.find((r) => r.id === "ai");
  assert.deepEqual([ai.label, ai.ok, ai.value, ai.href], ["AI ulanishlari", true, "2 / 3 faol · 1 tasi dam olyapti", "/ai"]);
  assert.equal(configChecklist(config, { connections: 0, active: 0, resting: 0, failing: 0 }).find((r) => r.id === "ai").ok, false);
  assert.deepEqual(
    configChecklist(config).map((r) => r.id),
    ["bot", "channel", "tg", "ai", "gemini", "claude", "miniapp"],
  );
});
