// Qoidaviy parser lug'ati: mashina, kuzov, yuklash tomoni, e'lon turi va «ma'nosi bor, lekin yuk ma'lumoti emas» so'zlar.
// Mashina va kuzov so'zlarining asosi — @yuk/shared vehicles.js (AI ham shuni ko'radi), bu yerda faqat qo'shimchalar.
// Hamma so'z wordKey bilan solishtiriladi: "Isuzu" = "исузу" = "isuzzu"; qo'shimcha (-ga, -lar, -ni) olib tashlanadi.
import { BODY_TYPES, TRUCK_CLASSES } from "@yuk/shared";
import { wordKey } from "./text.js";

// Ko'p so'zli iboralar (eng uzuni birinchi tekshiriladi) va bitta so'zlar: kalit → qiymat
function lexicon(entries) {
  const single = new Map();
  const phrases = [];
  for (const [value, words] of entries) {
    for (const word of words) {
      const parts = word.split(/\s+/).map(wordKey).filter(Boolean);
      if (parts.length === 1) single.set(parts[0], value);
      else if (parts.length > 1) phrases.push({ parts, value });
    }
  }
  phrases.sort((a, b) => b.parts.length - a.parts.length);
  return { single, phrases };
}

// --- Transport turi (AI oiladagi sinf: fura, kamaz, mini_fura, isuzu, kichik, labo, yengil_avto) ---
// "tyagach kerak" → fura (AI qoidasi ham shunday), kuzovi esa tyagach
const TRUCK_EXTRA = {
  fura: ["fura", "фура", "furа", "furo", "fur", "furalar", "yevrofura", "eurofura", "mega", "мега", "mega fura", "tyagach", "тягач", "tyagich",
    // "паровоз" (tirkamali avtopoyezd) — AI ham fura deydi (ma'lumotlar: 66/85 yuk fura)
    "paravoz", "parovoz", "parvoz", "паровоз"],
  mini_fura: [
    "chakman", "чакман", "shakman", "шакман", "shacman", "chakaman", "чакаман", "chagman", "чагман", "chacman", "chakmon",
    "howo", "хово", "mini fura", "minifura", "мини фура",
  ],
  isuzu: [
    "isuzu", "isuzi", "исузу", "исузи", "иссузу", "isuziy", "исузий", "izuzu", "изузу", "isuz", "исуз", "katta isuzu",
    "kichik isuzu", "faw", "фав", "fav", "faf", "foton", "isizu", "isizi", "esuzi", "esuzu", "izuzi", "isuzli",
  ],
  kamaz: ["kamaz", "камаз"],
  kichik: ["kia", "киа", "bongo", "бонго", "porter", "портер", "gazel", "газель", "gazelle", "changan", "чанган"],
  labo: ["labo", "лабо", "damas", "дамас"],
  yengil_avto: ["cobalt", "kobalt", "кобальт", "nexia", "нексия", "gentra", "джентра", "lacetti", "ласетти", "yengil mashina", "легковой"],
};
const truckEntries = TRUCK_CLASSES.filter((t) => t.family === t.id).map((t) => [t.id, [...(t.words ?? []), ...(TRUCK_EXTRA[t.id] ?? [])]]);
export const TRUCK_WORDS = lexicon(truckEntries);

