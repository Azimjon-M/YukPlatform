// «📋 Mos yuklar» dagi yo'nalish tanlash (route.js): tugmalar, sonlar, saqlash
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANY, applyRoute, chosenText, fromStep, toStep } from "../src/route.js";
// Joylar va sonlarning o'zi — packages/shared/test/route.test.js

const DRIVER = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: null, loadingSides: [] },
  fromAreas: [],
  toAreas: [],
  domestic: true,
  international: false,
  routeAt: null,
};
const row = (load) => ({ load: { loadingSides: [], phones: ["+998900000001"], ...load } });
const ROWS = [
  row({ fromCity: "Andijon", fromRegion: "andijon", toCity: "Toshkent", toRegion: "toshkent_sh", weightT: 3 }),
  row({ fromCity: "Andijon", fromRegion: "andijon", toCity: "Namangan", toRegion: "namangan", weightT: 4 }),
  row({ fromCity: "Andijon", fromRegion: "andijon", toCity: "Buxoro", toRegion: "buxoro", weightT: 20 }), // Isuzuga sig'maydi
  row({ fromCity: "Olmaota", fromRegion: "xorij", fromCountry: "Qozog'iston", toCity: "Toshkent", toRegion: "toshkent_sh", weightT: 2 }),
];
const flat = (keyboard) => keyboard.flat();

test("«Qayerdan?»: har joyda mos yuklar soni (sig'maydigani sanalmaydi), «🔁» — faqat tanlangan bo'lsa", () => {
  const { text, keyboard } = fromStep({ profile: DRIVER, scope: "qoshni", rows: ROWS });
  assert.match(text, /Qayerdan yuk olasiz/);
  const buttons = flat(keyboard);
  assert.ok(buttons.length > 0 && buttons.every((b) => Buffer.byteLength(b.data) <= 64));
  assert.equal(buttons.find((b) => b.data === "mr:f:andijon").text, "Andijon vil. (2)");
  assert.equal(buttons.find((b) => b.data === "mr:f:navoiy").text, "Navoiy vil.", "yuk yo'q — son yozilmaydi");
  assert.equal(buttons.at(-1).text, "🌐 Hamma joydan (2)", "Qozog'iston yuki — faqat O'zbekiston haydovchisiga emas");
  assert.ok(!buttons.some((b) => b.data === "mr:last"));

  const chosen = applyRoute(DRIVER, "andijon", ANY, 123);
  assert.deepEqual([chosen.fromAreas, chosen.toAreas, chosen.routeAt], [["andijon"], [], 123]);
  const again = flat(fromStep({ profile: chosen, scope: "qoshni", rows: ROWS }).keyboard);
  assert.deepEqual(again[0], { text: "🔁 Andijon vil. → istalgan joy", data: "mr:last" });

  const intl = flat(fromStep({ profile: { ...DRIVER, international: true }, scope: "qoshni", rows: ROWS }).keyboard);
  assert.equal(intl.find((b) => b.data === "mr:f:Qozog'iston").text, "🌍 Qozog'iston (1)");
});

test("«Qayerga?»: tanlangan joydan har joyga sonlar, «Istalgan joyga», «Orqaga»; tanlangach matn", () => {
  const { text, keyboard } = toStep({ profile: DRIVER, scope: "qoshni", rows: ROWS, from: "andijon" });
  assert.match(text, /Qayerdan: <b>Andijon vil\.<\/b>[\s\S]*Qayerga borasiz/);
  const buttons = flat(keyboard);
  assert.ok(buttons.every((b) => Buffer.byteLength(b.data) <= 64));
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:namangan").text, "Namangan vil. (1)");
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:toshkent_sh").text, "Toshkent shahri (1)");
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:*").text, "🌐 Istalgan joyga (2)");
  assert.equal(buttons.at(-1).data, "mr:back");
  assert.match(toStep({ profile: DRIVER, scope: "qoshni", rows: ROWS, from: ANY }).text, /Qayerdan: <b>hamma joy/);

  const any = applyRoute(DRIVER, ANY, ANY, 5);
  assert.deepEqual([any.fromAreas, any.toAreas, any.routeAt], [[], [], 5]);
  assert.match(chosenText(applyRoute(DRIVER, "andijon", "toshkent_sh")), /Yo'nalish: <b>Andijon vil\. → Toshkent shahri<\/b>[\s\S]*Mos yuklar/);
});
