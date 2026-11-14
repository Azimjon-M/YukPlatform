// Mashinalar ikki xil belgi bilan tasvirlanadi (manba: docs/haydovchi-suhbati.md):
//   1) transport turi (sinfi, o'lchami): katta fura, kamaz, fura, isuzu, labo... — qancha yuk ko'taradi
//   2) kuzov turi: plashatka, tent, ref, samosval... — yuk qanday joylanadi
// "words" — e'lonlarda shu narsani bildiradigan so'zlar (AI uchun ishora, imlo xatolari bilan).
// Ro'yxatlar tartibi — ro'yxatdan o'tish formasidagi tartib (Azimjon, 2026-11-07).

// --- Transport turi ---
// family — AI e'londan qaysi sinfni topadi. AI "katta fura" va "fura" ni ajratmaydi (ikkalasi "fura"), farqni
//   og'irlik hal qiladi: 30 t yuk 26 t ko'taradigan furaga sig'maydi. family === id bo'lgan sinflarni AI biladi.
// capacityT — odatdagi yuk ko'tarishi, tonna: [eng kami, eng ko'pi]
// body — odatdagi kuzov ichki o'lchami, metr (uzunlik × eni × balandligi): «Standart» va «Bilmayman» shuni oladi.
//   Fura va Isuzu 5 t — haydovchidan; qolganlari — shu rusumlarning taxminiy o'lchami.
// noBody — kuzovi yo'q (yengil mashina): kuzov turi, o'lchami va yuklash tomoni so'ralmaydi
export const TRUCK_CLASSES = [
  {
    id: "katta_fura",
    name: "Katta fura",
    family: "fura",
    category: "fura",
    capacityT: [20, 40],
    body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 },
  },
  {
    id: "kamaz",
    name: "Kamaz",
    family: "kamaz",
    category: "fura",
    capacityT: [20, 40],
    body: { lengthM: 5.6, widthM: 2.4, heightM: 1.5 }, // samosval kuzovi ≈ 20 kub
    note: "samosval, shag'al-sheben kabi sochiluvchi yuklar",
    hint: "Kamaz (ko'pincha samosval): shag'al, sheben, qum, tuproq kabi sochiluvchi yuklar; 20–40 t",
    words: ["камаз", "kamaz", "камаз самосвал", "kamaz samosval"],
  },
  {
    id: "fura",
    name: "Fura",
    family: "fura",
    category: "fura",
    capacityT: [20, 26], // yakka most 24 t, qo'sh most 25–26 t
    body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 },
    volumeM3: 92,
    pallets: 33,
    hint: "yarim pritsepli; yakka most 24 t, qo'sh most 25–26 t, katta fura 40 t gacha; 82–92 kub, uzunligi 13.6–14 m",
    words: ["фура", "fura", "еврофура", "yevrofura", "мега фура", "mega fura", "katta fura", "полуприцеп", "polupritsep", "fura boshi"],
  },
  {
    id: "mini_fura",
    name: "Mini fura",
    family: "mini_fura",
    category: "fura",
    capacityT: [9, 15],
    body: { lengthM: 9.6, widthM: 2.45, heightM: 2.6 },
    hint: "9–15 t: Shacman (\"chakman\") 15 t, Howo",
    words: ["мини фура", "mini fura", "minifura", "shacman", "шакман", "chakman", "чакман", "howo", "хово"],
  },
  {
    id: "katta_isuzu",
    name: "Katta Isuzu",
    family: "isuzu",
    category: "yengil",
    capacityT: [6, 10], // Azimjon: katta Isuzu — 10 t
    body: { lengthM: 7.2, widthM: 2.4, heightM: 2.3 },
  },
  {
    id: "isuzu",
    name: "Isuzu",
    family: "isuzu",
    category: "yengil",
    capacityT: [3, 5], // Azimjon: oddiy Isuzu — 5 t
    body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, // Isuzu 5 t (haydovchidan)
    hint: "Isuzu: oddiy 5 t, katta Isuzu 10 t; FAW (\"kichkina isuzu\"); Isuzu 5 t kuzovi 4.85 × 2.15 × 1.95 m",
    words: ["исузу", "isuzu", "isuzi", "исузи", "иссузу", "katta isuzu", "faw", "фав", "foton"],
  },
  {
    id: "kichik",
    name: "Kichik yuk mashinasi",
    family: "kichik",
    category: "yengil",
    capacityT: [1, 3],
    body: { lengthM: 3, widthM: 1.8, heightM: 1.8 },
    note: "Kia Bongo, Porter, Gazel",
    hint: "1–3 t: Kia Bongo 2.5 t, Hyundai Porter, Gazel",
    words: ["kia", "киа", "bongo", "бонго", "портер", "porter", "газель", "gazel", "gazelle"],
  },
  {
    id: "labo",
    name: "Labo / Damas",
    family: "labo",
    category: "yengil",
    capacityT: [0.3, 0.7],
    body: { lengthM: 2.2, widthM: 1.4, heightM: 1.2 },
    hint: "Chevrolet Labo 700 kg, Damas",
    words: ["лабо", "labo", "дамас", "damas"],
  },
  {
    id: "yengil_avto",
    name: "Yengil mashina",
    family: "yengil_avto",
    category: "yengil",
    capacityT: [0.2, 0.5],
    noBody: true,
    note: "Cobalt, Nexia, Gentra",
    hint: "yengil avtomobil (Cobalt, Nexia, Gentra): 500 kg gacha kichik yuk, posilka",
    words: ["кобальт", "cobalt", "нексия", "nexia", "gentra", "джентра", "lacetti", "ласетти", "легковой", "легковушка", "yengil mashina", "yengil avto"],
  },
];