// --- Kuzov turi ---
// vehicles.js dagi ba'zi so'zlar qoidaga yaramaydi: "bitum", "kran", "konteyner" ko'pincha YUK nomi
// ("bitum 25 tonna tentovka", "suyilgan kontener bor"), shuning uchun bu yerda olinmaydi.
const BODY_SKIP = new Set(["битум", "bitum", "kran", "контейнер", "konteyner", "негабарит", "наливной"].map(wordKey));
const BODY_EXTRA = {
  tent: [
    "tentovka", "tentofka", "тентовка", "tentli", "tenti", "tentlar", "tentov", "tenta", "tentovok", "tentovannaya",
    "тентованная", "shtorka", "шторка", "furgon", "фургон", "tentovoy", "tentovki", "tentlik",
    // imlo xatolari: "Тен фура", "Тейет фура", "tintli fura"
    "ten", "teyet", "tint", "tintli",
  ],
  ref: ["ref", "реф", "refka", "рефка", "refov", "refa", "refrijerator", "рефрижератор", "refrejerator", "xolodilnik", "holodilnik", "haladelnik", "xoladelnik", "xolodilniye", "refli", "refrijeratorli"],
  ploshatka: ["plashatka", "ploshatka", "ploshadka", "plashadka", "площадка", "shalanda", "шаланда", "shalonda", "pilashatka", "bortli", "bortlik", "bort", "bortovoy", "бортовой", "bortovaya"],
  samosval: ["samosval", "самосвал", "samasval", "самасвал", "tonar", "тонар", "tanar", "taner"],
  sisterna: ["sisterna", "tsisterna", "цистерна", "sisternali", "benzovoz", "бензовоз", "gazovoz", "sementavoz", "sementovoz", "tsementovoz", "цементовоз"],
  izoterm: ["izoterm", "изотерм", "izotermik"],
  skotovoz: ["skotovoz", "скотовоз", "skotavoz"],
  konteyner: ["konteynerovoz", "контейнеровоз", "kontenerovoz", "kantenaravoz", "kantenaravo'z"],
  manipulyator: ["manipulyator", "манипулятор"],
  tyagach: ["tyagach", "тягач", "tyagich"],
};
const bodyEntries = BODY_TYPES.filter((b) => b.id !== "boshqa").map((b) => [
  b.id,
  [...b.words.filter((w) => !BODY_SKIP.has(wordKey(w))), ...(BODY_EXTRA[b.id] ?? [])],
]);
export const BODY_WORDS = lexicon(bodyEntries);

// --- Yuklash tomoni ---
export const SIDE_WORDS = lexicon([
  ["ust", [
    "usti ochiladigan", "usti ochiladigon", "usti ochladigan", "usti ochladigon", "usti ochilodigan", "usti ochilgan", "usti ochilish", "usti ochiq", "usti ochik", "usti ochilad", "tepasi ochiladigan", "tepasi ochiladigon", "tepasi ochladigan", "tepasi ochladigon", "tepasi ochilodigan", "tepasi ochilgan", "tepasi ochilish", "tepasi ochiq", "tepasi ochik", "tepasi ochilad", "ustini ochiladigan", "ustini ochiladigon", "ustini ochladigan", "ustini ochladigon", "ustini ochilodigan", "ustini ochilgan", "ustini ochilish", "ustini ochiq", "ustini ochik", "ustini ochilad", "tepasini ochiladigan", "tepasini ochiladigon", "tepasini ochladigan", "tepasini ochladigon", "tepasini ochilodigan", "tepasini ochilgan", "tepasini ochilish", "tepasini ochiq", "tepasini ochik", "tepasini ochilad",
    "tepasi ochiladigan", "tepadan", "ustidan", "verxnyaya", "верхняя", "sverxu", "сверху", "verx"]],
  ["orqa", ["orqadan", "orqasidan", "zadnyaya", "задняя", "szadi", "сзади"]],
  ["yon", ["yonidan", "yon tomondan", "bokovaya", "боковая", "bokovoy", "sboku", "сбоку", "bakavoy"]],
]);

// --- Qisman yuk (dogruz) ---
export const PARTIAL_WORDS = lexicon([[true, ["dogruz", "догруз", "qo'shimcha", "qoshimcha", "kushimcha", "кушимча", "қўшимча", "sborniy", "сборный", "pol gruz", "yarim yuk"]]]);

