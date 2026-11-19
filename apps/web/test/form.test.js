import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capacityChoice,
  capacityKgOf,
  capacityUnit,
  formFromProfile,
  profileFromForm,
  selectClass,
  toggleClass,
  manyClassesPicked,
  formNeedsVehicle,
  formUsesGroups,
  selectFeed,
  toggleFeedRegion,
  toggleFeedSource,
  shipperFormFromProfile,
  shipperProfileFromForm,
  showSides,
  showSize,
  sizeSummary,
  toggle,
} from "../src/form.js";

const PROFILE = {
  vehicle: { truckClass: "fura", bodyType: "tent", capacityKg: 22000, body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 }, loadingSides: ["orqa"] },
  fromAreas: ["andijon"],
  toAreas: ["Rossiya"],
  domestic: true,
  international: true,
  mode: "own",
};

// 2026-11-19: yangi forma standart ⚡ Tezkor (mashina ixtiyoriy). Mashina tekshiruvlari — ichki «saralangan» rejimida
const sortedForm = (profile) => ({ ...formFromProfile(profile), feed: "saralangan" });

test("botdan kelgan sozlamalar formaga va qaytib profilga aylanadi (yo'nalish formada yo'q)", () => {
  const form = sortedForm(PROFILE);
  assert.equal(form.sizeMode, "std");
  assert.equal(form.capacity, "22");
  assert.equal(form.intl, "ham");
  assert.equal(form.fromAreas, undefined);
  // Yo'nalish bo'sh ketadi — server saqlaganda haydovchining «📋 Mos yuklar» dagi yo'nalishini qoldiradi
  assert.deepEqual(profileFromForm(form).profile, {
    ...PROFILE,
    vehicle: { ...PROFILE.vehicle, bodyGuess: false },
    fromAreas: [],
    toAreas: [],
    routeAt: null,
    feed: { mode: "saralangan", sources: [] }, // rejimsiz eski profil — «Saralangan»
  });
});

test("yangi haydovchi: bo'sh forma, xatolar kerakli bo'limni ko'rsatadi", () => {
  let form = sortedForm(null);
  assert.equal(profileFromForm(form).field, "class");
  form = selectClass(form, "isuzu");
  assert.equal(form.sizeMode, "std");
  assert.equal(profileFromForm(form).field, "body");
  form = { ...form, bodyType: "boshqa", capacity: "ko'p" };
  assert.equal(profileFromForm(form).field, "capacity");
  form = { ...form, capacity: "7,5", sizeMode: "custom", size: { lengthM: "6", widthM: "9", heightM: "2" } };
  assert.equal(profileFromForm(form).field, "size");
  form = { ...form, size: { lengthM: "6,2", widthM: "2,4", heightM: "2,3" } };
  const { profile } = profileFromForm(form);
  assert.equal(profile.vehicle.capacityKg, 7500);
  assert.equal(profile.vehicle.bodyType, null);
  assert.deepEqual(profile.vehicle.body, { lengthM: 6.2, widthM: 2.4, heightM: 2.3 });
});

test("transport turi o'zgarsa sig'im tozalanadi; yengil mashinada kuzov va o'lcham yo'q", () => {
  const mini = selectClass(sortedForm(PROFILE), "mini_fura");
  assert.equal(mini.capacity, "");
  assert.equal(mini.sizeMode, "std", "Mini furaning ham odatdagi o'lchami bor");
  const car = selectClass(sortedForm(PROFILE), "yengil_avto");
  assert.deepEqual([car.bodyType, car.sizeMode, showSize(car), showSides(car), sizeSummary(car)], [null, "none", false, false, null]);
  assert.deepEqual(sizeSummary(sortedForm(PROFILE)), { volumeM3: 90, pallets: 33 });
  assert.equal(sizeSummary({ ...sortedForm(PROFILE), bodyType: "samosval" }).pallets, null, "samosvalga palet qo'yilmaydi");
  const tractor = { ...sortedForm(PROFILE), bodyType: "tyagach" };
  assert.deepEqual([showSize(tractor), showSides(tractor)], [false, false]);
});

