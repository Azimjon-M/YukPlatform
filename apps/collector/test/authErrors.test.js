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

test("again: qaytadan boshlash yo'li matnga qo'yiladi (Mini App'da — tugma, terminalda — buyruq)", () => {
  const again = "«➕ Akkaunt qo'shish» ni qayta bosing";
  assert.equal(authErrorAction(telegramError("PHONE_CODE_EXPIRED"), 0, { again }).message, `Kod eskirdi. Qaytadan boshlang: ${again}`);
  assert.match(authErrorAction(telegramError("PHONE_CODE_EXPIRED")).message, /npm run tg:login/);
  assert.ok(authErrorAction(telegramError("PHONE_CODE_INVALID"), MAX_RETRIES, { again }).message.endsWith(again));
  assert.match(authErrorAction(telegramError("SIGN_UP_REQUIRED")).message, /akkaunt yo'q/);
});

test("eskirgan kod va GramJS'ning o'z xabarlari tushunarli matnga aylanadi", () => {
  assert.match(authErrorAction(telegramError("PHONE_CODE_EXPIRED")).message, /eskirdi/);
  assert.match(authErrorAction(new Error("Code is empty")).message, /Kod kiritilmadi/);
  assert.match(authErrorAction(telegramError("SOMETHING_NEW")).message, /Telegram xatosi: SOMETHING_NEW/);
});
