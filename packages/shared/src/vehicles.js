// Mashina turlari. "words" — e'lonlarda shu turni bildiradigan so'zlar (AI uchun ishora).
export const VEHICLES = [
  { id: "tent", name: "Tent", category: "fura", words: ["тент", "tent", "тентованный", "шторка"] },
  { id: "ref", name: "Refrijerator", category: "fura", words: ["реф", "ref", "рефрижератор", "холодильник", "xolodilnik"] },
  { id: "ochiq", name: "Ochiq bort", category: "fura", words: ["борт", "бортовой", "открытый", "ochiq", "площадка"] },
  { id: "konteyner", name: "Konteyner", category: "fura", words: ["контейнер", "konteyner", "контейнеровоз"] },
  { id: "tral", name: "Tral (negabarit)", category: "fura", words: ["трал", "тралл", "негабарит", "низкорамник"] },
  { id: "samosval", name: "Samosval", category: "fura", words: ["самосвал", "samosval"] },
  { id: "sisterna", name: "Sisterna", category: "fura", words: ["цистерна", "бочка", "бензовоз", "sisterna"] },
  { id: "izoterm", name: "Izoterm", category: "fura", words: ["изотерм", "izoterm"] },
  { id: "kamaz", name: "Kamaz", category: "fura", words: ["камаз", "kamaz"] },
  { id: "isuzu", name: "Isuzu", category: "yengil", words: ["исузу", "isuzu"] },
  { id: "gazel", name: "Gazel", category: "yengil", words: ["газель", "gazel"] },
  { id: "porter", name: "Porter", category: "yengil", words: ["портер", "porter"] },
  { id: "labo", name: "Labo", category: "yengil", words: ["лабо", "labo"] },
  { id: "damas", name: "Damas", category: "yengil", words: ["дамас", "damas"] },
  { id: "boshqa", name: "Boshqa", category: null, words: [] },
];

export const VEHICLE_IDS = VEHICLES.map((v) => v.id);