test("bir nechta transport belgilansa — kuzov, sig'im, o'lcham so'ralmaydi; bittasi qolsa — yana so'raladi", () => {
  let form = sortedForm(PROFILE); // fura, tent, 22 t
  form = toggleClass(toggleClass(toggleClass(form, "labo"), "isuzu"), "fura");
  assert.deepEqual(form.truckClasses, ["isuzu", "labo"], "ro'yxat tartibida");
  assert.equal(manyClassesPicked(form), true);
  assert.deepEqual([showSize(form), showSides(form)], [false, false]);
  const { profile } = profileFromForm({ ...form, capacity: "" });
  assert.deepEqual(profile.vehicle, { truckClass: "isuzu", truckClasses: ["isuzu", "labo"], bodyType: null, capacityKg: null, body: null, bodyGuess: false, loadingSides: [] });
  const again = sortedForm(profile);
  assert.deepEqual([again.truckClasses, again.truckClass], [["isuzu", "labo"], null], "qayta ochilganda belgilar joyida");
  const one = toggleClass(again, "labo");
  assert.deepEqual([one.truckClass, one.capacity], ["isuzu", ""]);
  assert.equal(profileFromForm(one).field, "body", "bitta qolsa — kuzov yana so'raladi");
  assert.equal(profileFromForm(toggleClass(one, "isuzu")).field, "class", "hech biri belgilanmasa");
});

test("yuk ko'tarish: Labo va yengil mashinada kg, qolganida tonna; birlik adashsa ham to'g'ri", () => {
  assert.deepEqual([capacityUnit("labo"), capacityUnit("yengil_avto"), capacityUnit("isuzu"), capacityUnit("katta_fura")], ["kg", "kg", "tonna", "tonna"]);
  assert.equal(capacityKgOf("300", "kg"), 300);
  assert.equal(capacityKgOf("0,7", "kg"), 700, "kg joyiga tonna yozilsa");
  assert.equal(capacityKgOf("7,5", "tonna"), 7500);
  assert.equal(capacityKgOf("700", "tonna"), 700, "tonna joyiga kg yozilsa");
  assert.ok(Number.isNaN(capacityKgOf("ko'p", "tonna")));
  assert.deepEqual([capacityChoice(0.3, "kg"), capacityChoice(40, "tonna")], ["300", "40"]);

  const car = { ...selectClass(sortedForm(null), "yengil_avto"), capacity: "400" };
  const { profile } = profileFromForm(car);
  assert.deepEqual(profile.vehicle, { truckClass: "yengil_avto", bodyType: null, capacityKg: 400, body: null, bodyGuess: false, loadingSides: [] });
  assert.match(profileFromForm({ ...car, capacity: "" }).error, /400 kg/);
});

test("«Bilmayman» — odatdagi o'lcham olinadi va belgilanadi; eski profil: «Yonidan» → o'ng va chap, bort → plashatka", () => {
  const form = { ...selectClass(formFromProfile(null), "katta_isuzu"), bodyType: "ref", capacity: "10", sizeMode: "none" };
  const { profile } = profileFromForm(form);
  assert.deepEqual(profile.vehicle.body, { lengthM: 7.2, widthM: 2.4, heightM: 2.3 });
  assert.equal(profile.vehicle.bodyGuess, true);
  assert.equal(formFromProfile(profile).sizeMode, "none", "qayta ochilganda ham «Bilmayman»");
  assert.deepEqual(sizeSummary(form), { volumeM3: 39.7, pallets: 10 }, "devorga 2 sm bo'shliq: eniga 3 ta palet sig'maydi");

  const old = formFromProfile({ ...PROFILE, vehicle: { ...PROFILE.vehicle, bodyType: "bort", loadingSides: ["orqa", "yon"] } });
  assert.equal(old.bodyType, "ploshatka");
  assert.deepEqual(old.loadingSides, ["orqa", "ong", "chap"]);
  assert.equal(formFromProfile({ ...PROFILE, vehicle: { ...PROFILE.vehicle, body: null } }).sizeMode, "none", "o'lchami yozilmagan eski profil");
});

