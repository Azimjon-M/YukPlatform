import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.deepEqual(feedOf({ vehicle: FURA }), { mode: "saralangan", sources: [] });
  assert.deepEqual(feedOf({ feed: { mode: "boshqa" } }), { mode: "saralangan", sources: [] });
  assert.deepEqual(feedOf(null), { mode: "saralangan", sources: [] });
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
  assert.equal(describeProfile(mine, "qoshni", "haydovchi", { sourceName: (n) => names[n] }), "🎛 Rejim: 📌 Mening guruhlarim\n📌 Guruhlar: Tut Gruz, Yopiq guruh");
  assert.equal(describeProfile({ feed: { mode: "tezkor" } }), "🎛 Rejim: ⚡ Tezkor");
  assert.equal(feedLabel(mine), "📌 Mening guruhlarim (2 ta guruh)");
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
