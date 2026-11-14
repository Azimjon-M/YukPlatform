// Yuk haydovchiga mos keladimi: mashinaga sig'adimi va haydovchi tanlagan yo'nalishdami.
// Qoidalar manbai: docs/haydovchi-suhbati.md.
//
// Haydovchi (ro'yxatdan o'tganda kiritadi):
// {
//   vehicle: {
//     truckClass: "isuzu",                 // TRUCK_CLASS_IDS (katta_isuzu ham "isuzu" yuklarini oladi — truckFamily)
//     truckClasses: ["isuzu", "labo"],     // faqat bir nechta tanlansa (vehicles.js vehicleClasses); unda kuzov/sig'im/o'lcham yo'q
//     bodyType: "tent",                    // BODY_TYPE_IDS (ref izotermik yukni ham oladi — BODY_ACCEPTS)
//     capacityKg: 5000,                    // necha kg ko'taradi
//     body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, // kuzov ichki o'lchami → kub va palet hisoblanadi
//     loadingSides: ["orqa", "ust"],       // LOADING_SIDE_IDS; chap/o'ng — mashinaga ORQASIDAN qaraganda
//   },
//   mode: "own",              // eski maydon: "all" (hammasini ko'rish) 2026-11-07 dan e'tiborsiz — faqat mashinaga mos yuk
//   domestic: true,           // O'zbekiston ichidagi yuklar
//   international: false,     // xalqaro yuklar — alohida rejim
//   fromAreas: ["toshkent"],  // qayerdan yuk olaman: viloyat kodi, "xorij" (istalgan xorijiy joy) yoki davlat nomi ("Rossiya")
//   toAreas: [],              // qayerga (masalan, qaytish yuki uchun uy viloyati); bo'sh — istalgan joyga
//                             // (ikkalasi ham botdagi «📋 Mos yuklar» da tanlanadi, formada emas)
// }
import { sameArea } from "./regions.js";
import { BODY_ACCEPTS, PALLET, bodyId, bodyTypeOf, countsPallets, truckClassOf, truckFamily, vehicleClasses } from "./vehicles.js";
import { weightText } from "./loadText.js";

const HOME = "O'zbekiston";

// Kuzov hajmi, kub: o'zi yozilgan bo'lsa shu, aks holda uzunlik × eni × balandligi
export function vehicleVolumeM3(vehicle = {}) {
  if (vehicle.volumeM3) return vehicle.volumeM3;
  const b = vehicle.body;
  if (!b?.lengthM || !b?.widthM || !b?.heightM) return null;
  return Math.round(b.lengthM * b.widthM * b.heightM * 10) / 10;
}

// Kuzovga nechta yevropalet (1.2 × 0.8 m) bir qavat bo'lib sig'adi — ikki xil burib qo'yishdan kattasi.
// Devorga 2 sm bo'shliq qoldiriladi: 17 × 0.8 = 13.6 m qog'ozda sig'adi, amalda yo'q. 13.6 × 2.45 m furaga 33 ta.
const CLEARANCE_M = 0.02;
export function vehiclePallets(vehicle = {}) {
  if (vehicle.pallets) return vehicle.pallets;
  if (!countsPallets(vehicle.bodyType)) return null; // samosval, sisterna... — palet qo'yilmaydi
  const b = vehicle.body;
  if (!b?.lengthM || !b?.widthM) return null;
  const fit = (along, across) => Math.floor((b.lengthM - CLEARANCE_M) / along) * Math.floor((b.widthM - CLEARANCE_M) / across);
  return Math.max(fit(PALLET.lengthM, PALLET.widthM), fit(PALLET.widthM, PALLET.lengthM));
}