test("«Qayerda ishlaysiz?»: qo'shni — xalqaro bor; ichki — faqat O'zbekiston", () => {
  const form = { ...formFromProfile(PROFILE), intl: "ham" };
  const qoshni = profileFromForm(form, "qoshni").profile;
  assert.deepEqual([qoshni.fromAreas, qoshni.domestic, qoshni.international], [[], true, true]);
  const ichki = profileFromForm(form, "ichki").profile;
  assert.deepEqual([ichki.domestic, ichki.international], [true, false]);
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
});

test("yuk beruvchi formasi: bo'sh — hammasi; profilga va qaytib; faqat O'zbekiston tanlansa davlat tashlanadi", () => {
  const empty = shipperProfileFromForm(shipperFormFromProfile(null), "qoshni").profile;
  assert.deepEqual(empty, { fromAreas: [], toAreas: [], domestic: true, international: false, truckClasses: [], bodyTypes: [] });

  const shipper = { fromAreas: ["samarqand", "Qozog'iston"], toAreas: [], domestic: true, international: true, truckClasses: ["fura", "isuzu"], bodyTypes: ["tent"] };
  const form = shipperFormFromProfile(shipper);
  assert.equal(form.intl, "ham");
  assert.deepEqual(shipperProfileFromForm(form, "qoshni").profile, shipper);
  const domestic = shipperProfileFromForm({ ...form, intl: "yoq" }, "qoshni").profile;
  assert.deepEqual([domestic.fromAreas, domestic.international], [["samarqand"], false]);
  // "Boshqa" kuzov va noma'lum mashina turi tashlanadi
  const odd = shipperProfileFromForm({ ...form, truckClasses: ["raketa", "fura"], bodyTypes: ["boshqa", "ref"] }, "qoshni").profile;
  assert.deepEqual([odd.truckClasses, odd.bodyTypes], [["fura"], ["ref"]]);
});

// --- Yetkazish rejimi (2026-11-14) ---
test("rejim: tezkor — mashinasiz saqlanadi; to'liq mashina bo'lsa qoladi; guruhlarim — kamida bitta guruh", () => {
  let form = selectFeed(formFromProfile(null), "tezkor");
  assert.equal(formNeedsVehicle(form), false);
  assert.equal(formUsesGroups(form), false);
  const fast = profileFromForm(form).profile;
  assert.equal(fast.vehicle, null);
  assert.deepEqual(fast.feed, { mode: "tezkor", sources: [] });
  // Chala mashina (sig'imsiz) — xato emas, mashinasiz ketadi
  assert.equal(profileFromForm(selectClass(form, "isuzu")).profile.vehicle, null);
  // Eski to'liq mashina — saqlanadi
  const kept = profileFromForm(selectFeed(formFromProfile(PROFILE), "tezkor")).profile;
  assert.equal(kept.vehicle.truckClass, "fura");
  assert.equal(kept.feed.mode, "tezkor");

  form = selectFeed(form, "guruhlarim");
  assert.equal(formUsesGroups(form), true);
  assert.equal(profileFromForm(form).field, "groups");
  form = toggleFeedSource(form, "@TutGruz").form;
  form = toggleFeedSource(form, "@Yuk_markazi").form;
  form = toggleFeedSource(form, "@tutgruz").form; // kichik harf bilan ham — o'sha guruh, olib tashlanadi
  assert.deepEqual(form.feedSources, ["@Yuk_markazi"]);
  assert.deepEqual(profileFromForm(form).profile.feed, { mode: "guruhlarim", sources: ["@Yuk_markazi"] });
  // Rejim almashsa ham guruhlar tanlovi formada qoladi
  assert.deepEqual(selectFeed(selectFeed(form, "tezkor"), "guruhlarim").feedSources, ["@Yuk_markazi"]);
});

