import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, readResponse, timeoutError } from "../src/api.js";
import {
  addToJournal,
  describeError,
  entryFromError,
  errorText,
  ignoreIn,
  mergeIgnored,
  mergeJournals,
  recordInto,
  removeFrom,
  reportText,
  unignoreIn,
  unseenCount,
} from "../src/errorInfo.js";
import { routeFor } from "../src/router.js";

const meta = { method: "GET", path: "/api/overview?x=1", durationMs: 1234 };

test("API xatosi turi: timeout, aloqa yo'q, 5xx, 4xx, tushunarsiz javob", () => {
  const kind = (status, text) => {
    try {
      readResponse(status, text, meta);
    } catch (error) {
      return [error.kind, error.method, error.path, error.durationMs];
    }
    return null;
  };
  assert.deepEqual(kind(500, '{"error":"Server xatosi: boom"}'), ["server", "GET", "/api/overview?x=1", 1234]);
  assert.equal(kind(409, '{"error":"Bot terminalda ishlayapti"}')[0], "client");
  assert.equal(kind(502, "<html>Bad gateway</html>")[0], "offline");
  assert.equal(kind(200, "<html>")[0], "invalid");
  const late = timeoutError(meta, 20_000);
  assert.equal(late.kind, "timeout");
  assert.equal(late.message, "Server 20 soniya ichida javob bermadi");
  assert.equal(new ApiError("x", { offline: true }).kind, "offline");
});

test("xato sahifasi matni: har turga o'z sarlavhasi va maslahati", () => {
  const late = describeError(timeoutError(meta, 20_000));
  assert.equal(late.title, "Server javob bermadi");
  assert.match(late.text, /20 s kutildi/);
  assert.deepEqual(late.rows[0], ["So'rov", "GET /api/overview?x=1"]);

  assert.equal(describeError(new ApiError("x", { offline: true })).title, "Server bilan aloqa yo'q");
  assert.equal(describeError(new ApiError("Server xatosi: boom", { status: 500 })).title, "Serverda xato (500)");
  assert.equal(describeError(new ApiError("Manba topilmadi", { status: 404 })).title, "Topilmadi (404)");

  const crash = describeError(new ReferenceError("sourceLink is not defined"), { kind: "crash", componentStack: "\n    at SourceRow" });
  assert.equal(crash.title, "Sahifada xato yuz berdi");
  assert.equal(crash.text, "ReferenceError: sourceLink is not defined");
  assert.match(crash.stack, /Komponentlar:\n {4}at SourceRow/);

  const lost = describeError(null, { kind: "notfound", path: "/admin/yoq" });
  assert.match(lost.text, /«\/admin\/yoq»/);
  assert.equal(errorText("oddiy matn"), "oddiy matn");
});

test("brauzer jurnali: bir xil xato bitta qatorda, raqamlari boshqa bo'lsa ham", () => {
  const first = entryFromError(new ApiError("Server 20 soniya ichida javob bermadi", { kind: "timeout", ...meta }), { now: 1000, page: "/admin/" });
  assert.equal(first.where, "GET /api/overview", "so'rov qatorisiz");
  assert.equal(first.level, "error");
  assert.match(first.details, /Kutildi: 1\.2 s/);
  let list = addToJournal([], first);
  const again = entryFromError(new ApiError("Server 20 soniya ichida javob bermadi", { kind: "timeout", ...meta, path: "/api/overview?x=2" }), { now: 5000 });
  list = addToJournal(list, again);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].count, list[0].first, list[0].last], [2, 1000, 5000]);

  const refused = entryFromError(new ApiError("Bot terminalda ishlayapti", { status: 409, method: "POST", path: "/api/processes/bot/start" }), { now: 6000 });
  assert.equal(refused.level, "warning", "4xx — ogohlantirish");
  list = addToJournal(list, refused);
  assert.equal(list[0].text, "Bot terminalda ishlayapti", "eng yangisi birinchi");

  const crash = entryFromError(new TypeError("x is not a function"), { kind: "crash", now: 7000, page: "/admin/manbalar" });
  assert.equal(crash.where, "/admin/manbalar");
  assert.match(crash.details, /TypeError/);
  assert.equal(addToJournal(list, crash, 2).length, 2, "chegara");
});

