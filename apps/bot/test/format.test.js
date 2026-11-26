import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatLoad, formatTruck, placeText, priceText, weightText } from "../src/format.js";

const LOAD = {
  fromCity: "Toshkent", fromPlace: "Chilonzor", fromRegion: "toshkent_sh", fromCountry: "O'zbekiston",
  toCity: "Navoiy", toPlace: null, toRegion: "navoiy", toCountry: "O'zbekiston",
  cargo: "mebel", weightT: 6, volumeM3: null, pallets: null,
  truckClass: "isuzu", bodyType: "tent", vehicleCount: null, loadingSides: ["ust"], partial: false,
  price: 3800000, priceUnit: "reys", currency: "UZS", payment: "naqd", negotiable: false,
  when: "ertaga", note: null, phones: ["+998901234567"],
};

test("joy nomi: avval viloyat, keyin shahar; tuman, faqat viloyat, xorij", () => {
  const place = (city, region, extra = {}) => placeText({ fromCity: city, fromRegion: region, fromCountry: "O'zbekiston", ...extra }, "from");
  assert.equal(place("Beshariq", "fargona"), "Farg'ona, Beshariq");
  assert.equal(place("Urganch", "xorazm"), "Xorazm, Urganch");
  assert.equal(place("Nukus", "qoraqalpogiston"), "Qoraqalpog'iston, Nukus");
  assert.equal(place("Chirchiq", "toshkent"), "Toshkent vil., Chirchiq");
  assert.equal(place("Toshkent", "toshkent"), "Toshkent vil.");
  assert.equal(place("Samarqand", "samarqand"), "Samarqand", "viloyat markazi takrorlanmaydi");
  assert.equal(place("Farg'ona", "fargona"), "Farg'ona");
  assert.equal(place("Qo'qon", "fargona", { fromPlace: "Uchko'prik" }), "Farg'ona, Qo'qon (Uchko'prik)");
  assert.equal(place("Yangibozor (Xorazm)", "xorazm"), "Xorazm, Yangibozor");
  assert.equal(place("Qayerdir", null), "Qayerdir", "viloyati noma'lum shahar o'zgarmaydi");
  assert.equal(placeText(LOAD, "from"), "Toshkent (Chilonzor)");
  assert.equal(placeText({ fromCity: null, fromRegion: "surxondaryo" }, "from"), "Surxondaryo viloyati");
  assert.equal(placeText({ toCity: "Boku", toRegion: "xorij", toCountry: "Ozarbayjon" }, "to"), "Ozarbayjon, Boku");
  assert.equal(placeText({ toCity: "Kostroma", toRegion: null, toCountry: "Rossiya" }, "to"), "Rossiya, Kostroma");
  assert.equal(placeText({ toCity: null, toRegion: "xorij", toCountry: "Germaniya" }, "to"), "Germaniya");
  assert.equal(placeText({ toCity: null, toRegion: null, toCountry: "O'zbekiston" }, "to"), "O'zbekiston");
  assert.equal(placeText({}, "to"), "?");
});

test("og'irlik va narx", () => {
  assert.equal(weightText(0.7), "700 kg");
  assert.equal(weightText(7.5), "7,5 tonna");
  assert.equal(weightText(null), null);
  assert.equal(priceText(LOAD), "3 800 000 so'm · naqd");
  assert.equal(priceText({ price: 200, priceUnit: "kg", currency: "UZS" }), "200 so'm / kilosi");
  assert.equal(priceText({ price: 4900, currency: "USD", priceUnit: "reys" }), "$4 900");
  assert.equal(priceText({ price: null, negotiable: true }), "kelishiladi");
  assert.equal(priceText({ price: null }), "narx yozilmagan");
});

