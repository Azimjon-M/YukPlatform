// Mini App so'rovlari: server bir necha soniya javob bermasa (qayta ishga tushirilyapti) — o'zi qayta uradi
import { test } from "node:test";
import assert from "node:assert/strict";
// api.js brauzer muhitini kutadi (window.Telegram, localStorage) — testda soxtasi
globalThis.window ??= { location: { search: "", hash: "", pathname: "/" }, history: { replaceState() {} } };
const { request } = await import("../src/api.js");

function fakeFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    const next = answers.shift();
    if (next === "network") throw new TypeError("Failed to fetch");
    return { ok: next.status < 400, status: next.status, json: async () => (next.json === undefined ? Promise.reject(new Error("html")) : next.json) };
  };
  return calls;
}
const fast = { retryDelays: [1, 1, 1, 1], token: null };

test("tunnel/server o'chiq (530, 502) — qayta uradi va javobni qaytaradi (POST ham — so'rov yetib bormagan)", async () => {
  const calls = fakeFetch([{ status: 530 }, { status: 502 }, { status: 200, json: { ok: true } }]);
  assert.deepEqual(await request("POST", "/pub/x", { ...fast, body: {} }), { ok: true });
  assert.equal(calls.length, 3);
});

test("tarmoq xatosi: PUT/GET — qayta uradi; POST — yo'q (yetib borgan bo'lishi mumkin, ikki marta yozilmasin)", async () => {
  let calls = fakeFetch(["network", { status: 200, json: { saved: 1 } }]);
  assert.deepEqual(await request("PUT", "/pub/me/profile", { ...fast, body: {} }), { saved: 1 });
  assert.equal(calls.length, 2);
  calls = fakeFetch(["network", { status: 200, json: {} }]);
  await assert.rejects(request("POST", "/pub/loads", { ...fast, body: {} }), (e) => e.code === "offline");
  assert.equal(calls.length, 1);
});

test("server javob bergan xato (400) va uzoq o'chiqlik — qayta urinmaydi / ~20 s dan keyin to'xtaydi", async () => {
  let calls = fakeFetch([{ status: 400, json: { error: "Noto'g'ri" } }]);
  await assert.rejects(request("PUT", "/pub/me/profile", { ...fast, body: {} }), (e) => e.status === 400);
  assert.equal(calls.length, 1);
  calls = fakeFetch(Array.from({ length: 10 }, () => ({ status: 530 })));
  await assert.rejects(request("GET", "/pub/me", fast), (e) => e.code === "offline");
  assert.equal(calls.length, 5, "1 + 4 qayta urinish");
});
