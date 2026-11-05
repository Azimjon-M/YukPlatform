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

test("terminalda ishlayotgan nusxa: external, yoqib bo'lmaydi", () => {
  const m = manager("ok", { readLock: () => ({ pid: 4242, alive: true }) });
  assert.deepEqual([m.get("fake").status, m.get("fake").pid], ["external", 4242]);
  assert.throws(() => m.start("fake"), (e) => e.status === 409 && e.message.includes("4242"));
  assert.throws(() => m.get("yoq"), (e) => e.status === 404);
});
