import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rawLoadWanted,
  describeProfile,
  feedLabel,
  feedNeedsVehicle,
  feedOf,
  profileReady,
  profileRows,
  rawProfile,
  rawWanted,
  sanitizeFeed,
  sanitizeProfile,
  sortedReady,
  sortedWanted,
  usesRawFeed,
  withPrevFeed,
} from "../src/index.js";

const FURA = { truckClass: "fura", bodyType: "tent", capacityKg: 20000, body: null, loadingSides: [] };

test("rejim: eski profil (feed yo'q) — saralangan; buzilgan qiymat ham", () => {
  const none = { mode: "saralangan", sources: [], regions: [], trucks: [] };
  assert.deepEqual(feedOf({ vehicle: FURA }), none);
  assert.deepEqual(feedOf({ feed: { mode: "boshqa" } }), none);
  assert.deepEqual(feedOf(null), none);
  assert.equal(feedNeedsVehicle("tezkor"), false);
  assert.equal(feedNeedsVehicle("guruhlarim_plus"), true);
  assert.equal(usesRawFeed({ feed: { mode: "tezkor" } }), true);
  assert.equal(usesRawFeed({}), false);
});

test("sanitizeFeed: guruh rejimida kamida bitta guruh, nomlar tekshiriladi, takror (harf farqi ham) tashlanadi", () => {
  assert.deepEqual(sanitizeFeed(undefined).feed, { mode: "saralangan", sources: [] });
  assert.deepEqual(sanitizeFeed({ mode: "tezkor", sources: ["@TutGruz"] }).feed, { mode: "tezkor", sources: [] });
  assert.equal(sanitizeFeed({ mode: "guruhlarim", sources: [] }).field, "groups");
  assert.equal(sanitizeFeed({ mode: "uchish" }).field, "feed");
  const { feed } = sanitizeFeed({ mode: "guruhlarim", sources: ["@TutGruz", "@tutgruz", "-1001234567", "yomon nom", 5, "@ab"] });
  assert.deepEqual(feed.sources, ["@TutGruz", "-1001234567"]);
});

test("kim nimani oladi: rawWanted / sortedWanted", () => {
  const sorted = { feed: { mode: "saralangan", sources: [] } };
  const fast = { feed: { mode: "tezkor", sources: [] } };
  const mine = { feed: { mode: "guruhlarim", sources: ["@TutGruz"] } };
  const plus = { feed: { mode: "guruhlarim_plus", sources: ["@TutGruz"] } };
  assert.equal(rawWanted(sorted, "@TutGruz"), false);
  assert.equal(sortedWanted(sorted, "@TutGruz"), true);
  assert.equal(rawWanted(fast, "@boshqa_guruh"), true);
  assert.equal(sortedWanted(fast, "@boshqa_guruh"), false);
  assert.equal(rawWanted(mine, "@tutgruz"), true, "harf katta-kichikligi farq qilmaydi");
  assert.equal(rawWanted(mine, "@boshqa_guruh"), false);
  assert.equal(sortedWanted(mine, "@boshqa_guruh"), false);
  assert.equal(rawWanted(plus, "@TutGruz"), true);
  assert.equal(sortedWanted(plus, "@TutGruz"), false, "tanlagan guruhidagisi — asl matn bilan ketgan");
  assert.equal(sortedWanted(plus, "@boshqa_guruh"), true);
});

test("sanitizeProfile: tezkor va guruhlarimda mashina shart emas, saralanganda — shart", () => {
  const fast = sanitizeProfile({ feed: { mode: "tezkor" } });
  assert.equal(fast.error, undefined);
  assert.equal(fast.profile.vehicle, null);
  assert.deepEqual(fast.profile.feed, { mode: "tezkor", sources: [] });
  // Avval kiritilgan mashina tezkorda ham saqlanadi (saralanganga qaytsa — qayta so'ralmaydi)
  assert.equal(sanitizeProfile({ vehicle: FURA, feed: { mode: "tezkor" } }).profile.vehicle.truckClass, "fura");
  assert.match(sanitizeProfile({ feed: { mode: "guruhlarim_plus", sources: ["@TutGruz"] } }).error, /Transport turini/);
  assert.match(sanitizeProfile({ feed: { mode: "guruhlarim", sources: [] } }).error, /guruh/);
  assert.match(sanitizeProfile({ feed: { mode: "saralangan" } }).error, /Transport turini/);
});

test("withPrevFeed: rejimsiz forma eski rejimni o'chirmaydi", () => {
  const prev = { feed: { mode: "tezkor", sources: [] } };
  assert.deepEqual(withPrevFeed({ vehicle: FURA }, prev).feed, prev.feed);
  assert.deepEqual(withPrevFeed({ vehicle: FURA, feed: { mode: "saralangan" } }, prev).feed, { mode: "saralangan" });
  assert.equal(withPrevFeed({ vehicle: FURA }, null).feed, undefined);
});