// --- E'lon turi ---
// Mashina bo'sh (haydovchi yuk qidiryapti) belgilari — bunday e'lonni hozircha AI hal qiladi
export const TRUCK_FREE_WORDS = lexicon([
  [true, [
    "bo'sh", "бўш", "bush", "svobodna", "svobodnaya", "svobodniy", "свободна", "свободная", "свободный", "pustoy", "пустой",
    "poputi", "poputiga", "poputno", "попутно", "попутный", "yuk kerak", "юк керак", "yuk kere", "yuk kk", "gruz ishu", "ищу груз",
    "yuk olaman", "yuk qidiryapman", "mashina bor", "moshina bor", "fura bor", "isuzu bor", "isuzi bor", "labo bor", "damas bor",
    // "yuk olamiz", "yuklar bo'lsa aytinglar", "yuraman", "Labo xizmat", "isuzi maniki" (shadow 2026-11-09: AI mashina_bor degan)
    "olamiz", "оламиз", "olaman", "оламан", "yuraman", "yuramiz", "ketyapman", "ketaman", "maniki", "meniki", "xizmat", "xizmati",
    "xizmatlari", "uslugi", "yuk bo'lsa", "yuk bolsa", "yuk bulsa", "yuklar bo'lsa", "yuklar bolsa", "yuklar bulsa", "gruz bolsa",
    "ishu gruz", "yuk izlayapman", "yuk izlaymiz",
    "olamz", "olmiz", "shafyor bor", "shofyor bor", "shopir bor", "haydovchi bor", "yuki borlar", "yuklari borlar", "yuk bosa",
    "pochta bosa", "opketamiz", "opketaman", "olib ketamiz", "olib ketaman", "qo'yib beraman", "qoyib beraman",
    // Logistik.uz mashina shabloni: "🔥 DIQQAT! 🇺🇿 MAHALLIY MASHINA", "⚖️ Yuk ko'tarishi: 22 t"
    "mahalliy mashina", "xalqaro mashina", "yuk ko'tarishi", "yuk kotarishi",
  ]],
]);

