import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLoad } from "@yuk/shared";
import {
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

test("Isuzu haydovchisi to'liq ro'yxatdan o'tadi", () => {
  let d = newDraft();
  d = press(d, find(d, "Isuzu"));
  assert.equal(d.step, "body");
  d = press(d, find(d, "Tent"));
  d = press(d, find(d, "5 t"));
  assert.equal(d.vehicle.capacityKg, 5000);
  d = press(d, find(d, "Standart"));
  assert.deepEqual(d.vehicle.body, { lengthM: 4.85, widthM: 2.15, heightM: 1.95 });
  d = press(d, find(d, "Orqadan"));
  d = press(d, find(d, "Ustidan"));
  assert.equal(d.step, "sides", "belgilash keyingi qadamga o'tkazmaydi");
  assert.ok(buttons(d).some((b) => b.text === "✅ Orqadan"));
  d = press(d, find(d, "Tayyor"));
  d = press(d, find(d, "Toshkent vil."));
  d = press(d, find(d, "Toshkent shahri"));
  d = press(d, find(d, "Tayyor"));
  d = press(d, find(d, "Tayyor")); // qayerga — istalgan joy
  d = press(d, find(d, "Faqat O'zbekiston"));
  d = press(d, find(d, "Faqat mashinamga"));
  assert.equal(d.step, "done");
  const result = applyAction(d, "done", "save");
  assert.equal(result.saved, true);

  const profile = profileFromDraft(result.draft);
  assert.deepEqual(profile.fromAreas, ["toshkent", "toshkent_sh"]);
  assert.deepEqual(profile.vehicle.loadingSides, ["orqa", "ust"]);
  const text = describeProfile(profile);
  assert.match(text, /Isuzu, Tent, 5 t/);
  assert.match(text, /20,3 kub, 8 palet/);
  assert.match(text, /hamma viloyat|Toshkent/);

  // Profil match.js bilan ishlaydi
  const load = { fromCity: "Toshkent", fromRegion: "toshkent_sh", toRegion: "navoiy", weightT: 6, loadingSides: [] };
  assert.equal(matchLoad(load, profile).ok, false, "6 t Isuzu 5 t ga sig'maydi");
  assert.equal(matchLoad({ ...load, weightT: 4 }, profile).ok, true);
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
  d = press(d, "w:mode:all"); // boshqa qadamdagi eski tugma
  assert.deepEqual(d, before);
  d = { ...d, step: "from" };
  d = press(d, "w:from:t.andijon");
  assert.deepEqual(d.fromAreas, ["andijon"]);
  d = press(d, "w:from:all");
  assert.deepEqual(d.fromAreas, []);
});

test("sinf o'zgarsa, eski sig'im va o'lcham tozalanadi; mavjud profil bilan tahrirlash", () => {
  let d = newDraft();
  d = press(d, "w:class:fura");
  d = { ...d, step: "capacity" };
  d = press(d, "w:capacity:24");
  d = { ...d, step: "class" };
  d = press(d, "w:class:isuzu");
  assert.equal(d.vehicle.capacityKg, null);

  const profile = { vehicle: { truckClass: "fura", bodyType: "ref", capacityKg: 22000, loadingSides: ["orqa"] }, fromAreas: ["andijon"], toAreas: [], domestic: true, international: true, mode: "all" };
  const edit = newDraft(profile);
  assert.equal(edit.step, "class");
  assert.equal(edit.vehicle.bodyType, "ref");
  assert.deepEqual(edit.fromAreas, ["andijon"]);
  edit.fromAreas.push("namangan");
  assert.deepEqual(profile.fromAreas, ["andijon"], "asl profil o'zgarmaydi");
  assert.match(describeProfile(profile), /O'zbekiston va qo'shni davlatlar/);
  assert.match(describeProfile(profile, "hammasi"), /O'zbekiston va xalqaro/);
});

test("yo'nalish doirasi: qo'shni — 5 ta davlat; ichki — davlat va xalqaro savoli yo'q; hammasi — umumiy Xorij", () => {
  const labels = (draft) => buttons({ ...draft, step: "from" }).map((b) => b.text);
  const qoshni = labels(newDraft());
  for (const name of ["Qozog'iston", "Qirg'iziston", "Tojikiston", "Turkmaniston", "Afg'oniston"]) {
    assert.ok(qoshni.some((t) => t.includes(name)), name);
  }
  assert.ok(!qoshni.some((t) => /Rossiya|Xorij/.test(t)), "uzoq davlat va umumiy Xorij yo'q");
  assert.ok(!labels(newDraft(null, "ichki")).some((t) => t.includes("🌍") || /Xorij/.test(t)));
  assert.ok(labels(newDraft(null, "hammasi")).some((t) => /Xorij/.test(t)));
  assert.match(renderStep({ ...newDraft(), step: "intl" }).text, /Qo'shni davlatlar \(Qozog'iston/);

  // Rossiya tugmasi yo'q, eski/soxta tugma bosilsa ham qo'shilmaydi
  let d = { ...newDraft(), step: "from" };
  d = press(d, "w:from:t.Rossiya");
  assert.deepEqual(d.fromAreas, []);
  d = press(d, "w:from:t.Qozog'iston");
  d = press(d, "w:from:t.toshkent");
  assert.deepEqual(d.fromAreas, ["Qozog'iston", "toshkent"]);

  // "Faqat O'zbekiston" tanlansa, belgilangan davlat profildan tushadi
  d = press(d, "w:from:ok");
  d = press(d, "w:to:ok");
  assert.equal(d.step, "intl");
  const domestic = profileFromDraft(press(d, "w:intl:yoq"));
  assert.deepEqual([domestic.fromAreas, domestic.international], [["toshkent"], false]);
  const both = profileFromDraft(press(d, "w:intl:ham"));
  assert.deepEqual([both.fromAreas, both.international], [["Qozog'iston", "toshkent"], true]);

  // ichki: "to" dan keyin darrov "mode", orqaga ham "to" ga
  let i = { ...newDraft(null, "ichki"), step: "to" };
  i = press(i, "w:to:ok");
  assert.equal(i.step, "mode");
  assert.equal(press(i, "w:mode:back").step, "to");
  assert.equal(profileFromDraft({ ...i, international: true }).international, false);
  assert.equal(press({ ...i, step: "done" }, "w:done:restart").scope, "ichki", "qaytadan boshlansa ham doira saqlanadi");
});