// --- Kuzov turi ---
// sub — formada nom ostidagi izoh. Bayroqlar (yo'q bo'lsa — ha):
//   sides: false — yuklash tomoni so'ralmaydi (samosval ustidan to'kiladi, sisterna shlang bilan to'ldiriladi...)
//   size: false — kuzov o'lchami so'ralmaydi (sisterna, tyagach)
//   pallets: false — palet hisoblanmaydi (samosvalga palet qo'yilmaydi)
//   form: false — formada yo'q (faqat AI uchun)
// Bortli, Tral va Sementavoz alohida emas (Azimjon, 2026-11-07): ularning so'zlari Plashatka va Sisternaga qo'shilgan.
export const BODY_TYPES = [
  {
    id: "ploshatka",
    name: "Plashatka / shalanda",
    hint: "tekis platforma: bortsiz yoki bortli (shalanda); tral/triler ham — og'ir va negabarit yuklar",
    words: [
      "площадка", "ploshatka", "plashatka", "шаланда", "shalanda", "борт", "бортовой", "bortli", "bort", "открытый кузов",
      "трал", "тралл", "трейлер", "triler", "treyler", "tral", "негабарит", "низкорамник",
    ],
  },
  {
    id: "tent",
    name: "Tent / furgon",
    hint: "qalin brezent (mato) bilan yopilgan yoki yopiq temir furgon",
    words: ["тент", "tent", "тентованный", "шторка", "tentli", "фургон", "furgon"],
  },
  {
    id: "skotovoz",
    name: "Skotovoz / TIR",
    sub: "Hayvonlar uchun",
    pallets: false,
    hint: "chorva (mol, qo'y, ot) tashiydigan kuzov",
    words: ["скотовоз", "skotovoz", "skotavoz", "скотавоз", "mol mashina"],
  },
  {
    id: "ref",
    name: "Refrijerator / Ref",
    sub: "Sovutgichli kuzov",
    hint: "sovutgichli (xolodilnik), hamma tomoni temir bilan yopilgan; odatda \"ref kerak\" deb yoziladi",
    words: ["реф", "ref", "рефрижератор", "refrijerator", "холодильник", "xolodilnik", "haladelnik"],
  },
  {
    id: "izoterm",
    name: "Izotermik",
    sub: "Izolyatsiyalangan qalin kuzov",
    hint: "issiq-sovuqdan izolyatsiyalangan qalin yopiq kuzov, sovutgichsiz",
    words: ["изотерм", "изотермический", "izoterm", "izotermik", "izotermiz"],
  },
  {
    id: "samosval",
    name: "Samosval / tonar",
    sub: "Ag'darma kuzov",
    sides: false,
    pallets: false,
    hint: "kuzovini ko'tarib, yukni to'kadi",
    words: ["самосвал", "samosval", "тонар", "tonar", "tanar"],
  },
  {
    id: "sisterna",
    name: "Sisternali",
    sub: "Suyuq va gazsimon yuk",
    sides: false,
    size: false,
    pallets: false,
    hint: "suyuqlik va gaz bochkasi (yoqilg'i, suv, moy, bitum, gaz); sementavoz ham",
    words: [
      "цистерна", "бензовоз", "газовоз", "gazovoz", "sisterna", "наливной", "битум", "bitum", "битумовоз", "bitumovoz",
      "цементовоз", "sementavoz", "sementovoz", "сементавоз", "семент бочка",
    ],
  },
  {
    id: "konteyner",
    name: "Konteynerovoz",
    sides: false,
    pallets: false,
    hint: "konteyner (20 / 40 fut) tashiydigan platforma",
    words: ["контейнеровоз", "konteynerovoz", "kontenerovoz", "kantenaravoz", "контейнер", "konteyner"],
  },
  {
    id: "manipulyator",
    name: "Manipulyator",
    sub: "Og'ir yukni o'z krani bilan ko'taradi",
    sides: false,
    hint: "og'ir yukni o'z krani bilan ko'tarib, o'zi yuklaydi",
    words: ["манипулятор", "manipulyator", "кран борт", "kran"],
  },
  {
    id: "tyagach",
    name: "Tyagach",
    sub: "Faqat fura boshi: tayyor yuklangan pritsepni tortib ketadi",
    sides: false,
    size: false,
    pallets: false,
    hint: "fura boshi, pritsepsiz (tayyor yuklangan pritsepni tortib ketish uchun)",
    words: ["тягач", "tyagach", "tyagich", "тягич"],
  },
  { id: "boshqa", name: "Boshqa", form: false, hint: "yuqoridagilarning hech biri", words: [] },
];

