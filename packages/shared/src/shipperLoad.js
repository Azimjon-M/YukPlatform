// Yuk beruvchining O'Z yuki (2026-11-10, Azimjon: «Botni endi Yuk beruvchi ro'lini kiritsak. Forma va oddiy yozish bo'lsin»).
// Ikki yo'l: web forma («📦 Yuk berish», apps/web LoadFormPage) va botga oddiy xabar (apps/bot shipperLoads.js — AI yoki
// qoidaviy parser tushunadi, yuk beruvchi tasdiqlaydi). Ikkalasi ham shu yerdagi yuk ko'rinishiga keladi — parser
// guruh e'lonidan chiqaradigan yuk bilan bir xil, shuning uchun haydovchiga boradigan yo'l bitta (bot pipeline.js handleParsed).
// Formadan kelgan ma'lumotga ishonmaymiz: har maydon ro'yxat va chegaradan o'tadi (sanitizeShipperLoad).
import { BODY_TYPE_IDS, TRUCK_CLASS_IDS, bodyId } from "./vehicles.js";
import { CURRENCIES, PAYMENT_TYPE_IDS, PRICE_UNIT_IDS, cargoCategory } from "./categories.js";
import { HOME_COUNTRY, REGION_IDS } from "./regions.js";
import { normalizePlaces } from "./places.js";
import { routeAreas } from "./route.js";
import { routeInScope, scopeCountries } from "./scope.js";
import { typedPhone } from "./contact.js";
import { cargoText, placeText, priceText, vehicleText } from "./loadText.js";

// Bitta yuk beruvchidan 24 soatda ko'pi bilan shuncha e'lon (Azimjon: «Darhol, kunlik limit bilan» — spamga qarshi;
// spam qilsa — boshqaruv markazidan bloklanadi). Bitta e'londa bir nechta yuk bo'lishi mumkin (botga yozilgan ro'yxat)
export const SHIPPER_LOAD_LIMIT = 20;
// Yukdagi telefon raqamlari: kamida 1 ta, ko'pi bilan 2 ta (Azimjon: raqam ULASHILMAYDI, YOZILADI — o'zinikidan boshqa
// raqam ham bo'lishi mumkin: dispetcher, omborchi)
export const SHIPPER_LOAD_PHONES = 2;
// Matn maydonlari chegarasi (belgi)
export const SHIPPER_LOAD_LIMITS = { city: 40, cargo: 80, when: 60, note: 300, weightT: [0.01, 100], price: [1, 10_000_000_000], vehicleCount: [1, 20] };

// Qayerdan / qayerga tanlanadigan joylar: viloyatlar (Toshkent shahri ham) + doiradagi qo'shni davlatlar
// ("hammasi" doirasida — Xorij). Haydovchi yo'nalishidagi ro'yxat bilan bir xil (route.js routeAreas)
export const shipperLoadAreas = (scope) => routeAreas({ international: true }, scope);

