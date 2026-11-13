import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createProcessManager } from "../src/processes.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/child.js", import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("kutish vaqti tugadi");
    await wait(20);
  }
}

function manager(mode, options = {}) {
  const definitions = { fake: { title: "Soxta", cwd: process.cwd(), module: FIXTURE, args: [mode], execArgv: [] } };
  return createProcessManager({ definitions, readLock: () => null, restartDelayMs: 50, stopTimeoutMs: 300, ...options });
}

const texts = (m) => m.logs("fake").lines.map((l) => l.text);

test("yoqish, loglar (bo'lingan qatorlar ham), yumshoq to'xtatish", async () => {
  const seen = [];
  const m = manager("ok", { onLine: (name, line) => seen.push(`${name}:${line.stream}`) });
  assert.equal(m.start("fake").status, "running");
  await until(() => texts(m).includes("ikkinchi qator") && texts(m).includes("ogohlantirish"));
  assert.ok(texts(m).includes("salom dunyo"), "bo'lib kelgan qator birlashadi");
  assert.equal(m.logs("fake").lines.find((l) => l.text === "ogohlantirish").stream, "err");
  const { last } = m.logs("fake");
  assert.deepEqual(m.logs("fake", last).lines, [], "after — faqat yangilari");
  const stopped = await m.stop("fake");
  assert.equal(stopped.status, "stopped");
  assert.ok(texts(m).includes("to'xtayapman"), "stop xabarini oldi");
  assert.ok(seen.includes("fake:out") && seen.includes("fake:system"));
});

test("stop'ga javob bermasa — majburan", async () => {
  const m = manager("stubborn");
  m.start("fake");
  await until(() => texts(m).includes("ikkinchi qator"));
  assert.equal((await m.stop("fake")).status, "stopped");
  assert.ok(texts(m).some((t) => t.includes("majburan")));
});

test("kutilmaganda to'xtasa qayta ishga tushadi, ko'p marta bo'lsa — to'xtaydi", async () => {
  const m = manager("crash");
  m.start("fake");
  await until(() => texts(m).some((t) => t.includes("qayta ishga tushmaydi")), 8000);
  const state = m.get("fake");
  assert.equal(state.status, "crashed");
  assert.equal(state.crashes, 6);
  assert.equal(state.autoRestart, false);
  assert.equal((await m.stop("fake")).status, "stopped", "qo'lda o'chirsa — holat tozalanadi");
});

test("EXIT_CONFIG (78) bilan chiqsa — qayta yoqilmaydi, holati «stopped», qo'lda yana yoqsa bo'ladi", async () => {
  const m = manager("config");
  m.start("fake");
  await until(() => texts(m).some((t) => t.includes("qayta yoqilmaydi")));
  await wait(200); // restartDelayMs = 50: qayta yoqilganida shu vaqt ichida ko'rinardi
  const state = m.get("fake");
  assert.deepEqual([state.status, state.exitCode, state.autoRestart, state.crashes], ["stopped", 78, false, 0]);
  assert.equal(texts(m).filter((t) => t.startsWith("▶ ishga tushdi")).length, 1, "bir marta yoqildi");
  assert.equal(m.start("fake").status, "running", "tuzatilgandan keyin qo'lda yoqiladi");
  await until(() => texts(m).filter((t) => t.includes("qayta yoqilmaydi")).length === 2);
});

test("terminalda ishlayotgan nusxa: external, yoqib bo'lmaydi", () => {
  const m = manager("ok", { readLock: () => ({ pid: 4242, alive: true }) });
  assert.deepEqual([m.get("fake").status, m.get("fake").pid], ["external", 4242]);
  assert.throws(() => m.start("fake"), (e) => e.status === 409 && e.message.includes("4242"));
  assert.throws(() => m.get("yoq"), (e) => e.status === 404);
});

// 2026-11-09: AUTOSTART paytida bot «terminalda» deb ko'rindi va hech kim uni yoqmadi. ensure — kutib, o'zi yoqadi
test("ensure: terminaldagi nusxa yopilishi bilan o'zi yoqadi", async () => {
  let lock = { pid: 4242, alive: true };
  const m = manager("ok", { readLock: () => lock, watchMs: 20 });
  const waiting = m.ensure("fake");
  assert.deepEqual([waiting.status, waiting.pid, waiting.autoRestart], ["external", 4242, true]);
  await wait(80);
  assert.equal(m.get("fake").status, "external", "tirik nusxa bor ekan — tegmaydi");
  lock = null;
  await until(() => m.get("fake").status === "running");
  assert.ok(texts(m).some((t) => t.includes("endi shu yerdan ishlaydi")));
  await m.shutdown();
});

test("ensure: eskirgan fayl (PID boshqa jarayonniki) — darhol yoqadi; o'chirilgan bo'lsa — kutmaydi", async () => {
  const m = manager("ok", { readLock: () => ({ pid: 6200, alive: false, stale: true }), watchMs: 20 });
  assert.equal(m.ensure("fake").status, "running");
  assert.ok(texts(m).some((t) => t.includes("eskirgan")));
  await m.stop("fake");
  await wait(80);
  assert.equal(m.get("fake").status, "stopped", "qo'lda o'chirilgani o'zi yonmaydi");
});

test("watch: tirik PID'li eskirgan fayl — uyqudan uyg'onish bo'lishi mumkin, biroz kutadi", () => {
  let lock = { pid: 4242, alive: true };
  const m = manager("ok", { readLock: () => lock, watchMs: 60_000, staleGraceMs: 1000 });
  m.ensure("fake");
  lock = { pid: 4242, alive: false, stale: true };
  m.watch(10_000);
  m.watch(10_500);
  assert.equal(m.get("fake").status, "stopped");
  lock = { pid: 4242, alive: true };
  m.watch(10_900);
  lock = { pid: 4242, alive: false, stale: true };
  m.watch(11_200);
  assert.equal(m.get("fake").status, "stopped", "orada yangilangan — hisob qaytadan");
  m.watch(12_300);
  assert.equal(m.get("fake").status, "running");
  return m.shutdown();
});

test("majburan to'xtatilgan bolaning PID fayli o'chiriladi", async () => {
  const removed = [];
  const m = manager("stubborn", { removeLock: (name, { pid }) => removed.push([name, pid]) });
  const { pid } = m.start("fake");
  await until(() => texts(m).includes("ikkinchi qator"));
  await m.stop("fake");
  assert.deepEqual(removed, [["fake", pid]]);
});
