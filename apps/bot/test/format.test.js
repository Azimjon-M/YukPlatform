import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatLoad, placeText, priceText, weightText } from "../src/format.js";

const LOAD = {
  fromCity: "Toshkent", fromPlace: "Chilonzor", fromRegion: "toshkent_sh", fromCountry: "O'zbekiston",
  toCity: "Navoiy", toPlace: null, toRegion: "navoiy", toCountry: "O'zbekiston",
  cargo: "mebel", weightT: 6, volumeM3: null, pallets: null,
  truckClass: "isuzu", bodyType: "tent", vehicleCount: null, loadingSides: ["ust"], partial: false,
  price: 3800000, priceUnit: "reys", currency: "UZS", payment: "naqd", negotiable: false,
  when: "ertaga", note: null, phones: ["+998901234567"],
};

test("joy nomi: tuman, faqat viloyat, xorij", () => {
  assert.equal(placeText(LOAD, "from"), "Toshkent (Chilonzor)");
  assert.equal(placeText({ fromCity: null, fromRegion: "surxondaryo" }, "from"), "Surxondaryo viloyati");
  assert.equal(placeText({ toCity: "Boku", toRegion: "xorij", toCountry: "Ozarbayjon" }, "to"), "Boku (Ozarbayjon)");
  assert.equal(placeText({ toCity: null, toRegion: "xorij", toCountry: "Germaniya" }, "to"), "Germaniya");
  assert.equal(placeText({}, "to"), "?");
});

test("og'irlik va narx", () => {
  assert.equal(weightText(0.7), "700 kg");
  assert.equal(weightText(7.5), "7,5 t");
  assert.equal(weightText(null), null);
  assert.equal(priceText(LOAD), "3 800 000 so'm · naqd");
  assert.equal(priceText({ price: 200, priceUnit: "kg", currency: "UZS" }), "200 so'm / kilosi");
  assert.equal(priceText({ price: 4900, currency: "USD", priceUnit: "reys" }), "$4 900");
  assert.equal(priceText({ price: null, negotiable: true }), "kelishiladi");
  assert.equal(priceText({ price: null }), "narx yozilmagan");
});

test("to'liq xabar: yo'nalish, mashina, telefon, vaqt va manba", () => {
  const post = { source: "@yuk_markazi_gruupa", link: "https://t.me/yuk_markazi_gruupa/123", postedAt: Date.UTC(2026, 10, 5, 9, 30) };
  const { text, url } = formatLoad(LOAD, post);
  assert.match(text, /<b>Toshkent \(Chilonzor\) → Navoiy<\/b>/);
  assert.match(text, /mebel · 6 t/);
  assert.match(text, /Isuzu · tent · ustidan/);
  assert.match(text, /\+998901234567/);
  assert.match(text, /05\.11 14:30 · @yuk_markazi_gruupa/, "Toshkent vaqti (UTC+5)");
  assert.equal(url, "https://t.me/yuk_markazi_gruupa/123");
});

test("e'londagi matn HTML sifatida buzilmaydi", () => {
  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  const { text } = formatLoad({ ...LOAD, note: "<script>", phones: [] }, {});
  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /telefon yozilmagan/);
});