test("server va brauzer yozuvlari birga; ko'rilmagan xatolar soni; nusxa matni", () => {
  const local = [{ id: "b1", source: "browser", level: "error", kind: "timeout", text: "javob bermadi", first: 10, last: 30, count: 1 }];
  const server = [{ id: 1, source: "bot", level: "warning", kind: "ai", text: "Model band (503)", first: 5, last: 40, count: 3 }];
  const all = mergeJournals(local, server);
  assert.deepEqual(all.map((e) => e.id), ["s1", "b1"]);
  assert.deepEqual(all.map((e) => e.serverId), [1, undefined], "server yozuvining o'z id'si — o'chirish so'rovi uchun");
  assert.equal(unseenCount([10, 20, 30], 15), 2);
  const text = reportText(all);
  assert.match(text, /\[OGOHLANTIRISH\] Bot · AI · 3 marta/);
  assert.match(text, /\[XATO\] Boshqaruv markazi \(brauzer\) · Javob kelmadi \(timeout\)/);
});

test("brauzer jurnali: «O'chirish» — yana chiqsa qaytadi; «E'tiborsiz qoldirish» — boshqa yozilmaydi, sanaladi; «Qaytarish»", () => {
  const timeout = (now, path = "/api/overview") => entryFromError(new ApiError("Server 20 soniya ichida javob bermadi", { kind: "timeout", ...meta, path }), { now });
  const crash = entryFromError(new TypeError("x is not a function"), { kind: "crash", now: 2000, page: "/admin/manbalar" });
  let state = { journal: [], ignored: [] };
  state = recordInto(state, timeout(1000));
  state = recordInto(state, crash);
  assert.equal(state.journal.length, 2);

  // O'chirish: faqat shu yozuv; o'sha xato yana chiqsa — yangi yozuv
  const removed = removeFrom(state, state.journal.find((e) => e.kind === "timeout").id);
  assert.deepEqual(removed.journal.map((e) => e.kind), ["crash"]);
  assert.equal(recordInto(removed, timeout(3000)).journal.length, 2, "o'chirilgani yana chiqsa — qaytadi");

  // E'tiborsiz: yozuv o'chadi, o'sha xato (raqami boshqa bo'lsa ham) jurnalga tushmaydi, qoidada sanaladi
  state = ignoreIn(state, state.journal.find((e) => e.kind === "timeout").id, 2500);
  assert.deepEqual(state.journal.map((e) => e.kind), ["crash"]);
  assert.deepEqual([state.ignored.length, state.ignored[0].at, state.ignored[0].hits], [1, 2500, 0]);
  state = recordInto(state, timeout(4000, "/api/overview?x=5"));
  state = recordInto(state, timeout(5000));
  assert.deepEqual(state.journal.map((e) => e.kind), ["crash"], "e'tiborsiz xato ko'rinmaydi");
  assert.deepEqual([state.ignored[0].hits, state.ignored[0].lastHit], [2, 5000]);
  assert.equal(recordInto(state, entryFromError(new Error("boshqa xato"), { now: 6000 })).journal.length, 2, "boshqa xatolar avvalgidek");
  assert.equal(ignoreIn(state, "yoq"), state, "topilmagan id — o'zgarmaydi");

  // Qaytarish: yana chiqsa — jurnalda
  state = unignoreIn(state, state.ignored[0].key);
  assert.equal(state.ignored.length, 0);
  assert.equal(recordInto(state, timeout(7000)).journal.length, 2);

  // Brauzer va server qoidalari birga, oxirgi qoldirilgani birinchi
  const merged = mergeIgnored([{ key: "b", at: 10 }], [{ key: "s", at: 20 }]);
  assert.deepEqual(merged.map((r) => [r.key, r.fromServer]), [["s", true], ["b", false]]);
});

test("router: «Xatolar» bo'limi", () => {
  assert.equal(routeFor("/admin/xatolar").id, "errors");
});
