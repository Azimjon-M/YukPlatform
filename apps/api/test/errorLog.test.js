import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "@yuk/store";
import { createApp } from "../src/app.js";
import { classifyLine, createErrorLog, errorKey, shapeOf } from "../src/errorLog.js";

const out = (text) => ({ stream: "out", text });

test("log qatori: xato, ogohlantirish yoki oddiy qator", () => {
  assert.deepEqual(classifyLine(out("[13:56:09] #67044 @TutGruz: 1/1 yangi yuk, 0 ta haydovchiga")), null);
  assert.deepEqual(classifyLine(out("[13:56:12] AI: 10 ta ulanish, bir vaqtda 8 tagacha so'rov")), null);
  assert.deepEqual(classifyLine(out("AI [.env kaliti · gemini-x]: 10 ta e'lon bitta so'rovda")), null, "oddiy AI ishi");
  assert.deepEqual(classifyLine(out("5 ta e'lon eskirgan (joylanganiga 3 soat) — AI'ga yuborilmadi")), null, "qoida, xato emas");

  const busy = classifyLine(out("[13:50:01] AI [.env kaliti · gemini-x]: Model hozir band (503). — 10 ta e'lon boshqa AI'ga o'tdi"));
  assert.deepEqual([busy.level, busy.kind], ["warning", "ai"]);
  assert.ok(!busy.text.startsWith("["), "boshidagi vaqt olib tashlanadi");
  const slow = classifyLine(out("AI [1pro · qwen]: 1pro.uz (Qwen) 120 s ichida javob bermadi — 6 ta e'lon boshqa AI'ga o'tdi"));
  assert.deepEqual([slow.level, slow.kind], ["warning", "timeout"]);
  assert.equal(classifyLine(out("AI vaqtincha ishlamayapti: kunlik limit — 30 daq kutadi")).level, "error");

  assert.deepEqual(classifyLine(out("Foydalanuvchiga yuborilmadi (123): Forbidden: bot was blocked")).level, "error");
  assert.deepEqual(classifyLine(out("@TutGruz: o'qib bo'lmadi — 90 s ichida javob kelmadi")).kind, "timeout");
  assert.equal(classifyLine(out("⚠️  APK_FILE topilmadi: x.apk")).level, "warning");
  assert.equal(classifyLine(out("2026/11/09 14:00:00 [error] 12#34: *1 connect() failed")).level, "error");

  assert.deepEqual(classifyLine({ stream: "system", text: "✖ kutilmaganda to'xtadi (1)" }), { level: "error", kind: "crash", text: "✖ kutilmaganda to'xtadi (1)" });
  assert.equal(classifyLine({ stream: "system", text: "▶ ishga tushdi (PID 5)" }), null);
  assert.equal(classifyLine({ stream: "err", text: "TypeError: x is not a function" }).level, "error");
});

test("bir xil xato (raqamlari boshqa) — bitta yozuv, necha marta va oxirgi vaqti bilan", () => {
  let time = 1000;
  const log = createErrorLog({ now: () => time });
  assert.equal(shapeOf("#67044: xato — 503"), shapeOf("#67050: xato — 502"));
  log.fromProcessLine("bot", out("#67044: yuborishda xato — 503"));
  time = 5000;
  log.fromProcessLine("bot", out("#67050: yuborishda xato — 502"));
  log.fromProcessLine("collector", out("@a: o'qib bo'lmadi — timeout"));
  const [last, first] = log.list();
  assert.equal(last.source, "collector", "eng yangisi birinchi");
  assert.deepEqual([first.count, first.first, first.last, first.text], [2, 1000, 5000, "#67050: yuborishda xato — 502"]);
  assert.deepEqual(log.summary(), { errors: [5000, 5000], warnings: [] });
  const before = log.seq();
  log.clear();
  assert.equal(log.list().length, 0);
  assert.ok(log.seq() > before, "tozalash ham jonli yangilanadi");
});

