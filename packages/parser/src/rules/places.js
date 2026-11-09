// Qoidaviy parser uchun joy nomlari lug'ati: shahar, viloyat, Toshkent tumanlari, davlatlar.
// Asosi @yuk/shared (regions.js) — AI ham, bot ham shu ro'yxatni ishlatadi. Bu yerda faqat qoidalarga kerak
// qo'shimchalar: viloyat nomining yozilishlari, davlat nomlari, AI'siz topish qiyin bo'lgan qisqartmalar.
import { COUNTRIES, REGIONS, TASHKENT_DISTRICTS } from "@yuk/shared";
import { allowedTypos, editDistance, wordKey } from "./text.js";

// Viloyat nomlari: e'londa "Surxondaryodan", "Qashqadaryoga" — shahar emas, viloyat (AI ham shahar yozmaydi).
// Viloyat markazi bilan bir xil nomlilari (Andijon, Namangan...) shahar sifatida regions.js da bor.
const REGION_WORDS = {
  toshkent: ["Toshkent viloyati", "Toshkent vil", "Toshkent obl", "Ташкентская область", "Ташкент обл", "Tashkent obl"],
  sirdaryo: ["Sirdaryo", "Sirdarya", "Сирдарё", "Сырдарья", "Sirdaryo viloyati"],
  qashqadaryo: ["Qashqadaryo", "Qashqadarya", "Кашкадарья", "Қашқадарё", "Кашкадарё", "Qashqadaryo viloyati"],
  surxondaryo: ["Surxondaryo", "Surxandaryo", "Surxandarya", "Сурхандарья", "Сурхондарё", "Сурхандарё", "Surxondaryo viloyati"],
  xorazm: ["Xorazm", "Xorazim", "Horazm", "Хорезм", "Хоразм", "Xorazm viloyati"],
  qoraqalpogiston: ["Qoraqalpog'iston", "Qoraqalpoq", "Qoraqalpoqiston", "Karakalpak", "Karakalpakstan", "Каракалпакстан", "Каракалпак", "Каракалпок", "Qoraqalpog'iston Respublikasi"],
  // Farg'ona vodiysi — uchta viloyat, bittasini tanlab bo'lmaydi: joy sifatida noaniq (pastda AMBIGUOUS)
};

// Davlat nomlarining yozilishlari (shahar emas — city null bo'ladi)
const COUNTRY_WORDS = {
  // "KG" (kg — kilogramm), "РК", "РБ" kabi qisqartmalar yo'q: oddiy so'z bilan adashadi
  "O'zbekiston": ["O'zbekiston", "Uzbekistan", "Узбекистан", "Ўзбекистон", "Uzb", "Узб"],
  "Qozog'iston": ["Qozog'iston", "Qozoqiston", "Kazakhstan", "Kazaxstan", "Qazaqstan", "Казахстан", "Қозоғистон", "Казакстан", "Qozoq", "KZ"],
  "Qirg'iziston": ["Qirg'iziston", "Kyrgyzstan", "Kirgiziya", "Киргизия", "Кыргызстан", "Қирғизистон"],
  Tojikiston: ["Tojikiston", "Tajikistan", "Таджикистан", "Тожикистон"],
  Turkmaniston: ["Turkmaniston", "Turkmenistan", "Туркменистан", "Туркманистон"],
  "Afg'oniston": ["Afg'oniston", "Afganistan", "Afghanistan", "Афганистан", "Афғонистон"],
  Rossiya: ["Rossiya", "Russia", "Россия", "РФ", "Rassiya", "Росия", "Rosiya"],
  Belarus: ["Belarus", "Беларусь", "Беларус", "Belorussiya", "Белоруссия", "Belorus"],
  Xitoy: ["Xitoy", "China", "Китай", "Хитой", "KNR", "КНР"],
  Turkiya: ["Turkiya", "Turkey", "Турция", "Туркия", "Turkiye"],
  Eron: ["Eron", "Iran", "Иран", "Эрон"],
  Germaniya: ["Germaniya", "Germany", "Германия"],
  Polsha: ["Polsha", "Польша"],
  Litva: ["Litva", "Литва"],
  Latviya: ["Latviya", "Латвия"],
  Ukraina: ["Ukraina", "Украина"],
  Gruziya: ["Gruziya", "Грузия"],
  Ozarbayjon: ["Ozarbayjon", "Azerbaijan", "Азербайджан", "Озарбайжон"],
  Armaniston: ["Armaniston", "Armeniya", "Армения"],
};