const text = (value, max) => {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};
const number = (value) => {
  if (value === "" || value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const inRange = (n, [min, max]) => n >= min && n <= max;

// Joy: viloyat kodi → shu viloyat (O'zbekiston); davlat nomi → o'sha davlat; "xorij" — davlati shahardan aniqlanadi
function placeOf(area, city) {
  if (REGION_IDS.includes(area) && area !== "xorij") return { region: area, country: HOME_COUNTRY, city };
  if (area === "xorij") return { region: "xorij", country: null, city };
  return { region: "xorij", country: area, city };
}

// Raqamlar: yozilganlari (bo'shlari tashlanadi) → ["+998901234567"] yoki { error }
export function shipperPhones(list) {
  const raw = (Array.isArray(list) ? list : [list]).map((p) => String(p ?? "").trim()).filter(Boolean);
  if (raw.length === 0) return { error: "Telefon raqamini yozing — haydovchilar shu raqamga qo'ng'iroq qiladi" };
  const phones = [];
  for (const item of raw) {
    const phone = typedPhone(item);
    if (!phone) return { error: `Raqam noto'g'ri: «${item.slice(0, 20)}». Masalan: 90 123 45 67` };
    if (!phones.includes(phone)) phones.push(phone);
  }
  if (phones.length > SHIPPER_LOAD_PHONES) return { error: `Ko'pi bilan ${SHIPPER_LOAD_PHONES} ta raqam` };
  return { phones };
}

// Formadan kelgan yuk → { load } yoki { error, field } (field — qaysi maydon: forma o'sha joyni ko'rsatadi).
// input: { from, fromCity, to, toCity, cargo, weight, weightUnit ("tonna" | "kg"), truckClass, bodyType, vehicleCount,
//          price, currency, priceUnit, negotiable, payment, when, note, phones: ["90 123 45 67", ...] }
// from / to — shipperLoadAreas dagi id (viloyat kodi yoki davlat nomi). Shahar ixtiyoriy: ro'yxatimizda bo'lsa,
// viloyati ro'yxatdan olinadi (places.js normalizePlaces), yo'q bo'lsa — yozilganicha qoladi.
// scope — .env dagi ROUTE_SCOPE (doiradan tashqaridagi yuk qabul qilinmaydi)
export function sanitizeShipperLoad(input, { scope } = {}) {
  if (!input || typeof input !== "object") return { error: "Ma'lumot kelmadi" };
  const L = SHIPPER_LOAD_LIMITS;
  const areas = new Set(shipperLoadAreas(scope).map((a) => a.id));
  if (!areas.has(input.from)) return { error: "Yuk qayerdan olinishini tanlang", field: "from" };
  if (!areas.has(input.to)) return { error: "Yuk qayerga borishini tanlang", field: "to" };

  const weight = number(input.weight);
  if (weight == null) return { error: "Yuk og'irligini yozing", field: "weight" };
  const weightT = input.weightUnit === "kg" ? weight / 1000 : weight;
  if (Number.isNaN(weight) || !inRange(weightT, L.weightT)) return { error: "Og'irlik noto'g'ri (10 kg dan 100 tonnagacha)", field: "weight" };

  const price = number(input.price);
  if (Number.isNaN(price) || (price != null && !inRange(price, L.price))) return { error: "Narx noto'g'ri", field: "price" };
  const count = number(input.vehicleCount);
  if (Number.isNaN(count) || (count != null && !inRange(count, L.vehicleCount))) return { error: "Mashina soni 1 dan 20 gacha", field: "vehicleCount" };

  const { phones, error } = shipperPhones(input.phones);
  if (error) return { error, field: "phones" };

  const from = placeOf(input.from, text(input.fromCity, L.city));
  const to = placeOf(input.to, text(input.toCity, L.city));
  const truckClass = TRUCK_CLASS_IDS.includes(input.truckClass) ? input.truckClass : null;
  const body = bodyId(input.bodyType);
  const raw = {
    fromCity: from.city,
    fromPlace: null,
    fromRegion: from.region,
    fromCountry: from.country,
    toCity: to.city,
    toPlace: null,
    toRegion: to.region,
    toCountry: to.country,
    cargo: text(input.cargo, L.cargo),
    weightT: Math.round(weightT * 1000) / 1000,
    volumeM3: null,
    pallets: null,
    truckClass,
    bodyType: BODY_TYPE_IDS.includes(body) && body !== "boshqa" ? body : null,
    vehicleCount: count != null ? Math.round(count) : null,
    loadingSides: [],
    partial: false,
    price: price != null ? Math.round(price) : null,
    priceUnit: price != null && PRICE_UNIT_IDS.includes(input.priceUnit) ? input.priceUnit : price != null ? "reys" : null,
    currency: price != null ? (CURRENCIES.includes(input.currency) ? input.currency : "UZS") : null,
    payment: PAYMENT_TYPE_IDS.includes(input.payment) ? input.payment : null,
    negotiable: input.negotiable === true,
    when: text(input.when, L.when),
    note: text(input.note, L.note),
    phones,
  };
  const placed = normalizePlaces(raw);
  const load = { ...placed, category: cargoCategory(placed) };
  if (!routeInScope(load, scope)) {
    const abroad = scopeCountries(scope).length > 0;
    return {
      error: abroad
        ? "Hozircha faqat O'zbekiston ichidagi va O'zbekiston bilan qo'shni davlatlar orasidagi yuklar"
        : "Hozircha faqat O'zbekiston ichidagi yuklar",
      field: "to",
    };
  }
  return { load };
}

// Yuk → forma maydonlari (botda tushunilgan yukni «✏️ Formada tuzatish» bilan ochganda; formani qayta to'ldirishda).
// Davlat/viloyat shipperLoadAreas dagi id ga keltiriladi; ro'yxatda yo'q joy — bo'sh (foydalanuvchi tanlaydi)
export function shipperLoadForm(load, scope) {
  const areas = new Set(shipperLoadAreas(scope).map((a) => a.id));
  const area = (side) => {
    const region = load?.[`${side}Region`];
    const country = load?.[`${side}Country`];
    const id = region && region !== "xorij" ? region : (country ?? (region === "xorij" ? "xorij" : null));
    if (areas.has(id)) return id;
    return region === "xorij" && areas.has("xorij") ? "xorij" : "";
  };
  const kg = load?.weightT != null && load.weightT < 1;
  return {
    from: area("from"),
    fromCity: load?.fromCity ?? load?.fromPlace ?? "",
    to: area("to"),
    toCity: load?.toCity ?? load?.toPlace ?? "",
    cargo: load?.cargo ?? "",
    weight: load?.weightT == null ? "" : String(kg ? Math.round(load.weightT * 1000) : load.weightT),
    weightUnit: kg ? "kg" : "tonna",
    truckClass: load?.truckClass ?? null,
    bodyType: load?.bodyType ? bodyId(load.bodyType) : null,
    vehicleCount: load?.vehicleCount > 1 ? String(load.vehicleCount) : "",
    price: load?.price == null ? "" : String(load.price),
    currency: load?.currency ?? "UZS",
    priceUnit: load?.priceUnit ?? "reys",
    negotiable: load?.negotiable === true,
    payment: load?.payment ?? null,
    when: load?.when ?? "",
    note: load?.note ?? "",
    phones: load?.phones?.length ? load.phones.slice(0, SHIPPER_LOAD_PHONES) : [],
  };
}

// Formadan kelgan yukning matni (posts.text — boshqaruv markazining «Navbat» bo'limida shunday ko'rinadi):
// "Andijon, Asaka → Toshkent · un · 20 tonna · Fura · tent · 3 000 000 so'm · +998901234567"
export function shipperLoadText(load) {
  return [
    `${placeText(load, "from")} → ${placeText(load, "to")}`,
    cargoText(load),
    vehicleText(load),
    load.price != null || load.negotiable ? priceText(load) : null,
    load.when,
    load.note,
    (load.phones ?? []).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}