test("stderr'dagi stack trace — bitta xato, xabari Error qatoridan", () => {
  const log = createErrorLog({ now: () => 0 });
  const err = (text, time) => log.fromProcessLine("bot", { stream: "err", text, time });
  err("file:///D:/x/bot.js:12", 100);
  err("    throw new TypeError('yo'q');", 150);
  err("TypeError: sourcePath is not defined", 200);
  err("    at run (file:///D:/x/bot.js:12:5)", 250);
  err("Node.js v24.14.1", 300);
  err("boshqa xato", 5000); // bir soniyadan keyin — yangi yozuv
  const items = log.list();
  assert.equal(items.length, 2);
  const crash = items[1];
  assert.equal(crash.text, "TypeError: sourcePath is not defined");
  assert.match(crash.details, /at run/);
});

test("«O'chirish» — faqat shu yozuv (yana chiqsa qaytadi); «E'tiborsiz qoldirish» — boshqa ko'rsatilmaydi, sanaladi, saqlanadi", () => {
  let t = 1000;
  const saved = [];
  const log = createErrorLog({ now: () => t, onIgnoredChange: (rules) => saved.push(rules) });
  const busy = log.add({ source: "bot", level: "warning", kind: "ai", text: "AI [kalit · model]: Model band (503)" });
  const other = log.add({ source: "collector", text: "@TutGruz o'qilmadi: TIMEOUT" });
  const seq = log.seq();

  assert.equal(log.remove(other.id), true);
  assert.equal(log.remove(other.id), false, "ikkinchi marta — allaqachon yo'q");
  assert.ok(log.seq() > seq, "sahifa jonli yangilanadi");
  log.add({ source: "collector", text: "@TutGruz o'qilmadi: TIMEOUT" });
  assert.equal(log.list().filter((e) => e.source === "collector").length, 1, "o'chirilgani yana chiqsa — qaytadi");

  t = 2000;
  const rule = log.ignore(busy.id);
  assert.deepEqual([rule.key, rule.at, rule.text], [errorKey({ source: "bot", level: "warning", text: busy.text }), 2000, busy.text]);
  assert.ok(!log.list().some((e) => e.source === "bot"));
  assert.deepEqual(saved.at(-1), [{ key: rule.key, source: "bot", level: "warning", kind: "ai", text: busy.text, at: 2000 }], "bazaga — hits'siz");
  t = 3000;
  assert.equal(log.add({ source: "bot", level: "warning", kind: "ai", text: "AI [kalit · model]: Model band (504)" }), null, "raqami boshqa — o'sha xato");
  assert.ok(!log.list().some((e) => e.source === "bot"));
  assert.equal(log.summary().warnings.length, 0, "yon paneldagi songa ham kirmaydi");
  assert.deepEqual([log.ignoredList()[0].hits, log.ignoredList()[0].lastHit], [1, 3000]);
  assert.equal(log.ignore(9999), null);

  log.clear();
  assert.equal(log.ignoredList().length, 1, "«Tozalash» qoidalarni o'chirmaydi");

  // Server qayta yoqildi: qoidalar bazadan — o'sha xato yana ko'rsatilmaydi; buzilgan yozuv tashlanadi
  const again = createErrorLog({ ignored: [...saved.at(-1), { nokey: 1 }, null] });
  assert.equal(again.add({ source: "bot", level: "warning", text: "AI [kalit · model]: Model band (503)" }), null);
  assert.equal(again.ignoredList().length, 1);
  assert.equal(again.unignore(rule.key), true);
  assert.equal(again.unignore(rule.key), false);
  assert.ok(again.add({ source: "bot", level: "warning", text: "AI [kalit · model]: Model band (503)" }), "qaytarilgach — yana yoziladi");
});

