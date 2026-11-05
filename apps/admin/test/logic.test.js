import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, OFFLINE_MESSAGE, readResponse } from "../src/api.js";
import { bucketRanges, labelEvery, labelsCollide, linePath, nearestIndex, niceStep, yTicks } from "../src/chart.js";
import { emptyLog, isNearBottom, mergeLogs } from "../src/logs.js";
import { configChecklist, throughput } from "../src/metrics.js";
import { buildQuery, pageInfo } from "../src/query.js";
import { hrefFor, pathInApp, routeFor, shouldIntercept } from "../src/router.js";
import { postNote, processActions, processStatus, tabCounts } from "../src/status.js";

test("so'rov qatori bo'sh qiymatlarni tashlaydi", () => {
  assert.equal(buildQuery({ from: "andijon", q: "", hours: null, to: undefined, limit: 50, offset: 0 }), "?from=andijon&limit=50&offset=0");
  assert.equal(buildQuery({ q: "sement un" }), "?q=sement+un");
  assert.equal(buildQuery({}), "");
});

test("sahifalash raqamlari", () => {
  assert.deepEqual(pageInfo({ offset: 50, limit: 50, total: 120 }), { first: 51, last: 100, total: 120, hasPrev: true, hasNext: true, prevOffset: 0, nextOffset: 100 });
  assert.equal(pageInfo({ offset: 0, limit: 50, total: 0 }).first, 0);
  assert.equal(pageInfo({ offset: 100, limit: 50, total: 120 }).hasNext, false);
});

test("router: /admin ostidagi sahifalar", () => {
  assert.equal(pathInApp("/admin"), "/");
  assert.equal(pathInApp("/admin/"), "/");
  assert.equal(pathInApp("/admin/yuklar/"), "/yuklar");
  assert.equal(pathInApp("/administrator"), null);
  assert.equal(pathInApp("/%E0%A4%A"), null);
  assert.equal(routeFor("/admin/navbat").id, "queue");
  assert.equal(routeFor("/admin/").id, "overview");
  assert.equal(routeFor("/admin/yoq"), null);
  assert.equal(hrefFor("/"), "/admin/");
  assert.equal(hrefFor("/ai"), "/admin/ai");
  assert.equal(shouldIntercept({ button: 0 }), true);
  assert.equal(shouldIntercept({ button: 0, ctrlKey: true }), false);
  assert.equal(shouldIntercept({ button: 1 }), false);
});

test("API javobi: ma'lumot, server xatosi, server yo'q", () => {
  assert.deepEqual(readResponse(200, '{"items":[]}'), { items: [] });
  assert.equal(readResponse(204, ""), null);
  assert.throws(() => readResponse(409, '{"error":"Bot terminalda ishlayapti"}'), (e) => e instanceof ApiError && e.message === "Bot terminalda ishlayapti" && e.status === 409 && !e.offline);
  assert.throws(() => readResponse(500, ""), (e) => e.offline && e.message === OFFLINE_MESSAGE);
  assert.throws(() => readResponse(503, "Boshqaruv markazi hali yig'ilmagan"), (e) => e.offline);
});

test("o'zgartiruvchi so'rovga x-yuk-admin sarlavhasi qo'shiladi", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => '{"ok":true}' };
  });
  const api = await import("../src/api.js");
  await api.get("/api/loads", { from: "andijon", q: "" });
  await api.patch("/api/sources/%40guruh", { enabled: false });
  assert.equal(calls[0].url, "/api/loads?from=andijon");
  assert.equal(calls[0].init.headers["x-yuk-admin"], undefined);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.headers["x-yuk-admin"], "1");
  assert.equal(calls[1].init.headers["content-type"], "application/json");
  assert.equal(calls[1].init.body, '{"enabled":false}');
});

test("fetch tushib qolsa — server bilan aloqa yo'q", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const api = await import("../src/api.js");
  await assert.rejects(api.get("/api/overview"), (e) => e.offline && e.message === OFFLINE_MESSAGE);
});

test("jarayon holati va tugmalar", () => {
  assert.deepEqual(processActions("running"), { start: false, stop: true, restart: true });
  assert.deepEqual(processActions("stopped"), { start: true, stop: false, restart: false });
  assert.deepEqual(processActions("external"), { start: false, stop: false, restart: false });
  assert.deepEqual(processActions("stopping"), { start: false, stop: false, restart: false });
  assert.equal(processActions("crashed").start, true);
  assert.equal(processStatus("external").label, "Terminalda ishlayapti");
  assert.equal(processStatus("boshqa").label, "boshqa");
});