test("profil matni: mashinasiz rejimda faqat rejim va guruhlar", () => {
  const mine = { vehicle: null, feed: { mode: "guruhlarim", sources: ["@TutGruz", "-1001234567"] } };
  assert.deepEqual(profileRows(mine).map((r) => r.id), ["feed", "groups"]);
  const names = { "@TutGruz": "Tut Gruz", "-1001234567": "Yopiq guruh" };
  assert.equal(describeProfile(mine, "qoshni", "haydovchi", { sourceName: (n) => names[n] }), "🎛 Rejim: 📌 Faqat men tanlaydigan guruhlar\n📌 Guruhlar: Tut Gruz, Yopiq guruh");
  assert.equal(describeProfile({ feed: { mode: "tezkor" } }), "🎛 Rejim: 🌐 Hamma guruhlar");
  assert.equal(describeProfile({ feed: { mode: "tezkor", trucks: ["fura"], regions: ["buxoro"] } }), "🎛 Rejim: 🌐 Hamma guruhlar\n🚚 Transport turi: Fura\n📍 Qayerdan: Buxoro viloyati");
  assert.equal(feedLabel(mine), "📌 Faqat men tanlaydigan guruhlar (2 ta guruh)");
  const plus = { vehicle: FURA, feed: { mode: "guruhlarim_plus", sources: ["@a1234"] }, domestic: true, international: false };
  assert.deepEqual(profileRows(plus).map((r) => r.id).slice(0, 3), ["feed", "groups", "vehicle"]);
});

test("sortedReady / profileReady / rawProfile: mashinasiz profil qaysi rejimda ishlaydi", () => {
  const plusNoVehicle = { vehicle: null, feed: { mode: "guruhlarim_plus", sources: ["@TutGruz"] } };
  assert.equal(sortedReady({ vehicle: FURA }), true, "eski profil — saralangan");
  assert.equal(sortedReady({ vehicle: null, feed: { mode: "tezkor" } }), false);
  assert.equal(sortedReady(plusNoVehicle), false, "«+ saralangan» mashinasiz — faqat guruhlari");
  assert.equal(sortedReady({ vehicle: FURA, feed: { mode: "guruhlarim_plus", sources: ["@TutGruz"] } }), true);
  assert.equal(profileReady(null), false);
  assert.equal(profileReady({ vehicle: null, feed: { mode: "tezkor" } }), true);
  assert.equal(profileReady({ vehicle: null }), false, "saralanganga mashina kerak");
  assert.equal(profileReady(plusNoVehicle), false);
  // Bot rejimni saqlaganda: eski mashina va yo'nalish qoladi, rejim almashadi
  const prev = { vehicle: FURA, domestic: true, international: true, fromAreas: ["andijon"], toAreas: [], routeAt: 5, mode: "own" };
  assert.deepEqual(rawProfile({ mode: "tezkor", sources: [] }, prev), { ...prev, feed: { mode: "tezkor", sources: [] } });
  assert.deepEqual(rawProfile({ mode: "tezkor", sources: [] }), {
    vehicle: null,
    domestic: true,
    international: false,
    fromAreas: [],
    toAreas: [],
    routeAt: null,
    mode: "own",
    feed: { mode: "tezkor", sources: [] },
  });
  // Profil matni: «+ saralangan» da mashina hali yo'q — «kiritilmagan»
  const rows = profileRows(plusNoVehicle);
  assert.deepEqual(rows.map((r) => r.id), ["feed", "groups", "vehicle"]);
  assert.equal(rows.at(-1).value, "kiritilmagan");
});