// Eski kuzov kodlari (2026-11-07 gacha AI shunday yozgan, bazada hali bor): qaysi kuzovga qo'shildi
export const BODY_ALIASES = { bort: "ploshatka", tral: "ploshatka", sementavoz: "sisterna" };
export const bodyId = (id) => (id == null ? null : (BODY_ALIASES[id] ?? id));

// Kuzov almashinuvi: shu kuzovli mashina yana qaysi kuzov so'ralgan yukni oladi.
// Ref — izolyatsiyalangan + sovutgich, izotermik yukni ham oladi; konteyner plashatkaga ham yuklanadi (haydovchidan).
export const BODY_ACCEPTS = { ref: ["izoterm"], ploshatka: ["konteyner"] };

// Yuklash tomoni. O'ng va chap — mashinaga ORQASIDAN qaraganda (aks holda chalkashadi).
// "yon" — e'londa "yonidan" deyilgan, qaysi yoni aytilmagan: formada yo'q (haydovchi o'ng / chapni tanlaydi).
export const LOADING_SIDES = [
  { id: "ust", name: "Ustidan", words: ["usti ochiladigan", "tepadan", "верхняя загрузка", "сверху"] },
  { id: "orqa", name: "Orqadan", words: ["orqadan", "задняя загрузка", "сзади"] },
  { id: "yon", name: "Yonidan (tomoni aytilmagan)", words: ["yonidan", "yon tomondan", "боковая загрузка", "сбоку"] },
  { id: "chap", name: "Chap tomondan", words: ["chap tomondan", "слева"] },
  { id: "ong", name: "O'ng tomondan", words: ["o'ng tomondan", "справа"] },
];

// Yevropalet 1.2 × 0.8 m; 13.6 m furaga 33 ta sig'adi
export const PALLET = { lengthM: 1.2, widthM: 0.8 };

export const TRUCK_CLASS_IDS = TRUCK_CLASSES.map((t) => t.id);
// AI e'londan topadigan sinflar (katta fura → fura, katta Isuzu → isuzu)
export const AI_TRUCK_CLASSES = TRUCK_CLASSES.filter((t) => t.family === t.id);
export const AI_TRUCK_CLASS_IDS = AI_TRUCK_CLASSES.map((t) => t.id);
export const BODY_TYPE_IDS = BODY_TYPES.map((b) => b.id);
export const LOADING_SIDE_IDS = LOADING_SIDES.map((s) => s.id);

export const truckClassOf = (id) => TRUCK_CLASSES.find((t) => t.id === id) ?? null;
export const bodyTypeOf = (id) => BODY_TYPES.find((b) => b.id === bodyId(id)) ?? null;
// "katta_isuzu" → "isuzu"; noma'lum — o'zi
export const truckFamily = (id) => truckClassOf(id)?.family ?? id;

// Formada kuzov turi, o'lchami va yuklash tomoni so'raladimi (transport turi va kuzovga qarab)
export const needsBodyType = (classId) => !truckClassOf(classId)?.noBody;
export const needsSize = (classId, bodyType) => needsBodyType(classId) && bodyTypeOf(bodyType)?.size !== false;
export const needsSides = (classId, bodyType) => needsBodyType(classId) && bodyTypeOf(bodyType)?.sides !== false;
export const countsPallets = (bodyType) => bodyTypeOf(bodyType)?.pallets !== false;

// Haydovchi bir nechta transport tanlashi mumkin (Azimjon, 2026-11-13: masalan Isuzu, kichik yuk mashinasi va Labo).
// Profilda: bitta bo'lsa — faqat vehicle.truckClass (eskidek); bir nechta — vehicle.truckClasses ham (truckClass = birinchisi).
// Bir nechta tanlansa kuzov turi, sig'im, o'lcham va yuklash tomoni so'ralmaydi — har bir transport uchun alohida yozish
// shart emas; moslashda har bir sinfning odatdagi sig'imi olinadi (match.js).
export function vehicleClasses(vehicle) {
  if (Array.isArray(vehicle?.truckClasses) && vehicle.truckClasses.length) return vehicle.truckClasses;
  return vehicle?.truckClass ? [vehicle.truckClass] : [];
}
export const manyClasses = (vehicle) => vehicleClasses(vehicle).length > 1;