test("navbat tablari soni va e'lon izohi", () => {
  const counts = tabCounts({ new: 12, done: 300, failed: 3, duplicate: 40 });
  assert.equal(counts[""], 355);
  assert.equal(counts.new, 12);
  assert.equal(counts.duplicate, 40);
  assert.deepEqual(postNote({ status: "done", error: "mashina_bor" }), { tone: "neutral", text: "O'tkazib yuborildi: Mashina bo'sh, yuk kerak" });
  assert.deepEqual(postNote({ status: "failed", error: "AI javobi buzuq" }), { tone: "critical", text: "AI javobi buzuq" });
  assert.equal(postNote({ status: "done", error: null }), null);
});

test("tahlil oqimga yetib boryaptimi", () => {
  const slow = throughput({ posts: 876, processed: 330 }, { waiting: 900 });
  assert.equal(slow.behind, true);
  assert.equal(slow.tone, "critical");
  assert.equal(slow.title, "Tahlil oqimdan 2,7 barobar sekin");
  assert.match(slow.text, /Daqiqasiga 14,6 ta e'lon kelyapti, 5,5 tasi/);
  assert.match(slow.text, /soatiga ~546 taga/);
  const ok = throughput({ posts: 100, processed: 98 });
  assert.equal(ok.behind, false);
  assert.equal(ok.tone, "good");
  assert.equal(throughput({ posts: 100, processed: 0 }).title, "E'lonlar tahlil qilinmayapti");
  const unmeasured = throughput({ posts: 738, processed: 0, loads: 496 });
  assert.equal(unmeasured.tone, "warning");
  assert.equal(unmeasured.title, "Tahlil tezligi o'lchanmayapti");
  assert.match(unmeasured.text, /496 ta yuk/);
  assert.equal(throughput({ posts: 0, processed: 0 }, { waiting: 5 }).tone, "warning");
  assert.equal(throughput({}, {}).tone, "neutral");
});

test("sozlamalar ro'yxati maxfiy qiymat ko'rsatmaydi", () => {
  const rows = configChecklist({
    botToken: true,
    channel: "@Kanal",
    miniappUrl: null,
    telegramApi: false,
    parser: { provider: "gemini", model: null, keys: { gemini: true, claude: false } },
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.bot.ok, true);
  assert.equal(byId.bot.value, "yozilgan");
  assert.equal(byId.tg.ok, false);
  assert.equal(byId.ai.ok, true);
  assert.equal(byId.ai.value, "gemini · standart model");
  assert.equal(byId.claude.ok, null);
  assert.equal(byId.miniapp.ok, null);
  assert.deepEqual(configChecklist(null), []);
});

test("grafik: qadam, o'q, bucket vaqtlari, eng yaqin nuqta", () => {
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(17), 5);
  assert.equal(niceStep(870), 250);
  assert.deepEqual(yTicks(17), [0, 5, 10, 15, 20]);
  assert.deepEqual(yTicks(0), [0, 1]);
  const ranges = bucketRanges(10 * 3600_000, 3);
  assert.deepEqual(ranges.at(-1), { start: 9 * 3600_000, end: 10 * 3600_000 });
  assert.equal(ranges[0].end, 8 * 3600_000);
  assert.equal(labelEvery(30), 2);
  assert.equal(labelEvery(10), 6);
  assert.equal(nearestIndex(5, 10, 20, 24), 0);
  assert.equal(nearestIndex(52, 10, 20, 24), 2);
  assert.equal(nearestIndex(9999, 10, 20, 24), 23);
  assert.equal(linePath([[0, 1], [2.25, 3]]), "M0.0 1.0L2.3 3.0");
  assert.equal(labelsCollide([10, 40, 80]), false);
  assert.equal(labelsCollide([10, 50, 18]), true);
});

test("loglar: faqat yangi qatorlar qo'shiladi, server qayta yonsa — boshidan", () => {
  const line = (seq) => ({ seq, time: seq, stream: "out", text: `q${seq}` });
  let state = mergeLogs(emptyLog(), { lines: [line(1), line(2)], last: 2 });
  assert.deepEqual(state.lines.map((l) => l.seq), [1, 2]);
  state = mergeLogs(state, { lines: [line(2), line(3)], last: 3 });
  assert.deepEqual(state.lines.map((l) => l.seq), [1, 2, 3]);
  assert.equal(state.last, 3);
  assert.equal(state.added, 1);
  assert.equal(mergeLogs(state, { lines: [], last: 3 }).lines, state.lines);
  assert.equal(mergeLogs(state, { lines: [], last: 1 }).reset, true);
  const capped = mergeLogs(emptyLog(), { lines: [line(1), line(2), line(3)], last: 3 }, 2);
  assert.deepEqual(capped.lines.map((l) => l.seq), [2, 3]);
  assert.equal(isNearBottom({ scrollTop: 480, scrollHeight: 1000, clientHeight: 500 }), true);
  assert.equal(isNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 }), false);
});