// Ruscha nomlar (regions.js da yo'q, lekin rus tilidagi e'lonlarda ko'p): uzoq xorij shaharlari.
// Bular faqat «doiradan tashqari» deb bilish uchun: Rossiya, Belarus, Xitoy... O'zbekiston bilan chegaradosh emas.
const FAR_CITIES = {
  Rossiya: [
    "Москва", "Moskva", "Maskva", "Московская", "Moskovskaya", "Подмосковье", "Санкт-Петербург", "Петербург", "Peterburg",
    "Питер", "Piter", "Sankt-Peterburg", "Екатеринбург", "Yekaterinburg",
    "Новосибирск", "Краснодар", "Самара", "Казань", "Qozon", "Челябинск", "Омск", "Уфа", "Тюмень", "Ростов", "Ростов-на-Дону",
    "Волгоград", "Нижний Новгород", "Красноярск", "Иркутск", "Оренбург", "Саратов", "Пермь", "Сургут", "Барнаул", "Калуга",
    "Воронеж", "Томск", "Тамбов", "Кострома", "Ярославль", "Липецк", "Вологда", "Киров", "Тула", "Брянск", "Смоленск",
    "Белгород", "Курск", "Орел", "Орёл", "Рязань", "Тверь", "Иваново", "Калуга", "Kaluga", "Пенза", "Ульяновск", "Саранск", "Чебоксары",
    "Набережные Челны", "Тольятти", "Ижевск", "Кемерово", "Новокузнецк", "Хабаровск", "Владивосток", "Махачкала", "Астрахань",
    "Ставрополь", "Сочи", "Новороссийск", "Мурманск", "Архангельск", "Калининград", "Тобольск", "Шатура", "Шексна", "Егорьевск",
    "Подольск", "Люберцы", "Химки", "Энгельс", "Балабаново", "Людиново", "Шарья", "Электрогорск", "Ногинск", "Домодедово",
    "Елабуга", "Вохтога", "Нижнекамск", "Ступино", "Белореченск", "Старый Оскол",
  ],
  Belarus: ["Минск", "Minsk", "Брест", "Brest", "Гомель", "Витебск", "Могилев", "Гродно", "Борисов", "Речица"],
  Litva: ["Вильнюс", "Vilnyus", "Каунас", "Клайпеда"],
  Xitoy: ["Урумчи", "Urumchi", "Хоргос", "Horgos", "Xorgos", "Кашгар", "Qashg'ar", "Алашанькоу", "Alashankou", "Yiwu", "Улугчат", "Калжат", "Бакты"],
  Turkiya: ["Стамбул", "Istanbul", "Мерсин", "Mersin", "Измир", "Izmir", "Кахраманмараш", "Qahramonmarash"],
  Eron: ["Лютфабад", "Lyutfabad", "Тегеран", "Tehron", "Машхад", "Mashhad", "Бандар-Аббас", "Bandar Abbas"],
  Ozarbayjon: ["Баку", "Boku", "Baku"],
};

// Bir nechta joyga to'g'ri keladigan yoki oddiy so'zga o'xshagan nomlar.
// Ular faqat yo'nalish qo'shimchasi bilan (-dan / -ga) yoki «A - B» qatorida joy hisoblanadi:
// "Juma kuni yuklanadi" (juma — hafta kuni), "uzun yuk" (uzun — sifat), "shirin" (sifat), "kitob" (narsa)...
export const COMMON_WORD_PLACES = new Set(
  [
    "Juma", "Uzun", "Sariq", "Shirin", "Baxt", "Zafar", "Ibrat", "Langar", "Do'stlik", "Navbahor", "Paxtakor", "Gagarin",
    "Salar", "Bo'z", "Olot", "Kitob", "Chelak", "Mitan", "Navro'z", "Angor", "Pop", "Bog'ot", "Oqoltin", "Uchtepa", "Ravon",
    "Bo'ston", "Turkiston", "Oral", "Mari", "Farob", "Poti", "Juma", "Gazli", "Yangiobod", "Yangiqishloq", "Zarbdor", "Uychi",
  ].map(wordKey),
);

// kalit → [{ name (city|null), region, country, place (null|tuman), kind }]
const INDEX = new Map();
function add(name, entry) {
  const key = wordKey(name);
  if (!key) return;
  const list = INDEX.get(key) ?? [];
  const same = (e) => e.name === entry.name && e.region === entry.region && e.country === entry.country && e.place === entry.place;
  if (!list.some(same)) list.push(entry);
  INDEX.set(key, list);
}

