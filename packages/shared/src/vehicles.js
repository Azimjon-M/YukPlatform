// Mashinalar ikki xil belgi bilan tasvirlanadi (manba: docs/haydovchi-suhbati.md):
//   1) sinfi (o'lchami): fura, mini fura, isuzu, kichik, labo — qancha yuk ko'tarishi
//   2) kuzov turi: tent, ref, ploshatka, tral... — yuk qanday joylanadi
// "words" — e'lonlarda shu narsani bildiradigan so'zlar (AI uchun ishora, imlo xatolari bilan).

// --- Mashina sinfi (o'lchami) ---
// capacityT — odatdagi yuk ko'tarishi, tonna: [eng kami, eng ko'pi]
// body — odatdagi kuzov o'lchami, metr (uzunlik × eni × balandligi), volumeM3 — kub
export const TRUCK_CLASSES = [
  {
    id: "fura",
    name: "Fura",
    category: "fura",
    capacityT: [20, 26], // yakka most 24 t, qo'sh most 25–26 t; tral bilan 40 t gacha
    body: { lengthM: 13.6, widthM: 2.45, heightM: 2.7 },
    volumeM3: 92,
    pallets: 33,
    hint: "yarim pritsepli; yakka most 24 t, qo'sh most 25–26 t, 82–92 kub, uzunligi 13.6–14 m",
    words: ["фура", "fura", "еврофура", "yevrofura", "мега фура", "mega fura", "полуприцеп", "polupritsep", "fura boshi"],
  },
  {
    id: "mini_fura",
    name: "Mini fura",
    category: "fura",
    capacityT: [9, 15],
    hint: "9–15 t: Shacman (\"chakman\") 15 t, Kamaz",
    words: ["мини фура", "mini fura", "minifura", "shacman", "шакман", "chakman", "чакман", "камаз", "kamaz", "howo", "хово"],
  },
  {
    id: "isuzu",
    name: "Isuzu",
    category: "yengil",
    capacityT: [5, 9],
    body: { lengthM: 4.85, widthM: 2.15, heightM: 1.95 }, // Isuzu 5 t
    hint: "5–9 t: Isuzu, FAW (\"kichkina isuzu\"); Isuzu 5 t kuzovi 4.85 × 2.15 × 1.95 m",
    words: ["исузу", "isuzu", "isuzi", "исузи", "иссузу", "faw", "фав", "foton"],
  },
  {
    id: "kichik",
    name: "Kichik yuk mashinasi",
    category: "yengil",
    capacityT: [1, 3],
    hint: "1–3 t: Kia Bongo 2.5 t, Hyundai Porter, Gazel",
    words: ["kia", "киа", "bongo", "бонго", "портер", "porter", "газель", "gazel", "gazelle"],
  },
  {
    id: "labo",
    name: "Labo / Damas",
    category: "yengil",
    capacityT: [0.3, 0.7],
    hint: "Chevrolet Labo 700 kg, Damas",
    words: ["лабо", "labo", "дамас", "damas"],
  },
];

// --- Kuzov turi ---
export const BODY_TYPES = [
  {
    id: "tent",
    name: "Tent",
    hint: "hamma tomoni qalin brezent (mato) bilan yopilgan",
    words: ["тент", "tent", "тентованный", "шторка", "tentli"],
  },
  {
    id: "ref",
    name: "Ref / izoterm",
    hint: "xolodilnikli, hamma tomoni temir bilan yopilgan, havo o'tkazmaydi; odatda \"ref kerak\" deb yoziladi",
    words: ["реф", "ref", "рефрижератор", "изотерм", "izoterm", "izotermiz", "холодильник", "xolodilnik", "haladelnik"],
  },
  {
    id: "ploshatka",
    name: "Ploshatka / shalanda / kontenerovoz",
    hint: "bortsiz tekis platforma; konteyner ham shunga yuklanadi",
    words: ["площадка", "ploshatka", "plashatka", "шаланда", "shalanda", "контейнеровоз", "kontenerovoz", "kantenaravoz", "konteynerovoz"],
  },
  {
    id: "bort",
    name: "Bortli ochiq kuzov",
    hint: "atrofida borti bor, tomi yo'q",
    words: ["борт", "бортовой", "bortli", "bort", "открытый кузов"],
  },
  {
    id: "tral",
    name: "Tral / triler",
    hint: "pritsepi uzunroq, og'ir va negabarit yuklar uchun (40 t va undan ortiq)",
    words: ["трал", "тралл", "трейлер", "triler", "treyler", "tral", "негабарит", "низкорамник"],
  },
  {
    id: "samosval",
    name: "Samosval / tonar",
    hint: "kuzovini domkrat bilan ko'tarib, yukni to'kadi",
    words: ["самосвал", "samosval", "тонар", "tonar", "tanar"],
  },
  {
    id: "sementavoz",
    name: "Sementavoz",
    hint: "faqat sement tashiydigan dumaloq bochka-pritsep",
    words: ["цементовоз", "sementavoz", "sementovoz", "сементавоз", "семент бочка"],
  },
  {
    id: "sisterna",
    name: "Sisterna",
    hint: "suyuqlik (yoqilg'i, suv, moy) bochkasi",
    words: ["цистерна", "бензовоз", "sisterna", "наливной", "битум", "bitum", "битумовоз", "bitumovoz"],
  },
  {
    id: "manipulyator",
    name: "Manipulyator",
    hint: "og'ir yukni o'z krani bilan ko'tarib, o'zi yuklaydi",
    words: ["манипулятор", "manipulyator", "кран борт", "kran"],
  },
  {
    id: "tyagach",
    name: "Tyagach",
    hint: "fura boshi, pritsepsiz (pritsepni tortib ketish uchun)",
    words: ["тягач", "tyagach", "tyagich", "тягич"],
  },
  { id: "boshqa", name: "Boshqa", hint: "yuqoridagilarning hech biri", words: [] },
];

// Yuklash tomoni. O'ng va chap — mashinaga ORQASIDAN qaraganda (aks holda chalkashadi).
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
export const BODY_TYPE_IDS = BODY_TYPES.map((b) => b.id);
export const LOADING_SIDE_IDS = LOADING_SIDES.map((s) => s.id);
