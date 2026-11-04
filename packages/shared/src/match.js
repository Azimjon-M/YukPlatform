// Yuk haydovchiga mos keladimi: mashinaga sig'adimi va haydovchi tanlagan yo'nalishdami.
// Qoidalar manbai: docs/haydovchi-suhbati.md.
//
// Haydovchi (ro'yxatdan o'tganda kiritadi):
// {
//   vehicle: {
//     truckClass: "isuzu",                 // TRUCK_CLASS_IDS
//     bodyType: "tent",                    // BODY_TYPE_IDS
//     capacityKg: 5000,                    // necha kg ko'taradi
//     body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, // kuzov ichki o'lchami → kub va palet hisoblanadi
//     loadingSides: ["orqa", "ust"],       // LOADING_SIDE_IDS; chap/o'ng — mashinaga ORQASIDAN qaraganda
//   },
//   mode: "own",              // "own" — faqat mashinamga mos yuklar; "all" — hammasini ko'rish (mashina tekshirilmaydi)
//   domestic: true,           // O'zbekiston ichidagi yuklar
//   international: false,     // xalqaro yuklar — alohida rejim
//   fromAreas: ["toshkent"],  // qayerdan yuk olaman: viloyat kodi, "xorij" (istalgan xorijiy joy) yoki davlat nomi ("Rossiya")
//   toAreas: [],              // qayerga (masalan, qaytish yuki uchun uy viloyati); bo'sh — istalgan joyga
// }
import { sameArea } from "./regions.js";
import { PALLET, TRUCK_CLASSES } from "./vehicles.js";

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
  const b = vehicle.body;
  if (!b?.lengthM || !b?.widthM) return null;
  const fit = (along, across) => Math.floor((b.lengthM - CLEARANCE_M) / along) * Math.floor((b.widthM - CLEARANCE_M) / across);
  return Math.max(fit(PALLET.lengthM, PALLET.widthM), fit(PALLET.widthM, PALLET.lengthM));
}

// Ko'tarish sig'imi, kg: o'zi yozilgan bo'lsa shu, aks holda mashina sinfining eng ko'pi
export function vehicleCapacityKg(vehicle = {}) {
  if (vehicle.capacityKg) return vehicle.capacityKg;
  const truckClass = TRUCK_CLASSES.find((t) => t.id === vehicle.truckClass);
  return truckClass ? truckClass.capacityT[1] * 1000 : null;
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

  const capacityKg = vehicleCapacityKg(vehicle);
  if (load.weightT != null && capacityKg != null && load.weightT * 1000 > capacityKg) {
    reasons.push(`og'irligi ${load.weightT} t, mashina ${capacityKg / 1000} t ko'taradi`);
  }

  const volume = vehicleVolumeM3(vehicle);
  if (load.volumeM3 != null && volume != null && load.volumeM3 > volume) {
    reasons.push(`hajmi ${load.volumeM3} kub, kuzov ${volume} kub`);
  }

  const pallets = vehiclePallets(vehicle);
  if (load.pallets != null && pallets != null && load.pallets > pallets) {
    reasons.push(`${load.pallets} ta palet, kuzovga ${pallets} ta sig'adi`);
  }

  // Isuzu haydovchisi faqat o'ziga mos yukni ko'rishni xohlaydi: sinf yozilgan bo'lsa, aynan shu sinf
  if (load.truckClass && vehicle.truckClass && load.truckClass !== vehicle.truckClass) {
    reasons.push(`${load.truckClass} kerak`);
  }

  if (load.bodyType && vehicle.bodyType && load.bodyType !== vehicle.bodyType) {
    reasons.push(`${load.bodyType} kuzov kerak`);
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

// Yuk haydovchiga yuboriladimi. "all" rejimida mashina tekshirilmaydi, yo'nalish esa doim tekshiriladi.
export function matchLoad(load, driver = {}) {
  const route = routeMatches(load, driver);
  const fit = driver.mode === "all" ? { ok: true, reasons: [] } : loadFitsVehicle(load, driver.vehicle);
  const reasons = [...route.reasons, ...fit.reasons];
  return { ok: reasons.length === 0, reasons };
}

// Yuk kimlarga yuboriladi
export function findDrivers(load, drivers) {
  return drivers.filter((driver) => matchLoad(load, driver).ok);
}