test("e'tiborsiz xatoning stack trace davomi alohida xato bo'lib chiqmaydi", () => {
  let t = 1000;
  const log = createErrorLog({ now: () => t });
  const err = (text) => ({ stream: "err", text, time: t });
  const first = log.fromProcessLine("bot", err("file:///D:/app/bot.js:12"));
  log.ignore(first.id);
  t += 100;
  assert.equal(log.fromProcessLine("bot", err("file:///D:/app/bot.js:12")), null);
  t += 100;
  assert.equal(log.fromProcessLine("bot", err("TypeError: x is not a function")), null);
  t += 100;
  assert.equal(log.fromProcessLine("bot", err("    at run (file:///D:/app/bot.js:12:5)")), null);
  assert.equal(log.list().length, 0);
});

test("eski yozuvlar chegaradan oshsa tushib qoladi", () => {
  const log = createErrorLog({ maxGroups: 2 });
  for (const name of ["a", "b", "c"]) log.add({ source: name, text: "xato" });
  assert.deepEqual(log.list().map((e) => e.source), ["c", "b"]);
});

test("API: 500 xato va sekin javob jurnalga tushadi, GET/DELETE /api/errors", async () => {
  const store = openStore({ file: ":memory:" });
  const errors = createErrorLog();
  const processes = {
    list: () => {
      throw new Error("jarayonlar ro'yxati buzildi");
    },
  };
  const app = createApp({ store, processes, env: {}, errors, slowMs: -1 });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const failed = await fetch(`${base}/api/overview`);
    assert.equal(failed.status, 500);
    await new Promise((r) => setTimeout(r, 20)); // «close» hodisasi javobdan keyin
    const { items } = await fetch(`${base}/api/errors`).then((r) => r.json());
    const server500 = items.find((e) => e.kind === "server");
    assert.equal(server500.source, "api");
    assert.match(server500.text, /GET \/api\/overview: jarayonlar ro'yxati buzildi/);
    assert.match(server500.details, /Error: jarayonlar/);
    assert.ok(items.some((e) => e.kind === "slow" && e.level === "warning"), "slowMs -1 — har javob «sekin»");

    assert.equal((await fetch(`${base}/api/errors`, { method: "DELETE" })).status, 403, "sarlavhasiz o'chirib bo'lmaydi");
    const cleared = await fetch(`${base}/api/errors`, { method: "DELETE", headers: { "x-yuk-admin": "1" } });
    assert.equal(cleared.status, 200);
    assert.equal(errors.list().filter((e) => e.kind === "server").length, 0);

    // Bitta xato: o'chirish, e'tiborsiz qoldirish, qaytarish (sarlavha bilan)
    const admin = { "x-yuk-admin": "1", "content-type": "application/json" };
    const a = errors.add({ source: "bot", text: "Foydalanuvchiga yuborilmadi (7): xato" });
    const b = errors.add({ source: "collector", level: "warning", text: "⚠ FLOOD_WAIT 30 s" });
    assert.equal((await fetch(`${base}/api/errors/${a.id}`, { method: "DELETE" })).status, 403);
    assert.deepEqual(await fetch(`${base}/api/errors/${a.id}`, { method: "DELETE", headers: admin }).then((r) => r.json()), { ok: true, removed: true });
    assert.equal((await fetch(`${base}/api/errors/9999/ignore`, { method: "POST", headers: admin })).status, 404);
    const ignored = await fetch(`${base}/api/errors/${b.id}/ignore`, { method: "POST", headers: admin }).then((r) => r.json());
    assert.equal(ignored.rule.source, "collector");
    const listed = await fetch(`${base}/api/errors`).then((r) => r.json());
    assert.ok(!listed.items.some((e) => e.id === a.id || e.id === b.id));
    assert.deepEqual(listed.ignored.map((r) => r.key), [ignored.rule.key]);
    const body = JSON.stringify({ key: ignored.rule.key });
    assert.equal((await fetch(`${base}/api/errors/unignore`, { method: "POST", headers: admin, body })).status, 200);
    assert.equal((await fetch(`${base}/api/errors/unignore`, { method: "POST", headers: admin, body })).status, 404, "ikkinchi marta — yo'q");
  } finally {
    server.close();
    store.close();
  }
});