const UZ = "O'zbekiston";
for (const region of REGIONS) {
  if (region.id === "xorij") continue;
  for (const city of region.cities) {
    const name = city.replace(/\s*\(.*\)$/, "");
    add(name, { name, region: region.id, country: UZ, place: null, kind: "city" });
  }
  for (const [name, variants] of Object.entries(region.aliases ?? {})) {
    for (const variant of variants) add(variant, { name, region: region.id, country: UZ, place: null, kind: "city" });
  }
}
// "Sirdaryo" regions.js da shahar ham, lekin e'lonlarda deyarli doim viloyat (AI ham 156/220 marta shahar yozmagan)
for (const [region, words] of Object.entries(REGION_WORDS)) {
  for (const word of words) {
    INDEX.delete(wordKey(word));
    add(word, { name: null, region, country: UZ, place: null, kind: "region" });
  }
}
for (const district of TASHKENT_DISTRICTS) {
  // "Uchtepa" — Jizzaxda shahar ham bor: noaniq bo'lib qoladi (ikkala yozuv)
  add(district, { name: "Toshkent", region: "toshkent_sh", country: UZ, place: district, kind: "district" });
}
// "Vodiy" (Farg'ona vodiysi) — uch viloyatdan biri: noaniq, e'lon AI'ga
for (const region of ["andijon", "fargona", "namangan"]) add("Vodiy", { name: null, region, country: UZ, place: null, kind: "region" });
// Ruscha-qozoqcha yozilishlar: "Туркистан" (Turkiston, Qozog'iston), "Казакистан"
for (const name of ["Turkistan", "Туркистан", "Туркестан", "Turkestan"]) add(name, { name: "Turkiston", region: "xorij", country: "Qozog'iston", place: null, kind: "city" });
for (const name of ["Kazakistan", "Kazakstan", "Казакистан"]) add(name, { name: null, region: "xorij", country: "Qozog'iston", place: null, kind: "country" });
// Olmaota yonidagi shahar (yuklar ko'p shu yerdan)
add("Alatau", { name: "Alatau", region: "xorij", country: "Qozog'iston", place: null, kind: "city" });
add("Алатау", { name: "Alatau", region: "xorij", country: "Qozog'iston", place: null, kind: "city" });
add("Тош", { name: "Toshkent", region: "toshkent_sh", country: UZ, place: null, kind: "city" });
add("Toshken", { name: "Toshkent", region: "toshkent_sh", country: UZ, place: null, kind: "city" });

for (const country of COUNTRIES) {
  for (const city of country.cities) add(city, { name: city, region: "xorij", country: country.name, place: null, kind: "city" });
  for (const [name, variants] of Object.entries(country.aliases ?? {})) {
    for (const variant of variants) add(variant, { name, region: "xorij", country: country.name, place: null, kind: "city" });
  }
}
for (const [country, cities] of Object.entries(FAR_CITIES)) {
  for (const city of cities) {
    // Ruscha nom regions.js dagi nom bilan bir xil bo'lsa (Moskva), o'sha yozuv qoladi
    if (INDEX.has(wordKey(city))) continue;
    add(city, { name: city, region: "xorij", country, place: null, kind: "city", foreign: true });
  }
}
for (const [country, words] of Object.entries(COUNTRY_WORDS)) {
  for (const word of words) {
    const key = wordKey(word);
    // "Turkiston" — Qozog'istondagi shahar, "Turkiya" — davlat: kalitlari har xil. Bir xil bo'lsa — davlat ustun
    INDEX.delete(key);
    add(word, { name: null, region: country === UZ ? null : "xorij", country, place: null, kind: "country" });
  }
}

// Bir so'zli kalitlar fuzzy qidiruv uchun (bo'sh joysiz)
const KEYS = [...INDEX.keys()].filter((key) => key.length >= 6);

// So'z (yoki ikki-uch so'z birga) joy nomimi → yozuv | null.
// exact — faqat aniq (imlo kaliti bo'yicha) moslik; aks holda 6+ harfli so'zda 1–2 ta xatoga ruxsat
// (bir xil masofada ikki xil joy chiqsa — noaniq, null).
// → { entry, typo: 0|1|2, ambiguous: bool } | null
export function findPlace(text, { exact = false } = {}) {
  const key = wordKey(text);
  if (!key) return null;
  const list = INDEX.get(key);
  if (list) return list.length === 1 ? { entry: list[0], typo: 0, ambiguous: false } : { entry: null, typo: 0, ambiguous: true };
  if (exact) return null;
  const max = allowedTypos(key);
  if (!max) return null;
  let best = null;
  let bestDistance = max + 1;
  let tie = false;
  // Bitta joyning ikki yozilishi ("toshkent", "toshken") teng masofada bo'lsa — bu tenglik emas
  const sameTarget = (a, b) => {
    const [x, y] = [INDEX.get(a), INDEX.get(b)];
    return x.length === 1 && y.length === 1 && x[0].name === y[0].name && x[0].region === y[0].region && x[0].country === y[0].country && x[0].place === y[0].place;
  };
  for (const candidate of KEYS) {
    // Birinchi harf bir xil bo'lishi shart: "kogoz" (qog'oz) → "kogon" (Kogon) bo'lib qolmasin
    if (candidate[0] !== key[0] || Math.abs(candidate.length - key.length) > max) continue;
    const d = editDistance(key, candidate, max);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance && d <= max && !sameTarget(best, candidate)) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  const found = INDEX.get(best);
  if (found.length !== 1) return null;
  return { entry: found[0], typo: bestDistance, ambiguous: false };
}

export const isCommonWordPlace = (text) => COMMON_WORD_PLACES.has(wordKey(text));
