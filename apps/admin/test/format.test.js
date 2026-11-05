import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areasText,
  cargoText,
  durationMin,
  formatDateTime,
  formatNumber,
  formatTime,
  loadView,
  phoneLinks,
  placeText,
  priceText,
  profileSummary,
  timeAgo,
  uptimeText,
  vehicleText,
  weightText,
} from "../src/format.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TZ = { timeZone: "Asia/Tashkent" };

// Soxta yuk (haqiqiy e'lon emas)
const LOAD = {
  category: "fura",
  fromCity: "Beshariq",
  fromRegion: "fargona",
  fromCountry: "O'zbekiston",
  toCity: "Samarqand",
  toRegion: "samarqand",
  cargo: "Sement",
  weightT: 22,
  volumeM3: null,
  pallets: 33,
  truckClass: "fura",
  bodyType: "tent",
  vehicleCount: 2,
  loadingSides: ["orqa"],
  partial: false,
  price: 3800000,
  priceUnit: "reys",
  currency: "UZS",
  payment: "naqd",
  negotiable: true,
  when: "ertaga",
  note: null,
  phones: ["998901112233"],
};

test("raqamlar bo'sh joy bilan guruhlanadi, kasr vergul bilan", () => {
  assert.equal(formatNumber(3800000), "3 800 000");
  assert.equal(formatNumber(14.62, 1), "14,6");
  assert.equal(formatNumber(14, 1), "14");
  assert.equal(formatNumber(2.45, 2), "2,45");
  assert.equal(formatNumber(null), "—");
});

test("joy: avval viloyat, keyin shahar; markaz va xorij", () => {
  assert.equal(placeText(LOAD, "from"), "Farg'ona, Beshariq");
  assert.equal(placeText(LOAD, "to"), "Samarqand");
  assert.equal(placeText({ fromCity: "Chirchiq", fromRegion: "toshkent" }, "from"), "Toshkent vil., Chirchiq");
  assert.equal(placeText({ toCity: "Moskva", toRegion: "xorij", toCountry: "Rossiya" }, "to"), "Rossiya, Moskva");
  assert.equal(placeText({ toRegion: "surxondaryo" }, "to"), "Surxondaryo viloyati");
  assert.equal(placeText({}, "to"), "?");
});

test("og'irlik, narx, mashina, yuk matni", () => {
  assert.equal(weightText(0.7), "700 kg");
  assert.equal(weightText(1.5), "1,5 t");
  assert.equal(weightText(null), null);
  assert.equal(priceText(LOAD), "3 800 000 so'm · kelishiladi · naqd");
  assert.equal(priceText({ price: 200, priceUnit: "kg" }), "200 so'm / kilosi");
  assert.equal(priceText({ price: 1500, currency: "USD" }), "$1 500");
  assert.equal(priceText({}), "narx yozilmagan");
  assert.equal(vehicleText(LOAD), "2 ta · Fura · tent · orqadan");
  assert.equal(vehicleText({ bodyType: "ref" }), "Ref");
  assert.equal(cargoText(LOAD), "Sement · 22 t · 33 palet");
});

test("telefon tel: havolasiga aylanadi, qisqa raqam tashlanadi", () => {
  assert.deepEqual(phoneLinks(["998901112233", "+998 90 111-22-44", "12"]), [
    { text: "+998901112233", href: "tel:+998901112233" },
    { text: "+998901112244", href: "tel:+998901112244" },
  ]);
  assert.deepEqual(phoneLinks(undefined), []);
});

test("loadView kartochka uchun hamma matnni beradi", () => {
  const view = loadView(LOAD);
  assert.equal(view.from, "Farg'ona, Beshariq");
  assert.equal(view.to, "Samarqand");
  assert.equal(view.category, "Fura");
  assert.equal(view.when, "ertaga");
  assert.equal(view.phones.length, 1);
});

test("haydovchi profili qisqa ko'rinishda", () => {
  const summary = profileSummary({
    vehicle: { truckClass: "fura", bodyType: "ref", capacityKg: 22000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: [] },
    fromAreas: ["andijon", "Rossiya"],
    toAreas: [],
    domestic: true,
    international: true,
    mode: "own",
  });
  assert.equal(summary.vehicle, "Fura · ref · 22 t");
  assert.equal(summary.size, "13,6 × 2,45 × 2,7 m");
  assert.equal(summary.from, "Andijon vil., Rossiya");
  assert.equal(summary.to, "Hamma joy");
  assert.equal(summary.intl, "O'zbekiston va xalqaro");
  assert.equal(summary.mode, "Faqat mashinamga mos yuklar");
  assert.equal(profileSummary(null), null);
  assert.equal(areasText(["toshkent_sh"]), "Toshkent shahri");
});

test("nisbiy vaqt: hozirgina, daq, soat, kun, keyin sana", () => {
  const now = Date.UTC(2026, 10, 5, 10, 0);
  assert.equal(timeAgo(now - 20 * 1000, now), "hozirgina");
  assert.equal(timeAgo(now + 5000, now), "hozirgina");
  assert.equal(timeAgo(now - 5 * MIN, now), "5 daq oldin");
  assert.equal(timeAgo(now - 3 * HOUR - 10 * MIN, now), "3 soat oldin");
  assert.equal(timeAgo(now - 50 * HOUR, now), "2 kun oldin");
  assert.equal(timeAgo(now - 10 * 24 * HOUR, now, TZ), "26.10 15:00");
  assert.equal(timeAgo(null, now), "—");
});

test("soat va sana Toshkent vaqtida", () => {
  const ts = Date.UTC(2026, 10, 5, 9, 7, 3);
  assert.equal(formatTime(ts, TZ), "14:07");
  assert.equal(formatTime(ts, { ...TZ, seconds: true }), "14:07:03");
  assert.equal(formatDateTime(ts, TZ), "05.11 14:07");
});

test("davomiylik va ishlash vaqti", () => {
  assert.equal(durationMin(45), "45 daq");
  assert.equal(durationMin(65), "1 soat 5 daq");
  assert.equal(durationMin(120), "2 soat");
  assert.equal(durationMin(1500), "1 kun 1 soat");
  assert.equal(durationMin(null), "—");
  const now = 1_000_000_000;
  assert.equal(uptimeText(now - 12_000, now), "12 s");
  assert.equal(uptimeText(now - 5 * MIN, now), "5 daq");
  assert.equal(uptimeText(now - (2 * HOUR + 5 * MIN), now), "2 soat 5 daq");
  assert.equal(uptimeText(null, now), "—");
});