test("filtrlar (2026-11-19): qayerdan va transport — ixtiyoriy, har ikki rejimda; topilmasa — baribir keladi", async () => {
  const { sanitizeFeed, feedOf, regionWanted, truckWanted, filtersWanted, truckFilterOf, rawWanted, feedLabel, FEED_MODE_CHOICES } = await import("../src/feed.js");
  assert.deepEqual(FEED_MODE_CHOICES, ["tezkor", "guruhlarim"]);
  assert.deepEqual(sanitizeFeed({ mode: "tezkor", regions: ["samarqand", "yoq", "samarqand"], trucks: ["isuzu", "kamaz", "fura"] }), { feed: { mode: "tezkor", sources: [], regions: ["samarqand"], trucks: ["fura", "isuzu"] } });
  assert.deepEqual(sanitizeFeed({ mode: "tezkor", regions: [] }), { feed: { mode: "tezkor", sources: [] } }, "bo'sh — filtrsiz, xato emas");
  assert.deepEqual(sanitizeFeed({ mode: "hududim", regions: ["buxoro"] }).feed, { mode: "tezkor", sources: [], regions: ["buxoro"] }, "eski ilova");
  assert.deepEqual(sanitizeFeed({ mode: "guruhlarim", sources: ["@TutGruz"], trucks: ["labo"] }).feed, { mode: "guruhlarim", sources: ["@TutGruz"], trucks: ["labo"] });
  // Eski «hududim» profil — tezkor + viloyatlar
  const old = { feed: { mode: "hududim", sources: [], regions: ["samarqand"] } };
  assert.deepEqual(feedOf(old), { mode: "tezkor", sources: [], regions: ["samarqand"], trucks: [] });
  assert.equal(rawWanted(old, "@istalgan"), true);
  assert.equal(regionWanted(old, ["samarqand", "buxoro"]), true);
  assert.equal(regionWanted(old, ["andijon"]), false);
  assert.equal(regionWanted(old, []), true, "joyi topilmagan — baribir");
  assert.equal(regionWanted({ feed: { mode: "tezkor" } }, ["andijon"]), true, "viloyat tanlanmagan");
  // Transport: sinf → to'rt turdan biri
  assert.equal(truckFilterOf("katta_fura"), "fura");
  assert.equal(truckFilterOf("mini_fura"), "fura");
  assert.equal(truckFilterOf("katta_isuzu"), "isuzu");
  assert.equal(truckFilterOf("kichik"), "bongo");
  assert.equal(truckFilterOf("yengil_avto"), "labo");
  assert.equal(truckFilterOf(null), null);
  const isuzu = { feed: { mode: "guruhlarim", sources: ["@a1234"], trucks: ["isuzu"] } };
  assert.equal(truckWanted(isuzu, ["isuzu"]), true);
  assert.equal(truckWanted(isuzu, ["fura"]), false);
  assert.equal(truckWanted(isuzu, ["fura", "katta_isuzu"]), true, "bir nechta tur — biri mos bo'lsa yetadi");
  assert.equal(truckWanted(isuzu, []), true, "mashina yozilmagan — baribir");
  assert.equal(truckWanted({ feed: { mode: "tezkor" } }, ["fura"]), true, "tur tanlanmagan");
  const both = { feed: { mode: "tezkor", regions: ["buxoro"], trucks: ["fura"] } };
  assert.equal(filtersWanted(both, { origins: ["buxoro"], trucks: ["fura"] }), true);
  assert.equal(filtersWanted(both, { origins: ["buxoro"], trucks: ["isuzu"] }), false);
  assert.equal(filtersWanted(both, { origins: ["andijon"], trucks: [] }), false);
  assert.equal(filtersWanted(both, { origins: [], trucks: [] }), true);
  assert.equal(feedLabel(both), "🌐 Hamma guruhlar · 🚚 Fura · 📍 Buxoro viloyati");
});

test("regionWanted: «qayerdan» aytilmagan — hammaga; aytilgan, lekin noma'lum joy — viloyat tanlaganlarga yo'q (2026-11-19)", async () => {
  const { regionWanted, filtersWanted } = await import("../src/feed.js");
  const fargona = { feed: { mode: "tezkor", sources: [], regions: ["fargona"] } };
  const anyone = { feed: { mode: "tezkor", sources: [] } };
  assert.equal(regionWanted(fargona, []), true, "qayerdan yo'q — universal");
  assert.equal(regionWanted(fargona, [], { unknown: true }), false);
  assert.equal(regionWanted(anyone, [], { unknown: true }), true, "filtrsiz haydovchiga hammasi");
  assert.equal(regionWanted(fargona, ["fargona", "toshkent"], { unknown: true }), true);
  assert.equal(filtersWanted(fargona, { origins: [], originUnknown: true, trucks: [] }), false);
  assert.equal(filtersWanted(fargona, { origins: ["xorazm"], trucks: [] }), false);
  assert.equal(filtersWanted(fargona, { origins: ["fargona"], trucks: [] }), true);
});

test("rawLoadWanted: ilovadagi «Menga mos» — guruh + Qayerdan + Transport (bot qoidasi)", () => {
  const fast = { feed: { mode: "tezkor", sources: [], regions: ["fargona"], trucks: ["isuzu"] } };
  assert.equal(rawLoadWanted(fast, { fromRegion: "fargona", truckClass: "isuzu" }, "@a"), true);
  assert.equal(rawLoadWanted(fast, { fromRegion: "toshkent", truckClass: "isuzu" }, "@a"), false, "boshqa viloyat");
  assert.equal(rawLoadWanted(fast, { fromRegion: "fargona", truckClass: "fura" }, "@a"), false, "boshqa transport");
  assert.equal(rawLoadWanted(fast, { fromRegion: null, truckClass: null }, "@a"), true, "joyi va mashinasi yo'q — hammaga");
  const mine = { feed: { mode: "guruhlarim", sources: ["@Bizniki"] } };
  assert.equal(rawLoadWanted(mine, { fromRegion: "fargona" }, "@bizniki"), true);
  assert.equal(rawLoadWanted(mine, { fromRegion: "fargona" }, "@begona"), false, "tanlanmagan guruh");
});
