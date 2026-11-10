// «📋 Mos yuklar» dagi yo'nalish tanlash (route.js): tugmalar, strelkalar, saqlash
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANY, MAP_BUTTON, applyRoute, chosenText, fromStep, toStep } from "../src/route.js";
// Joylarning o'zi (va web uchun sonlar) — packages/shared/test/route.test.js

const DRIVER = {
  vehicle: { truckClass: "isuzu", bodyType: "tent", capacityKg: 5000, body: null, loadingSides: [] },
  fromAreas: [],
  toAreas: [],
  domestic: true,
  international: false,
  routeAt: null,
};
const flat = (keyboard) => keyboard.flat();

test("«Qayerdan?»: joy nomidan keyin «→» (olib ketish), son yo'q, «Hamma joydan» yo'q, hozirgi tanlov ✅, «🔁» yo'q", () => {
  const { text, keyboard } = fromStep({ profile: DRIVER, scope: "qoshni" });
  assert.match(text, /Qayerdan yuk olasiz/);
  assert.doesNotMatch(text, /Hozirgi yo'nalish|Qavs ichida/);
  const buttons = flat(keyboard);
  assert.ok(buttons.length > 0 && buttons.every((b) => Buffer.byteLength(b.data) <= 64));
  assert.equal(buttons.find((b) => b.data === "mr:f:andijon").text, "Andijon vil. →");
  assert.equal(buttons.find((b) => b.data === "mr:f:toshkent_sh").text, "Toshkent shahri →");
  // «Hamma joydan» yo'q (Azimjon, 2026-11-10: yuk bir vaqtda hamma joyda bo'lmaydi)
  assert.ok(!buttons.some((b) => /Hamma joy/.test(b.text) || b.data === "mr:f:*"));
  assert.ok(!buttons.some((b) => b.webApp), "https manzil berilmasa — xarita tugmasi yo'q");
  assert.ok(!buttons.some((b) => /\(\d+\)/.test(b.text)), "qavs ichida yuklar soni yo'q");
  assert.ok(!buttons.some((b) => b.text.startsWith("✅")));

  // Ikkinchi marta: «🔁 Andijon → istalgan joy» tugmasi YO'Q (uni «Andijon» deb bosib, «Qayerga?» so'ralmay qolardi) —
  // har bir joy «Qayerga?» ga olib boradi, hozirgisi ✅ bilan, yo'nalish matnda
  const chosen = applyRoute(DRIVER, "andijon", ANY, 123);
  assert.deepEqual([chosen.fromAreas, chosen.toAreas, chosen.routeAt], [["andijon"], [], 123]);
  const step = fromStep({ profile: chosen, scope: "qoshni" });
  assert.match(step.text, /Hozirgi yo'nalish: <b>Andijon vil\. → istalgan joy<\/b>/);
  const again = flat(step.keyboard);
  assert.ok(again.every((b) => b.data.startsWith("mr:f:")), "hamma tugma — «Qayerdan» tanlovi");
  assert.equal(again.find((b) => b.data === "mr:f:andijon").text, "✅ Andijon vil. →");
  assert.deepEqual(again.filter((b) => b.text.startsWith("✅")).length, 1);
  // Eski «hamma joydan» yo'nalishi — hech qaysi tugma ✅ emas, matnda baribir ko'rinadi
  const anyStep = fromStep({ profile: applyRoute(DRIVER, ANY, "toshkent_sh", 1), scope: "qoshni" });
  assert.ok(!flat(anyStep.keyboard).some((b) => b.text.startsWith("✅")));
  assert.match(anyStep.text, /Hozirgi yo'nalish: <b>hamma joy → Toshkent shahri/);

  const intl = flat(fromStep({ profile: { ...DRIVER, international: true }, scope: "qoshni" }).keyboard);
  assert.equal(intl.find((b) => b.data === "mr:f:Qozog'iston").text, "🌍 Qozog'iston →");
});

test("«Qayerga?»: Azimjon matni, joy nomidan oldin «→» (olib kelish), «Istalgan joyga», «Orqaga»; tanlangach matn", () => {
  const { text, keyboard } = toStep({ profile: DRIVER, scope: "qoshni", from: "andijon" });
  assert.equal(text, "📍 <b>Qayerga yuk olib bormoqchisiz?</b> 🏁");
  const buttons = flat(keyboard);
  assert.ok(buttons.every((b) => Buffer.byteLength(b.data) <= 64));
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:namangan").text, "→ Namangan vil.");
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:toshkent_sh").text, "→ Toshkent shahri");
  assert.equal(buttons.find((b) => b.data === "mr:t:andijon:*").text, "→ 🌐 Istalgan joyga");
  assert.equal(buttons.at(-1).text, "⬅️ Orqaga");
  assert.equal(buttons.at(-1).data, "mr:back");
  assert.ok(!buttons.some((b) => /\(\d+\)/.test(b.text)), "qavs ichida yuklar soni yo'q");
  assert.ok(!buttons.some((b) => b.text.startsWith("✅")));
  assert.equal(toStep({ profile: DRIVER, scope: "qoshni", from: ANY }).text, text, "«Hamma joydan» tanlansa ham — shu savol");

  // Avvalgi yo'nalish Andijon → istalgan joy: Andijon yana tanlansa «Istalgan joyga» ✅, boshqa joydan — belgisiz
  const chosen = applyRoute(DRIVER, "andijon", ANY, 7);
  const same = flat(toStep({ profile: chosen, scope: "qoshni", from: "andijon" }).keyboard);
  assert.equal(same.find((b) => b.data === "mr:t:andijon:*").text, "✅ → 🌐 Istalgan joyga");
  assert.equal(same.filter((b) => b.text.startsWith("✅")).length, 1);
  const other = flat(toStep({ profile: chosen, scope: "qoshni", from: "namangan" }).keyboard);
  assert.ok(!other.some((b) => b.text.startsWith("✅")));
  const toCity = flat(toStep({ profile: applyRoute(DRIVER, "andijon", "toshkent_sh", 8), scope: "qoshni", from: "andijon" }).keyboard);
  assert.equal(toCity.find((b) => b.data === "mr:t:andijon:toshkent_sh").text, "✅ → Toshkent shahri");

  const any = applyRoute(DRIVER, ANY, ANY, 5);
  assert.deepEqual([any.fromAreas, any.toAreas, any.routeAt], [[], [], 5]);
  assert.match(chosenText(applyRoute(DRIVER, "andijon", "toshkent_sh")), /Yo'nalish: <b>Andijon vil\. → Toshkent shahri<\/b>[\s\S]*Mos yuklar/);
});

test("«🗺 Xaritadan tanlash»: ikkala qadamda ham web xaritasi tugmasi (Mini App), «Qayerga?» da — «Orqaga» dan oldin", () => {
  const url = "https://yuk.example/?v=yonalish&r=haydovchi&s=qoshni";
  const from = fromStep({ profile: DRIVER, scope: "qoshni", mapUrl: url }).keyboard;
  assert.deepEqual(from.at(-1), [{ text: MAP_BUTTON, webApp: url }]);
  assert.equal(MAP_BUTTON, "🗺 Xaritadan tanlash");
  assert.ok(flat(from).filter((b) => !b.webApp).every((b) => b.data.startsWith("mr:f:")));

  const to = toStep({ profile: DRIVER, scope: "qoshni", from: "andijon", mapUrl: `${url}&f=andijon` }).keyboard;
  assert.deepEqual(to.at(-2), [{ text: MAP_BUTTON, webApp: `${url}&f=andijon` }]);
  assert.equal(to.at(-1)[0].data, "mr:back");
  assert.ok(flat(to).filter((b) => !b.webApp).every((b) => Buffer.byteLength(b.data) <= 64));
});