test("rejim: «+ saralangan» — mashina shart (xato avval guruhlarda, keyin transportda); botdagi mashinasiz profil formaga ochiladi", () => {
  let form = selectFeed(formFromProfile(null), "guruhlarim_plus");
  assert.equal(formNeedsVehicle(form), true);
  assert.equal(profileFromForm(form).field, "groups", "rejim qadami birinchi");
  form = toggleFeedSource(form, "@TutGruz").form;
  assert.equal(profileFromForm(form).field, "class");
  // Botda tezkor tanlagan (mashina yo'q) — forma ochiladi, rejim va guruhlar to'g'ri
  const fromBot = formFromProfile({ vehicle: null, domestic: true, international: false, feed: { mode: "guruhlarim", sources: ["@TutGruz"] } });
  assert.equal(fromBot.truckClass, null);
  assert.equal(fromBot.feed, "guruhlarim");
  assert.deepEqual(fromBot.feedSources, ["@TutGruz"]);
});

test("rejim: 50 tadan ortiq guruh tanlab bo'lmaydi", () => {
  let form = selectFeed(formFromProfile(null), "guruhlarim");
  for (let i = 0; i < 50; i++) form = toggleFeedSource(form, `@guruh_${i}_yuk`).form;
  assert.match(toggleFeedSource(form, "@yana_bir_guruh").error, /50 ta/);
});

test("«📌 Mening guruhlarim» ro'yxati: yopiq guruh belgisi, Pro'siz — tanlab bo'lmaydi, raqamli id ko'rsatilmaydi", async () => {
  const { groupOptions } = await import("../src/feedGroups.js");
  const options = groupOptions(
    [
      { name: "@TutGruz", title: "Tut Gruz", perDay: 3, closed: false, locked: false },
      { name: "-1001", title: "Yopiq ISUZU", perDay: 1, closed: true, locked: true },
    ],
    [],
  );
  assert.deepEqual(options.map((o) => [o.id, o.closed, o.disabled, o.note]), [
    ["@TutGruz", false, false, "@TutGruz"],
    ["-1001", true, true, "🔒 Pro uchun"],
  ]);
});

test("«📌 Mening guruhlarim» qidiruvi kirill/lotin farqisiz", async () => {
  const { groupOptions } = await import("../src/feedGroups.js");
  const { foldText } = await import("@yuk/shared");
  const [o] = groupOptions([{ name: "-1001", title: "Кукон ISUZU юк", perDay: 1, closed: true, locked: false }], []);
  assert.ok(o.search.includes(foldText("kukon")));
  assert.ok(o.search.includes(foldText("ЮК")));
});

test("rejim (2026-11-19): yangi va eski saralangan profil formada ⚡ Tezkor; tezkor profil mashinasiz saqlanadi", () => {
  assert.equal(formFromProfile(null).feed, "tezkor");
  assert.equal(formFromProfile(PROFILE).feed, "tezkor", "rejimsiz eski profil — tezkor deb ko'rinadi");
  const result = profileFromForm(formFromProfile(null));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.profile.feed, { mode: "tezkor", sources: [] });
});

test("hududim (2026-11-19): viloyat belgilanadi, kamida bitta; profilga feed.regions", () => {
  let form = selectFeed(formFromProfile(null), "hududim");
  assert.equal(profileFromForm(form).field, "regions");
  form = toggleFeedRegion(toggleFeedRegion(toggleFeedRegion(form, "samarqand"), "buxoro"), "buxoro");
  assert.deepEqual(profileFromForm(form).profile.feed, { mode: "hududim", sources: [], regions: ["samarqand"] });
  assert.deepEqual(formFromProfile({ feed: { mode: "hududim", sources: [], regions: ["andijon"] } }).feedRegions, ["andijon"]);
});