// --- Ma'nosi bor, lekin yuk ma'lumoti emas (AI ham hech qaysi maydonga yozmaydi yoki faqat izohga) ---
// Salom-alik, "kerak", "bor", "tel", "srochno", yuklash vaqti, to'lov... Bu so'zlar e'lonni «tushunarsiz» qilmaydi.
const FILLER_LIST = [
  // yuk bor / kerak
  "yuk", "юк", "yuki", "yukimiz", "yuklar", "yukim", "bor", "бор", "borr", "kerak", "керак", "kk", "кк", "kere", "kerek", "керек",
  "kerakk", "keark", "krk", "gruz", "груз", "gruza", "gruzi", "tovar", "товар", "nujen", "нужен", "nujna", "нужна", "nujno",
  "нужно", "nujni", "нужны", "trebuyetsya", "требуется", "lazim", "kerakli", "est", "yest", "есть", "bo'lsa", "bolsa",
  // mashina umumiy so'zlari (sinf emas)
  "mashina", "машина", "moshina", "мошина", "mashin", "moshin", "мошин", "mashini", "mashinasi", "moshinasi", "avto", "авто",
  "transport", "транспорт", "kuzov", "кузов", "kuzovli", "katta", "катта", "kichkina", "кичкина", "kichik", "кичик", "standart",
  // vaqt
  "srochno", "срочно", "srochna", "srochni", "srochniy", "srochnaa", "shoshilinch", "tezda", "tez", "tezroq", "hozir", "xozir",
  "hozirga", "xozirga", "bugun", "бугун", "bugunga", "ertaga", "эртага", "ertalab", "ertalabga", "kechqurun", "kechga",
  "segodnya", "сегодня", "zavtra", "завтра", "gotov", "готов", "tayyor", "тайёр", "tayer", "tayor", "tayyorr",
  // yuklash
  "yuklanadi", "юкланади", "ortiladi", "yuklash", "yuklanish", "yukla", "tushadi", "tushiriladi", "pogruzka", "погрузка",
  "zagruzka", "загрузка", "vigruzka", "выгрузка", "boradi", "борадi", "ketadi", "olib", "tashish", "yetkazish",
  // aloqa
  "tel", "тел", "telefon", "телефон", "nomer", "номер", "aloqa", "aloqaga", "murojaat", "kontakt", "контакт", "zvonite",
  "звоните", "svyaz", "связь", "qo'ng'iroq", "qiling", "qilsin", "qilinglar", "qilib", "shopir", "shopirlar", "shofyor",
  "shofyorlar", "shafyorlar", "shafyor", "haydovchi", "haydovchilar", "voditel", "водитель", "voditeli",
  // salom
  "assalomu", "assalom", "alaykum", "aleykum", "alekum", "alaykim", "salom", "hammaga", "akalar", "aka", "iltimos", "rahmat",
  // bog'lovchi, old qo'shimcha
  "va", "ва", "yoki", "ёки", "ham", "хам", "bilan", "билан", "uchun", "учун", "ili", "или", "i", "и", "na", "на", "do", "до",
  "iz", "из", "s", "с", "v", "в", "po", "по", "za", "за", "dlya", "для", "ot", "от", "ta", "та", "bitta", "dona", "sht",
  // to'lov (narxi bo'lmasa ham)
  "naqd", "нақд", "naxt", "nakd", "nal", "nalichka", "nalichniye", "nalichnimi", "karta", "kartaga", "perechisleniye",
  "kelishiladi", "kelishamiz", "kelishuv", "kelishilgan", "dogovornaya", "dogovornoy", "договорная", "torg", "торг",
  "oplata", "оплата", "to'lov", "tolov", "avans", "аванс", "nalichniy", "nalichnimi", "nalichnymi", "perechisleniyem",
  "fraxt", "frax", "fraht", "фрахт", "stavka", "ставка", "narxi", "narx", "narhi", "tsena", "цена", "puli", "pullari",
  "yo'lkira", "yolkira", "kira",
  // hujjat, bojxona, qo'shimcha shartlar (AI izohga yozadi, moslashga ta'sir qilmaydi)
  "rastamojka", "растаможка", "plomba", "пломба", "dozvol", "dazvol", "дозвол", "tir", "adr", "rejim", "режим",
  "bez", "без", "ne", "не", "cherez", "через", "ichida", "beriladi",
  // og'irlik, hajm, sana so'zlari (soni bilan birga numbers.js ushlaydi; soni yo'q bo'lsa ham zararsiz)
  "ves", "вес", "ob'yom", "obyom", "объем", "objom", "kolichestvo", "количество", "tip", "тип", "data", "дата", "max",
  "pogruzki", "pagruzka", "razgruzka", "разгрузка", "zapros", "dogovor", "договор", "km", "kilosiga", "chislo", "chisla",
  "pogruzke", "pogrustka", "vigruzke", "zagruzke", "otgruzke", "perevozka", "rastomojka", "raztamojka", "rastamoshka",
  "lichka", "lichkaga", "logist", "logistlar", "logistlarga", "dispetcher", "dispecher", "to'g'ridan", "togridan", "joydan",
  "yertalab", "yertalabga", "keyin", "posle", "tolko", "farqi", "tranzit", "nds", "obshiy", "ponedelnik", "kun", "kuni",
  // messenjerlar
  "imo", "vatsap", "vatsapp", "whatsapp", "tg", "telegram", "telegramm",
  // joyni aniqlovchi so'zlar (qo'shimchasi joyning yo'nalishini beradi — pastda PLACE_NOUNS)
  "marshrut", "маршрут", "yo'nalish", "yonalish", "sankt",
  // shadow hisobotidan (2026-11-09): ko'p uchragan, yuk ma'lumoti bo'lmagan so'zlar
  "glonas", "glonass", "глонасс", "trebovaniya", "trebovaniye", "bot", "bo'lishi", "bolishi", "libo", "либо", "ortish", "tushirish",
  "bir", "bu", "shu", "yengil", "tonna", "tonnaj", "tonaj", "avtomobil", "avtomobili", "avtomobiley", "transporta", "mash",
  "ves", "fut", "fud", "nalichnimi",
  // avto-joylash shablonlari (GLogistics, Logistik.uz, 2026-11-09): "🔥 YANGI YUK E'LONI!", "🔥 DIQQAT! 🇺🇿 MAHALLIY YUK",
  // "Transport turi:", "📏 Hajmi: —", "💰 Kelishilgan holda"
  "yangi", "e'lon", "e'loni", "elon", "eloni", "diqqat", "mahalliy", "xalqaro", "turi", "hajmi", "hajm", "holda", "vazn",
  // bo'shliq bilan yozilgan so'z harflari ("Y U K B O R", "a k r a m"), "2026 g." — alohida harf ma'lumot emas
  "a", "b", "c", "d", "e", "f", "g", "h", "j", "k", "l", "n", "o", "p", "q", "r", "u", "w", "y", "z",
];
export const FILLER = new Set(FILLER_LIST.map(wordKey));

