import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLoad, matchTruck, sanitizeShipperProfile } from "@yuk/shared";
import {
  SHIPPER_STEPS,
  STEPS,
  applyAction,
  applyText,
  describeProfile,
  newDraft,
  parseBodySize,
  parseCapacityT,
  profileFromDraft,
  renderStep,
} from "../src/wizard.js";

// Tugma ma'lumotidan qadam va qiymatni ajratib, bosishni taqlid qiladi
function press(draft, data) {
  const [, step, value] = data.split(":");
  return applyAction(draft, step, value).draft;
}
const buttons = (draft) => renderStep(draft).keyboard.flat();
const find = (draft, text) => {
  const found = buttons(draft).find((b) => b.text.includes(text));
  assert.ok(found, `"${text}" tugmasi yo'q (${draft.step})`);
  return found.data;
};

test("har bir qadam tugmalari 64 baytdan oshmaydi", () => {
  for (const step of STEPS) {
    const draft = { ...newDraft(), step, vehicle: { ...newDraft().vehicle, truckClass: "fura" } };
    for (const b of buttons(draft)) assert.ok(Buffer.byteLength(b.data) <= 64, b.data);
  }
});

test("Isuzu haydovchisi to'liq ro'yxatdan o'tadi (yo'nalishsiz — u «📋 Mos yuklar» da)", () => {
  let d = newDraft();
  assert.match(renderStep(d).text, /Transportingiz qaysi turdagi/);
  const classes = buttons(d).map((b) => b.text);
  assert.deepEqual(classes.slice(0, 3), ["Katta fura (20–40 tonna)", "Kamaz (20–40 tonna)", "Fura (20–26 tonna)"]);
  assert.ok(classes.includes("Labo / Damas (300–700 kg)") && classes.includes("Yengil mashina (200–500 kg)"));
  d = press(d, find(d, "Isuzu (3"));
  assert.equal(d.step, "body");
  assert.ok(!buttons(d).some((b) => b.text === "Boshqa"));
  d = press(d, find(d, "Tent"));
  assert.deepEqual(buttons(d).slice(0, 3).map((b) => b.text), ["3 tonna", "4 tonna", "5 tonna"]);
  d = press(d, find(d, "5 tonna"));
  assert.equal(d.vehicle.capacityKg, 5000);
  d = press(d, find(d, "Standart"));
  assert.deepEqual(d.vehicle.body, { lengthM: 4.85, widthM: 2.15, heightM: 1.95 });
  assert.deepEqual(buttons(d).slice(0, 4).map((b) => b.text), ["Ustidan", "Orqasidan", "O'ngdan", "Chapdan"], "«Yonidan» yo'q");
  d = press(d, find(d, "Orqasidan"));
  d = press(d, find(d, "Ustidan"));
  assert.equal(d.step, "sides", "belgilash keyingi qadamga o'tkazmaydi");
  assert.ok(buttons(d).some((b) => b.text === "✅ Orqasidan"));
  d = press(d, find(d, "Tayyor"));
  assert.equal(d.step, "intl", "qayerdan/qayerga va «qaysi yuklar» savollari yo'q");
  assert.match(renderStep(d).text, /📋 Mos yuklar/);
  d = press(d, find(d, "Faqat O'zbekiston"));
  assert.equal(d.step, "done");
  const result = applyAction(d, "done", "save");
  assert.equal(result.saved, true);

  const profile = profileFromDraft(result.draft);
  assert.deepEqual([profile.fromAreas, profile.toAreas], [[], []]);
  assert.deepEqual(profile.vehicle.loadingSides, ["orqa", "ust"]);
  assert.equal(profile.vehicle.bodyGuess, false);
  const text = describeProfile(profile);
  assert.match(text, /Isuzu, Tent \/ furgon, 5 tonna/);
  assert.match(text, /20,3 kub, 8 palet/);
  assert.match(text, /Yo'nalish: tanlanmagan/);

  // Profil match.js bilan ishlaydi
  const load = { fromCity: "Toshkent", fromRegion: "toshkent_sh", toRegion: "navoiy", weightT: 6, loadingSides: [] };
  assert.equal(matchLoad(load, profile).ok, false, "6 tonna Isuzu 5 tonnaga sig'maydi");
  assert.equal(matchLoad({ ...load, weightT: 4 }, profile).ok, true);
});

test("«Bilmayman» — odatdagi o'lcham olinadi; yengil mashinada kuzov, tyagachda o'lcham va tomon so'ralmaydi", () => {
  let d = press(newDraft(), "w:class:katta_isuzu");
  d = press(press(d, "w:body:ref"), "w:capacity:10");
  assert.equal(d.step, "size");
  d = press(d, find(d, "Bilmayman"));
  assert.deepEqual(d.vehicle.body, { lengthM: 7.2, widthM: 2.4, heightM: 2.3 });
  assert.equal(d.vehicle.bodyGuess, true);
  assert.match(describeProfile(profileFromDraft(d)), /odatdagi o'lcham/);
  // O'lcham yozilsa — belgi olib tashlanadi
  d = applyText({ ...d, step: "size" }, "7 2.4 2.5").draft;
  assert.equal(d.vehicle.bodyGuess, false);

  // Yengil mashina: kuzov qadami yo'q, sig'im — kg tugmalari, "300" yozilsa ham 300 kg
  let car = press(newDraft(), "w:class:yengil_avto");
  assert.equal(car.step, "capacity");
  assert.deepEqual(buttons(car).slice(0, 4).map((b) => b.text), ["200 kg", "300 kg", "400 kg", "500 kg"]);
  assert.match(renderStep(car).text, /Qancha yuk ko'taradi\?[\s\S]*400 kg/);
  car = applyText(car, "300").draft;
  assert.equal(car.vehicle.capacityKg, 300);
  assert.equal(car.step, "intl", "kuzov, o'lcham va tomon so'ralmaydi");
  assert.equal(press(car, "w:intl:back").step, "capacity");
  assert.deepEqual(profileFromDraft(car).vehicle, { truckClass: "yengil_avto", bodyType: null, capacityKg: 300, body: null, bodyGuess: false, loadingSides: [] });

  // Tyagach: kuzov tanlangach sig'im, keyin darrov xalqaro savoli
  let tractor = press(press(newDraft(), "w:class:fura"), "w:body:tyagach");
  tractor = press(tractor, "w:capacity:25");
  assert.equal(tractor.step, "intl");
  // Katta fura va Kamaz — 40 tonnagacha
  assert.ok(buttons(press(newDraft(), "w:class:katta_fura")).some((b) => b.text === "Plashatka / shalanda"));
  assert.ok(buttons({ ...newDraft(), step: "capacity", vehicle: { ...newDraft().vehicle, truckClass: "kamaz" } }).some((b) => b.text === "40 tonna"));
});

test("sig'im va o'lchamni yozib yuborish", () => {
  assert.equal(parseCapacityT("7,5"), 7.5);
  assert.equal(parseCapacityT("24 tonna"), 24);
  assert.equal(parseCapacityT("7500 kg"), 7.5);
  assert.equal(parseCapacityT("7500"), 7.5);
  assert.equal(parseCapacityT("bilmayman"), null);
  assert.deepEqual(parseBodySize("4,85x2,15x1,95"), { lengthM: 4.85, widthM: 2.15, heightM: 1.95 });
  assert.deepEqual(parseBodySize("13.6 × 2.45 × 2.7"), { lengthM: 13.6, widthM: 2.45, heightM: 2.7 });
  assert.equal(parseBodySize("13.6 2.45"), null);
  assert.equal(parseBodySize("2.45 13.6 2.7"), null, "eni 13.6 m bo'lmaydi");

  let d = { ...newDraft(), step: "capacity", vehicle: { ...newDraft().vehicle, truckClass: "mini_fura" } };
  const bad = applyText(d, "ko'p");
  assert.ok(bad.error);
  assert.equal(bad.draft.step, "capacity");
  d = applyText(d, "15").draft;
  assert.equal(d.vehicle.capacityKg, 15000);
  assert.equal(d.step, "size");
  d = applyText(d, "7 2.4 2.5").draft;
  assert.equal(d.step, "sides");
  assert.ok(applyText(d, "salom").error, "tugma kutilgan qadamda matn — xato");
});

test("orqaga, eski tugma, tozalash", () => {
  let d = newDraft();
  d = press(d, "w:class:fura");
  d = press(d, "w:body:back");
  assert.equal(d.step, "class");
  d = press(d, "w:class:fura");
  const before = d;
  d = press(d, "w:intl:yoq"); // boshqa qadamdagi eski tugma
  assert.deepEqual(d, before);
  assert.deepEqual(press(d, "w:mode:all"), before, "olib tashlangan «qaysi yuklar» qadamining tugmasi ham");
  let s = { ...newDraft(null, undefined, "yuk_beruvchi"), step: "from" };
  s = press(s, "w:from:t.andijon");
  assert.deepEqual(s.fromAreas, ["andijon"]);
  s = press(s, "w:from:all");
  assert.deepEqual(s.fromAreas, []);
});

test("sinf o'zgarsa, eski sig'im va o'lcham tozalanadi; mavjud profil bilan tahrirlash", () => {
  let d = newDraft();
  d = press(d, "w:class:fura");
  d = { ...d, step: "capacity" };
  d = press(d, "w:capacity:24");
  d = { ...d, step: "class" };
  d = press(d, "w:class:isuzu");
  assert.equal(d.vehicle.capacityKg, null);
  d = { ...press({ ...d, step: "body" }, "w:body:tent"), step: "class" };
  assert.equal(press(d, "w:class:yengil_avto").vehicle.bodyType, null, "yengil mashinada kuzov yo'q");

  const profile = { vehicle: { truckClass: "fura", bodyType: "ref", capacityKg: 22000, loadingSides: ["orqa"] }, fromAreas: ["andijon"], toAreas: [], domestic: true, international: true, mode: "own" };
  const edit = newDraft(profile);
  assert.equal(edit.step, "class");
  assert.equal(edit.vehicle.bodyType, "ref");
  assert.equal(edit.fromAreas, undefined, "yo'nalish qoralamada yo'q — saqlaganda bot eskisini qoldiradi");
  edit.vehicle.loadingSides.push("ust");
  assert.deepEqual(profile.vehicle.loadingSides, ["orqa"], "asl profil o'zgarmaydi");
  assert.match(describeProfile(profile), /O'zbekiston va qo'shni davlatlar/);
  assert.match(describeProfile(profile, "hammasi"), /O'zbekiston va xalqaro/);
});

test("yo'nalish doirasi: qo'shni — 5 ta davlat; ichki — davlat va xalqaro savoli yo'q; hammasi — umumiy Xorij", () => {
  const shipper = (scope) => newDraft(null, scope, "yuk_beruvchi");
  const labels = (draft) => buttons({ ...draft, step: "from" }).map((b) => b.text);
  const qoshni = labels(shipper());
  for (const name of ["Qozog'iston", "Qirg'iziston", "Tojikiston", "Turkmaniston", "Afg'oniston"]) {
    assert.ok(qoshni.some((t) => t.includes(name)), name);
  }
  assert.ok(!qoshni.some((t) => /Rossiya|Xorij/.test(t)), "uzoq davlat va umumiy Xorij yo'q");
  assert.ok(!labels(shipper("ichki")).some((t) => t.includes("🌍") || /Xorij/.test(t)));
  assert.ok(labels(shipper("hammasi")).some((t) => /Xorij/.test(t)));
  assert.match(renderStep({ ...newDraft(), step: "intl" }).text, /Qo'shni davlatlar \(Qozog'iston/);

  // Rossiya tugmasi yo'q, eski/soxta tugma bosilsa ham qo'shilmaydi
  let d = { ...shipper(), step: "from" };
  d = press(d, "w:from:t.Rossiya");
  assert.deepEqual(d.fromAreas, []);
  d = press(d, "w:from:t.Qozog'iston");
  d = press(d, "w:from:t.toshkent");
  assert.deepEqual(d.fromAreas, ["Qozog'iston", "toshkent"]);

  // "Faqat O'zbekiston" tanlansa, belgilangan davlat profildan tushadi
  d = { ...d, step: "intl" };
  const domestic = profileFromDraft(press(d, "w:intl:yoq"));
  assert.deepEqual([domestic.fromAreas, domestic.international], [["toshkent"], false]);
  const both = profileFromDraft(press(d, "w:intl:ham"));
  assert.deepEqual([both.fromAreas, both.international], [["Qozog'iston", "toshkent"], true]);

  // Haydovchi, ichki: yuklash tomonidan keyin darrov «Tekshiring», orqaga ham tomonga
  let i = { ...newDraft(null, "ichki"), step: "sides", vehicle: { ...newDraft().vehicle, truckClass: "fura", bodyType: "tent" } };
  i = press(i, "w:sides:ok");
  assert.equal(i.step, "done");
  assert.equal(press(i, "w:done:back").step, "sides");
  assert.equal(profileFromDraft({ ...i, international: true }).international, false);
  assert.equal(press(i, "w:done:restart").scope, "ichki", "qaytadan boshlansa ham doira saqlanadi");
});

test("yuk beruvchi: qayerdan → qayerga → mashina → kuzov → xalqaro → saqlash", () => {
  for (const step of SHIPPER_STEPS) {
    for (const b of buttons({ ...newDraft(null, undefined, "yuk_beruvchi"), step })) assert.ok(Buffer.byteLength(b.data) <= 64, b.data);
  }
  let d = newDraft(null, undefined, "yuk_beruvchi");
  assert.equal(d.step, "from");
  assert.match(renderStep(d).text, /Yukingiz qayerda yuklanadi/);
  d = press(d, "w:from:t.samarqand");
  d = press(d, "w:from:ok");
  d = press(d, "w:to:t.toshkent");
  d = press(d, "w:to:ok");
  assert.equal(d.step, "classes");
  assert.match(renderStep(d).text, /Qanday transport kerak/);
  d = press(d, find(d, "Fura (20"));
  d = press(d, find(d, "Isuzu (3"));
  d = press(d, "w:classes:t.raketa"); // soxta tugma — e'tiborsiz
  d = press(d, "w:classes:ok");
  assert.equal(d.step, "bodies");
  assert.ok(!buttons(d).some((b) => b.text === "Boshqa"), "«Boshqa» kuzov yuk beruvchiga kerak emas");
  d = press(d, find(d, "Tent"));
  d = press(d, "w:bodies:ok");
  assert.equal(d.step, "intl");
  assert.equal(press(d, "w:intl:back").step, "bodies");
  d = press(d, "w:intl:yoq");
  assert.equal(d.step, "done");
  assert.match(renderStep(d).text, /Yuk qayerda: Samarqand[\s\S]*Transport: Fura, Isuzu[\s\S]*Kuzov: Tent \/ furgon/);

  const profile = profileFromDraft(d);
  assert.deepEqual(profile, {
    fromAreas: ["samarqand"],
    toAreas: ["toshkent"],
    domestic: true,
    international: false,
    truckClasses: ["fura", "isuzu"],
    bodyTypes: ["tent"],
  });
  assert.deepEqual(sanitizeShipperProfile(profile).profile, profile, "savol-javob natijasi tekshiruvdan o'zgarmay o'tadi");
  // Samarqanddagi bo'sh tent fura — mos; ref — mos emas; qayerga yozilmagan — baribir mos
  assert.equal(matchTruck({ fromRegion: "samarqand", truckClass: "fura", bodyType: "tent" }, profile).ok, true);
  assert.equal(matchTruck({ fromRegion: "samarqand", truckClass: "fura", bodyType: "ref" }, profile).ok, false);

  // Qaytadan — rol saqlanadi; ichki doirada xalqaro savoli yo'q
  assert.equal(press(d, "w:done:restart").role, "yuk_beruvchi");
  let i = { ...newDraft(null, "ichki", "yuk_beruvchi"), step: "bodies" };
  assert.equal(press(i, "w:bodies:ok").step, "done");
});