test("to'liq xabar: yo'nalish, mashina, telefon va asl e'lon vaqti (guruh nomisiz)", () => {
  const post = { source: "@yuk_markazi_gruupa", link: "https://t.me/yuk_markazi_gruupa/123", postedAt: Date.UTC(2026, 10, 5, 9, 30) };
  const { text, url } = formatLoad(LOAD, post);
  assert.match(text, /<b>Toshkent \(Chilonzor\) → Navoiy<\/b>/);
  assert.match(text, /mebel · 6 t/);
  assert.match(text, /Isuzu · tent · ustidan/);
  assert.match(text, /\+998901234567/);
  assert.match(text, /\n📢 E'lon qilingan 🕒 05\.11\.2026 14:30$/, "Toshkent vaqti (UTC+5), oxirgi qator");
  assert.ok(!text.includes("@yuk_markazi_gruupa"), "guruh nomi yozilmaydi (Azimjon, 2026-11-09)");
  assert.ok(!text.includes("href"), "asl e'lon — tugmada, matnda emas");
  assert.equal(url, "https://t.me/yuk_markazi_gruupa/123");
});

test("jo'natuvchining lichkasi: telefondan keyin, vaqtdan oldin; username'siz — qator yo'q", () => {
  const postedAt = Date.UTC(2026, 10, 5, 9, 30);
  const { text } = formatLoad(LOAD, { link: "https://t.me/g/1", postedAt, sender: "ish_beruvchi" });
  assert.match(text, /\+998901234567\n💬 <a href="https:\/\/t\.me\/ish_beruvchi">Lichkasi<\/a>\n📢 E'lon qilingan 🕒/);
  assert.ok(!formatLoad(LOAD, { postedAt }).text.includes("Lichkasi"));
  assert.ok(!formatLoad(LOAD, { postedAt, sender: '"><b>x' }).text.includes("Lichkasi"), "noto'g'ri username");
  const truck = formatTruck({ fromCity: "Toshkent", phones: [] }, { postedAt, sender: "@haydovchi_1" });
  assert.match(truck.text, /💬 <a href="https:\/\/t\.me\/haydovchi_1">Lichkasi<\/a>/);
});

test("e'londagi matn HTML sifatida buzilmaydi", () => {
  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  const { text } = formatLoad({ ...LOAD, note: "<script>", phones: [] }, {});
  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /telefon yozilmagan/);
});

test("ovozli xabar / dumaloq videodan o'girilgan e'lon — belgisi bilan (saralangan ham, tezkor ham)", async () => {
  const { formatLoad, formatRaw, MEDIA_LINE } = await import("../src/format.js");
  const load = { fromCity: "Toshkent", toCity: "Samarqand", phones: ["+998901234567"] };
  assert.ok(formatLoad(load, { media: "voice", postedAt: Date.UTC(2026, 10, 16, 9) }).text.includes(MEDIA_LINE.voice));
  assert.ok(formatRaw({ text: "Toshkentdan Samarqandga yuk bor", media: "round" }).text.includes(MEDIA_LINE.round));
  assert.ok(!formatLoad(load, {}).text.includes("matnga o'girildi"));
});

test("raqamsiz ovozli e'lon — «xabarni guruhda tinglang»", async () => {
  const { formatLoad, VOICE_NO_PHONE } = await import("../src/format.js");
  const load = { fromCity: "Toshkent", toCity: "Samarqand", phones: [] };
  assert.ok(formatLoad(load, { media: "voice", link: "https://t.me/g/1" }).text.includes(VOICE_NO_PHONE));
  assert.ok(!formatLoad(load, { link: "https://t.me/g/1" }).text.includes(VOICE_NO_PHONE));
});

test("yopiq guruh: matnda raqam yo'q — yozgan odamning profil raqami ko'rsatiladi", async () => {
  const { formatRaw, formatLoad } = await import("../src/format.js");
  const post = { text: "Toshkentdan Samarqandga 20 tonna un bor", senderPhone: "+998901112233", postedAt: Date.now() };
  assert.match(formatRaw(post, { phones: [] }).text, /📞 \+998901112233 \(yozgan odamning Telegram raqami\)/);
  assert.match(formatLoad({ fromCity: "Toshkent", toCity: "Samarqand", phones: [] }, post).text, /yozgan odamning Telegram raqami/);
});

test("tugma matni: emoji o'rtasidan kesilmaydi (2026-11-26 — guruh tanlash ochilmay qolgan edi)", async () => {
  const { cut } = await import("../src/feed.js");
  const name = "Yuk tashish xizmati 24/7 🚛🇺🇿 Toshkent";
  const short = cut(name, 26);
  assert.ok(short.isWellFormed());
  assert.ok(short.endsWith("…"));
  assert.equal(cut("Qisqa nom", 26), "Qisqa nom");
  assert.ok(cut("buzuq \uD83D nom", 26).isWellFormed(), "oldindan buzuq belgi ham tozalanadi");
  // har qanday joydan kesilganda ham butun
  const emoji = "🚛".repeat(40);
  for (let n = 2; n < 30; n++) assert.ok(cut(emoji, n).isWellFormed());
});