// Ko'p uchraydigan yuk nomlari. Ular yuk nomi sifatida olinadi va -ka / -ga bilan tugasa ham joy deb o'ylanmaydi
// (bumaga, kartoshka, upakovka — ruscha so'zlar, o'zbekcha "-ga" emas)
export const CARGO_WORDS = new Set(
  [
    "texnika", "bumaga", "kartoshka", "upakovka", "opalubka", "napitka", "napitki", "doska", "nachinka", "lodka", "plyonka",
    "karobka", "korobka", "korobkax", "butka", "konditerka", "zamarozka", "silindirovka", "otsilindrovka", "tsilindrovka",
    "silindrofka", "ilchovka", "ilichovka", "makka", "kafel", "taxta", "paxta", "tekstil", "frukti", "mdf", "dsp", "fanera",
    "armatura", "metall", "metallom", "sement", "un", "shakar", "piyoz", "sabzi", "olma", "bitum", "kepak", "granula",
    "pryaja", "xlopok", "mebel", "ugol", "ko'mir", "komir", "tuz", "sheben", "qum", "shag'al", "profil", "truba", "kabel",
    "faner", "pishma", "suxofrukti", "suxofrukt", "kukuruz", "bug'doy", "arpa", "guruch", "yog'och", "g'isht", "gisht",
    "blok", "penoplast", "penopleks", "tunika", "list", "rulon", "plitka", "oyna", "shisha", "moy", "yog'", "salarka",
    "meva", "sabzavot", "chipsi", "lapsha", "big", "beg", "bag", "bigbeg", "bigbag", "meshok", "qop", "kop", "laxta", "lahta",
  ].map(wordKey),
);

// So'z qaysi so'zlar oldidan yuk nomini bildiradi: "metallom bor", "sement bor", "пряжа бор"
export const CARGO_BEFORE = new Set(["bor", "бор", "borr", "est", "есть", "yest", "ortiladi", "yuklanadi", "юкланади"].map(wordKey));
// "Yuk: un", "Груз: тахта", "Tovar Bigbag" — keyingi so'zlar yuk nomi
export const CARGO_AFTER = new Set(["gruz", "груз", "yuk", "юк", "tovar", "товар", "gruzi"].map(wordKey));

// Joyni aniqlovchi otlar: "Koson tumanidan", "Toshkent shahriga", "Qashqadaryo viloyatidan".
// Ular joyning o'zi emas: yo'nalish qo'shimchasi ularning oxirida bo'ladi.
export const PLACE_NOUNS = new Set(
  ["shahar", "shahri", "shaxar", "shaxri", "sh", "viloyat", "viloyati", "vil", "obl", "oblast", "oblasti", "tuman", "tumani", "rayon", "rayoni", "gorod", "qishloq", "qishlog'i",
    // Rossiya hududlari (Logistik.uz shabloni): "Krasnoyarsk o'lkasi", "Oltoy respublikasi"
    "o'lka", "o'lkasi", "respublika", "respublikasi", "kray", "kraya"].map(wordKey),
);

// Joy ichidagi aniq nuqta: "Mirobod bozoridan", "sement zavodidan", "Qarshi krugdan" — viloyat/shahar o'zgarmaydi,
// AI bularni fromPlace / izohga yozadi. Moslash (match.js) ularga qaramaydi
export const PLACE_DETAILS = new Set(
  [
    "bozor", "bozori", "mirbozor", "zavod", "zavodi", "sklad", "skladi", "ombor", "ombori", "baza", "bazasi", "terminal",
    "tamojnya", "tamojniy", "tamojka", "bojxona", "stansiya", "vokzal", "krug", "kolso", "fabrika", "sex", "massiv",
    "mahalla", "mahallasi", "kvartal", "markaz", "markazi", "aeroport", "port", "rayon", "tumani", "shahar", "shahri",
    // "Fud siti" (Toshkent bozori), "Ark-Bulak" (bojxona posti)
    "siti", "futsiti", "fudsiti", "arkbulak", "ark", "bulak",
  ].map(wordKey),
);