// Ko'tarish sig'imi, kg: o'zi yozilgan bo'lsa shu, aks holda mashina sinfining eng ko'pi.
// Bir nechta transport tanlangan bo'lsa — yukka mos sinflardan (sinf yozilmagan yukda — hammasidan) eng kattasi
export function vehicleCapacityKg(vehicle = {}, load = null) {
  if (vehicle.capacityKg) return vehicle.capacityKg;
  const all = vehicleClasses(vehicle);
  const fitting = load?.truckClass ? all.filter((id) => truckFamily(id) === truckFamily(load.truckClass)) : [];
  const tonnes = (fitting.length ? fitting : all).map((id) => truckClassOf(id)?.capacityT[1]).filter((t) => t != null);
  return tonnes.length ? Math.max(...tonnes) * 1000 : null;
}

// Yuk xorijga bog'liqmi (qayerdan yoki qayerga O'zbekistondan tashqarida)
export function isInternational(load) {
  const abroad = (region, country) => region === "xorij" || (country != null && country !== HOME);
  return abroad(load.fromRegion, load.fromCountry) || abroad(load.toRegion, load.toCountry);
}

// Yuk mashinaga sig'adimi. Yukda yozilmagan narsa tekshirilmaydi (yozilmagan = cheklov yo'q).
// → { ok, reasons } — reasons: nega mos emasligi, haydovchiga tushunarli tilda
export function loadFitsVehicle(load, vehicle = {}) {
  const reasons = [];

  const capacityKg = vehicleCapacityKg(vehicle, load);
  if (load.weightT != null && capacityKg != null && load.weightT * 1000 > capacityKg) {
    reasons.push(`og'irligi ${weightText(load.weightT)}, mashina ${weightText(capacityKg / 1000)} ko'taradi`);
  }

  const volume = vehicleVolumeM3(vehicle);
  if (load.volumeM3 != null && volume != null && load.volumeM3 > volume) {
    reasons.push(`hajmi ${load.volumeM3} kub, kuzov ${volume} kub`);
  }

  const pallets = vehiclePallets(vehicle);
  if (load.pallets != null && pallets != null && load.pallets > pallets) {
    reasons.push(`${load.pallets} ta palet, kuzovga ${pallets} ta sig'adi`);
  }

  // Isuzu haydovchisi faqat o'ziga mos yukni ko'rishni xohlaydi: sinf yozilgan bo'lsa, aynan shu sinf.
  // AI "katta fura" ni ham "fura" deydi — katta fura haydovchisi fura yuklarini oladi, og'irligini yuqorida tekshirdik.
  // Bir nechta transport tanlagan haydovchiga — shulardan birortasiga mos yuk
  const classes = vehicleClasses(vehicle);
  if (load.truckClass && classes.length && !classes.some((id) => truckFamily(id) === truckFamily(load.truckClass))) {
    reasons.push(`${truckClassOf(load.truckClass)?.name ?? load.truckClass} kerak`);
  }

  if (!bodyFits(load.bodyType, vehicle.bodyType)) {
    reasons.push(`${bodyTypeOf(load.bodyType)?.name ?? load.bodyType} kuzov kerak`);
  }

  // Yuklash tomoni: e'londagi tomonlardan BIRORTASI mashinada bo'lsa yetadi
  // ("orqadan yoki yonidan" ko'p uchraydi). "yon" (qaysi yoni aytilmagan) — chap yoki o'ng ham bo'ladi.
  const sides = load.loadingSides ?? [];
  if (sides.length && vehicle.loadingSides?.length) {
    const has = new Set(vehicle.loadingSides);
    const supported = (side) => has.has(side) || (side === "yon" && (has.has("chap") || has.has("ong")));
    if (!sides.some(supported)) reasons.push(`yuklash: ${sides.join("/")}`);
  }

  return { ok: reasons.length === 0, reasons };
}

// Yukka kerak kuzov (yoki aytilmagan) shu mashinada bormi. Eski kodlar (bort → plashatka) yangisiga o'giriladi
export function bodyFits(need, has) {
  const a = bodyId(need);
  const b = bodyId(has);
  if (!a || !b || a === "boshqa" || b === "boshqa") return true;
  return a === b || (BODY_ACCEPTS[b] ?? []).includes(a);
}

// Joy haydovchi tanlagan hududlardan biriga tushadimi.
// Hudud: viloyat kodi (Toshkent shahri = viloyati), "xorij" yoki davlat nomi.
function inAreas(region, country, areas) {
  if (!areas?.length) return true;
  return areas.some((area) => sameArea(area, region) || (country != null && area === country));
}

