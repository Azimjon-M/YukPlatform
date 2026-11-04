import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRIES, authErrorAction } from "../src/authErrors.js";

const telegramError = (errorMessage, extra = {}) => Object.assign(new Error(errorMessage), { errorMessage, ...extra });

test("noto'g'ri parol/kod — qayta so'raladi, lekin cheksiz emas", () => {
  assert.equal(authErrorAction(telegramError("PASSWORD_HASH_INVALID"), 0).retry, true);
  assert.equal(authErrorAction(telegramError("PHONE_CODE_INVALID"), MAX_RETRIES - 1).retry, true);
  const last = authErrorAction(telegramError("PASSWORD_HASH_INVALID"), MAX_RETRIES);
  assert.equal(last.retry, false);
  assert.match(last.message, /Urinishlar tugadi/);
});

test("dastur ichidagi xato (TypeError) — darhol to'xtaydi", () => {
  const action = authErrorAction(new TypeError("Cannot read properties of undefined (reading 'bind')"));
  assert.equal(action.retry, false);
});

test("FLOOD_WAIT — kutish vaqti daqiqada", () => {
  const action = authErrorAction(telegramError("FLOOD", { seconds: 600 }));
  assert.equal(action.retry, false);
  assert.match(action.message, /10 daqiqa/);
});

test("eskirgan kod va GramJS'ning o'z xabarlari tushunarli matnga aylanadi", () => {
  assert.match(authErrorAction(telegramError("PHONE_CODE_EXPIRED")).message, /eskirdi/);
  assert.match(authErrorAction(new Error("Code is empty")).message, /Kod kiritilmadi/);
  assert.match(authErrorAction(telegramError("SOMETHING_NEW")).message, /Telegram xatosi: SOMETHING_NEW/);
});