// Mashina talabi, lekin lug'atimizda aniq mashina emas: "pritsep", "trall", "avtovoz" — e'lonni AI hal qilsin
export const VEHICLE_HINTS = new Set(
  ["pritsep", "pricep", "pretsip", "presib", "prisep", "traller", "treller", "trall", "tral", "scepka", "stsepka", "avtovoz", "lesovoz", "nizkoramnik"].map(wordKey),
);

// Ish bilan bog'liq emas: guruh botlarining xizmat xabarlari (to'lov, qoidalar, salomlashish, reklama ogohlantirishi).
// AI bularni doim «boshqa» deydi — so'rov behuda ketmasin. Matn kichik harfda, lotinda (toLatin) solishtiriladi.
export const SERVICE_PATTERNS = [
  /guruhga yozish uchun (?:to'lov qilishingiz|avval \d+ ta odam)/,
  /dobro pojalovat.{0,40}tutgruz/s,
  /razmestili reklamu ili je ispolzovali zapreshenniye/,
  /reklama tarqatmang/,
  /@tutgruzbot - bot po poisku gruzov/,
  /#pravila/,
  // Targo.uz boti: "<ism>, кечирасиз, бу гуруҳда ёзиш учун Targo.uz канали ва гуруҳига обуна бўлинг" (2026-11-09: 6 soatda 260+)
  /bu guruhda yozish uchun .{0,60}obuna bo'ling/s,
  // 2026-11-19 (tezkor oqimdagi «quruq gap»): «yozish uchun guruhga 5 ta odam qo'shing 📊 Qo'shdingiz: 0/5», «haqoratli so'z yubormang»
  /yozish uchun guruhga \d+ ta (?:odam|kishi)/,
  /qo'shdingiz: \d+ ?\/ ?\d+/,
  /haqoratli so'z/,
];

// Bo'sh mashina e'loni — haydovchiga kerak emas (u yuk qidiryapti). Faqat aniq andozalar: parserning «bo'sh mashina» belgisi
// ko'p haqiqiy yukni ham ushlaydi (2026-11-19: 415 tadan yarmiga yaqini yuk e'loni edi), shuning uchun u ishlatilmaydi
// 2026-11-19 (Azimjon: «Farg'ona» filtri bilan ham «Каршига юрамиз … лахтак юк болса оламиз», «PUSTOY FURA BOR» keldi):
// haydovchining o'zi yozgan «yuk qidiryapman» e'lonlari. Har andoza AI yorliqlangan 11 000 e'londa o'lchangan — «yuk» deb
// yorliqlanganlariga tushganlarining deyarli hammasi AI xatosi edi (aslida bo'sh mashina). Lotinlashtirilgan, kichik harfda
const TRUCK_OWN = "fura|isuz\\w*|kamaz|labo|gazel\\w*|sprinter\\w*|damas|porter|chakman|bongo|faf|plashadka|shalanda|tentofka|tentovka";
const TRUCK_NAMES = "fura|isuz\\w*|kamaz|labo|mashina|moshina|tent|ref|gazel\\w*|sprinter\\w*|damas|porter|chakman|bongo|faf";
export const FREE_TRUCK_PATTERNS = [
  /targo\.uz'da yangi transport/,
  /yangi bo'sh transport/,
  /hozir bo'sh/,
  // «yuk olamiz», «yuk olaman», «yuk ortamiz», «yuk qidiryapmiz»
  /yuk\w*\s+(?:ol[ai]miz|olaman|olami|olamz|ortamiz|qidir|izla)/,
  // «yuk bo'lsa (olamiz / aytinglar)», «yuklar bulsa», «yuk borlar»
  /yuk(?:lar\w*|la|ing\w*)?\s+(?:bo'?l?sa|bulsa|busa|bosa|bolsa|borlar)/,
  // «pochta bo'lsa olamiz», «… bo'lsa olamiz / beringlar»
  /(?:bo'?l?sa|bulsa|busa|bosa|bolsa)\s+(?:ol[ai]miz|olaman|olamz|ber(?:inglar|ila|orasi\w*))/,
  // «yuk kerak» (yuk so'ralyapti; «yuk mashina kerak» emas)
  /(?:^|[\s,.!])yuk\s+(?:kerak|kk|kere)(?![a-z'])/,
  // «bo'shadik», «bo'shaymiz», «bo'shmiz»
  /(?:bo'?sh|bush)(?:a(?:dik|dim|ymiz|yman|ganmiz)|miz|man)(?![a-z'])/,
  // «pustoy fura bor», «bo'sh isuzu bor» («pustoy isuzu kerak» — yuk, unga tegilmaydi)
  new RegExp(`(?:pustoy|bo'?sh|bush)\\s+(?:${TRUCK_NAMES})\\s+(?:bor|turibdi|turipti)(?![a-z'])`),
  // «isuzu bor», «5 ta plashadka bor», «labo bor» — keyin «yuk bor» kelmasa («1 fura yuk bor» — yuk)
  new RegExp(`(?:^|[^a-z'])(?:${TRUCK_OWN})\\s+bor(?![a-z'])(?![^]*?(?:yuk|gruz)\\w*\\s+bor)`),
  // «mashinamiz isuzu», «moshinam labo»
  /(?:mashina|moshina|mashin|moshin)(?:miz|m)(?![a-z'])/,
  // «olib ketamiz», «opketamiz»
  /(?:olib\s+ket(?:amiz|aman|averamiz)|opketamiz)/,
  // yo'lga chiqyapti: «Qarshiga yuramiz», «yo'lga chiqamiz», «qaytamiz»
  /(?:yuramiz|yuraman|yo'?lga\s+chi[qk]|qaytamiz|qaytaman)(?![a-z'])/,
];

// «Quruq gap»ning boshqa turlari (tezkor filtr, fastLook): sotuv e'lonlari, yo'lovchi taksi va h.k. — pastda to'ldiriladi
export const CHATTER_PATTERNS = [
  // Yo'lovchi taksi: «odam va pochta olamiz», «2 ta kam», «1 ta yo'lovchi kam» («2 ta kamaz» emas)
  /yo'?lovchi/,
  /odam\s+(?:va\s+)?pochta|pochta\s+(?:va\s+)?odam/,
  /\d\s*ta\s+(?:odam\s+)?kam(?![a-z'])|kam\s*damiz/,
  /(?:^|[^a-z'])(?:taksi|taxi)(?![a-z'])/,
  /\d\s*kishi|kishiga\s+joy|manzildan\s+manzil/,
  /(?:avto\w*|moshina|mashina)\s*:?\s*(?:kobalt|cobalt|cobolt|jentra|gentra|neksiya|nexia|malibu|tracker|treker|lasetti|lacetti|epika|captiva)(?![a-z'])/,
  // Sotuv e'lonlari: «Isuzu sotiladi», «sotaman», «продам», «sotiladigan lavlagi bor»
  /(?:sotiladi(?:gan)?|sotaman|sotamiz|sotuvda|prodam|prodayu|prodayotsya)(?![a-z'])/,
  // Guruh botlari va reklama: to'lov boti, haydovchi profili, «guruhda yozish uchun», yuk tashish xizmati reklamasi
  /to'?lov\s+bot|haydovchi\s+profili|guruh(?:da|ga)\s+yozish\s+uchun/,
  /yuk\s+tashish\s+xizmati|yetkazib\s+beramiz|xizmatlarimizni\s+taklif|garantiya\s*\+?\s*servis/,
  // Ish e'loni: «shofyor kerak ishlatishga», «haydovchi kerak»
  /(?:shaf[iy]?y?[oe]r|shofy?[oe]r|shopir|haydovchi|voditel)\s+(?:kerak|kk|kere|kerek)(?![a-z'])/,
];

// Yuk e'lonining aniq belgisi: «yuk bor», «fura kerak». Bu bor matnda bo'sh mashina andozasi ishlamaydi — yuklar ro'yxatidagi
// bitta «…yuk kerak» qatori butun e'lonni tashlab yubormasin (AI yorliqlangan e'lonlarda o'lchangan)
export const LOAD_SURE = /(?:yuk|gruz)\w*\s+bor(?![a-z'])|(?:fura|isuz\w*|kamaz|labo|mashina|moshina|tent|ref|chakman|plashadka|shalanda)\w*\s+(?:kerak|kk|kere|kerek)(?![a-z'])/;