// Yuk haydovchi tanlagan yo'nalishdami. Faqat viloyat yozilgan yuk shu viloyatdagi haydovchilarga boradi.
export function routeMatches(load, driver = {}) {
  const reasons = [];
  const international = isInternational(load);
  if (international && !driver.international) reasons.push("xalqaro yuk");
  if (!international && driver.domestic === false) reasons.push("O'zbekiston ichidagi yuk");
  if (!inAreas(load.fromRegion, load.fromCountry, driver.fromAreas)) reasons.push("boshqa joydan");
  if (!inAreas(load.toRegion, load.toCountry, driver.toAreas)) reasons.push("boshqa joyga");
  return { ok: reasons.length === 0, reasons };
}

// Yuk haydovchiga yuboriladimi: yo'nalish va mashina doim tekshiriladi. Eski «hammasini ko'rish» (mode "all") rejimi
// olib tashlandi (Azimjon, 2026-11-07: «faqat transportiga mos yukni jo'natish kerak») — bazadagi eski profillarda ham
export function matchLoad(load, driver = {}) {
  const route = routeMatches(load, driver);
  const fit = loadFitsVehicle(load, driver.vehicle);
  const reasons = [...route.reasons, ...fit.reasons];
  return { ok: reasons.length === 0, reasons };
}

// Yuk kimlarga yuboriladi
export function findDrivers(load, drivers) {
  return drivers.filter((driver) => matchLoad(load, driver).ok);
}

// --- Bo'sh mashina ↔ yuk beruvchi ---
// truck — parserning "mashina_bor" yozuvi (yuk maydonlarida): fromRegion/fromCountry — mashina qayerda yuk oladi,
//   toRegion/toCountry — qayerga boradi, truckClass, bodyType, weightT — necha tonna ko'taradi.
// shipper — yuk beruvchi profili (profile.js sanitizeShipperProfile).
// Qoida yuklarnikidek: e'londa yozilmagan narsa cheklov emas. Bo'sh mashina e'lonlarida "qayerga" ko'pincha
// yozilmaydi ("Samarqanddan yuk olaman") — demak istalgan joyga boradi, yuk beruvchiga baribir yuboriladi.
export function matchTruck(truck, shipper = {}) {
  const reasons = [];
  const international = isInternational(truck);
  if (international && !shipper.international) reasons.push("xalqaro mashina");
  if (!international && shipper.domestic === false) reasons.push("O'zbekiston ichidagi mashina");

  const known = (side) => truck[`${side}Region`] != null || truck[`${side}Country`] != null;
  if (known("from") && !inAreas(truck.fromRegion, truck.fromCountry, shipper.fromAreas)) reasons.push("boshqa joyda");
  if (known("to") && !inAreas(truck.toRegion, truck.toCountry, shipper.toAreas)) reasons.push("boshqa tomonga boradi");

  // Yuk beruvchi «Katta fura» ni tanlagan bo'lsa — AI "fura" degan bo'sh mashinalar ham (sinf oilasi bo'yicha)
  if (truck.truckClass && shipper.truckClasses?.length && !shipper.truckClasses.some((id) => truckFamily(id) === truckFamily(truck.truckClass))) {
    reasons.push(`${truckClassOf(truck.truckClass)?.name ?? truck.truckClass} kerak emas`);
  }
  if (truck.bodyType && shipper.bodyTypes?.length && !shipper.bodyTypes.some((id) => bodyFits(id, truck.bodyType))) {
    reasons.push(`${bodyTypeOf(truck.bodyType)?.name ?? truck.bodyType} kuzov kerak emas`);
  }
  return { ok: reasons.length === 0, reasons };
}

// E'lon turi (loads.kind) → qaysi tekshiruv: yuk — haydovchiga, mashina — yuk beruvchiga (roles.js KIND_ROLE)
export const KIND_MATCHERS = { yuk: matchLoad, mashina: matchTruck };
