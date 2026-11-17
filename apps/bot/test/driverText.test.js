import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFromText } from "../src/driverText.js";

// parseLoad natijasiga o'xshash (postType + loads); scope undefined — hamma joy va xalqaroga ruxsat
const parsed = (load) => ({ postType: "mashina_bor", loads: load ? [load] : [] });

test("matndan profil: transport, kuzov, tonna → kg; xalqaro matndan aniqlanadi", () => {
  const { profile, error } = profileFromText(parsed({ truckClass: "fura", bodyType: "tent", weightT: 20 }), "Fura, tent, 20 tonna", {});
  assert.equal(error, undefined);
  assert.equal(profile.vehicle.truckClass, "fura");
  assert.equal(profile.vehicle.bodyType, "tent");
  assert.equal(profile.vehicle.capacityKg, 20000);
  assert.equal(profile.international, false, "xalqaro aytilmagan");
  assert.deepEqual([profile.fromAreas, profile.toAreas], [[], []], "yo'nalish ro'yxatda so'ralmaydi");
});

test("xalqaro belgilari: qo'shni davlatlar / xalqaro → international", () => {
  for (const text of ["Fura tent 20 tonna, qo'shni davlatlarga ham", "Isuzu 5 tonna xalqaro", "Fura 20t Qozog'istonga"]) {
    const { profile } = profileFromText(parsed({ truckClass: "fura", bodyType: "tent", weightT: 20 }), text, {});
    assert.equal(profile.international, true, text);
  }
});

test("mashina turi topilmasa — tushunarli xato (preview chiqmaydi)", () => {
  const { error, profile } = profileFromText(parsed(null), "salom qalaysiz", {});
  assert.equal(profile, undefined);
  assert.match(error, /tushunmadim|Ro'yxatdan o'tish/);
});

test("transport bor, lekin tonna yo'q — sig'imni so'raydi", () => {
  const { error, profile } = profileFromText(parsed({ truckClass: "isuzu", bodyType: "ref", weightT: null }), "Isuzu ref", {});
  assert.equal(profile, undefined);
  assert.match(error, /ko'tar|tonna|sig/i);
});

test("yengil mashinada kuzov yo'q — xato bermaydi", () => {
  const { profile, error } = profileFromText(parsed({ truckClass: "yengil_avto", bodyType: null, weightT: 0.5 }), "Yengil mashina 500 kg", {});
  assert.equal(error, undefined);
  assert.equal(profile.vehicle.truckClass, "yengil_avto");
  assert.equal(profile.vehicle.bodyType, null);
  assert.equal(profile.vehicle.capacityKg, 500);
});

test("xalqaro ishlashi kirillchada ham tushuniladi («халқаро», «қўшни», «Қозоғистон», «международные»)", async () => {
  const { profileFromText } = await import("../src/driverText.js");
  const parsed = { loads: [{ truckClass: "fura", bodyType: "tent", weightT: 20 }] };
  const intl = (text) => profileFromText(parsed, text, { scope: "qoshni" }).profile?.international;
  assert.equal(intl("Фура тент 20 тонна, халқаро ҳам юраман"), true);
  assert.equal(intl("фура, қўшни давлатларга"), true);
  assert.equal(intl("фура 20т Қозоғистонга ҳам"), true);
  assert.equal(intl("фура тент, международные рейсы"), true);
  assert.equal(intl("Fura tent, xalqaro"), true);
  assert.equal(intl("Фура тент 20 тонна, фақат Ўзбекистон"), false);
});
