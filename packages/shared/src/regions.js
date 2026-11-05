// O'zbekiston viloyatlari, ulardagi shahar va tuman markazlari, Toshkent tumanlari, xorijiy davlatlar.
// Haydovchi filtrni viloyat bo'yicha tanlaydi, shuning uchun har bir e'lon viloyat kodiga bog'lanadi.
// aliases — e'lonlarda uchraydigan boshqa yozilishlar (ruscha, eski nomlar, imlo xatolari).
export const REGIONS = [
  {
    id: "toshkent_sh",
    name: "Toshkent shahri",
    cities: ["Toshkent"],
    aliases: { Toshkent: ["Ташкент", "Тошкент", "Тош", "Taskent", "Tashkent"] },
  },
  {
    id: "toshkent",
    name: "Toshkent viloyati",
    cities: [
      "Nurafshon", "Chirchiq", "Olmaliq", "Angren", "Bekobod", "Yangiyo'l", "Ohangaron", "Parkent", "Piskent",
      "G'azalkent", "Keles", "To'ytepa", "Chinoz", "Bo'ka", "Oqqo'rg'on", "Zangiota", "Eshonguzar", "Qibray",
      "Do'stobod", "Yangibozor", "Iskandar", "Xo'jakent", "Chorvoq", "Salar", "Zafar", "Nazarbek",
    ],
    aliases: {
      "To'ytepa": ["Toytepa", "Тойтепа"], Olmaliq: ["Алмалык"], "Yangiyo'l": ["Янгиюль"], Chinoz: ["Чиназ"],
      Nazarbek: ["Назарбек"], // Zangiota tumani; "Toshkent Nazarbek" — viloyat, shahar emas
    },
  },
  {
    id: "andijon",
    name: "Andijon viloyati",
    cities: [
      "Andijon", "Asaka", "Xonobod", "Shahrixon", "Qo'rg'ontepa", "Marhamat", "Paxtaobod", "Xo'jaobod", "Baliqchi",
      "Bo'z", "Buloqboshi", "Poytug'", "Jalaquduq", "Oltinko'l", "Oqoltin", "Qorasuv", "Ulug'nor",
    ],
    aliases: { Andijon: ["Андижан"], "Qo'rg'ontepa": ["Кургантепа"] },
  },
  {
    id: "namangan",
    name: "Namangan viloyati",
    cities: [
      "Namangan", "Chust", "Kosonsoy", "Pop", "Uchqo'rg'on", "Chortoq", "To'raqo'rg'on", "Yangiqo'rg'on",
      "Jomasho'y", "Haqqulobod", "Uychi", "Davlatobod",
    ],
    aliases: { Kosonsoy: ["Касансай"], "To'raqo'rg'on": ["Туракурган"] },
  },
  {
    id: "fargona",
    name: "Farg'ona viloyati",
    cities: [
      "Farg'ona", "Marg'ilon", "Qo'qon", "Quvasoy", "Quva", "Rishton", "Oltiariq", "Beshariq", "Bog'dod", "Ibrat",
      "Dang'ara", "Navbahor", "Langar", "Yaypan", "Toshloq", "Uchko'prik", "Yozyovon", "Ravon",
    ],
    aliases: { "Farg'ona": ["Фергана", "Фаргона", "Фарғона"], "Qo'qon": ["Коканд", "Кукон", "Қўқон"], "Marg'ilon": ["Маргилан"] },
  },
  {
    id: "sirdaryo",
    name: "Sirdaryo viloyati",
    cities: ["Guliston", "Yangiyer", "Shirin", "Sirdaryo", "Boyovut", "Baxt", "Sardoba", "Navro'z", "Sayxunobod", "Xovos"],
    aliases: { Yangiyer: ["Янгиер", "Yangi yer", "Янги ер"], Guliston: ["Гулистан"] },
  },
  {
    id: "jizzax",
    name: "Jizzax viloyati",
    cities: [
      "Jizzax", "G'allaorol", "Do'stlik", "Zomin", "Paxtakor", "Baxmal", "Usmat", "G'oliblar", "Yangiqishloq",
      "Gagarin", "Uchtepa", "Yangiobod", "Zafarobod", "Zarbdor", "Arnasoy", "Forish",
    ],
    aliases: { Jizzax: ["Джизак", "Жиззах"], Baxmal: ["Бахмал"] },
  },
  {
    id: "samarqand",
    name: "Samarqand viloyati",
    cities: [
      "Samarqand", "Kattaqo'rg'on", "Urgut", "Bulung'ur", "Ishtixon", "Jomboy", "Chelak", "Payariq", "Juma",
      "Loyish", "Oqtosh", "Nurobod", "Ziyovuddin", "Qo'shrabot", "Toyloq", "Mitan",
    ],
    aliases: { Samarqand: ["Самарканд"], "Kattaqo'rg'on": ["Каттакурган"] },
  },
  {
    id: "qashqadaryo",
    name: "Qashqadaryo viloyati",
    cities: [
      "Qarshi", "Shahrisabz", "Kitob", "G'uzor", "Koson", "Muborak", "Yakkabog'", "Chiroqchi", "Qamashi",
      "Beshkent", "Tallimarjon", "Dehqonobod", "Mug'lon", "Mirishkor", "Yangi Nishon",
    ],
    aliases: { Qarshi: ["Карши"], Shahrisabz: ["Шахрисабз", "Şaxrizab"] },
  },
  {
    id: "surxondaryo",
    name: "Surxondaryo viloyati",
    cities: [
      "Termiz", "Denov", "Sherobod", "Sho'rchi", "Boysun", "Jarqo'rg'on", "Angor", "Bandixon", "Xalqobod",
      "Qarluq", "Sariq", "Qumqo'rg'on", "Sariosiyo", "Uzun",
    ],
    aliases: { Termiz: ["Термез"], Denov: ["Денау"], "Sho'rchi": ["Шурчи", "Shurchi", "Шўрчи"], Sherobod: ["Sherabot", "Sherabod", "Шеробод", "Шерабад"] },
  },
  {
    id: "buxoro",
    name: "Buxoro viloyati",
    cities: [
      "Buxoro", "G'ijduvon", "Kogon", "Qorako'l", "Romitan", "Vobkent", "Olot", "Jondor", "Yangibozor (Peshku)",
      "Qorovulbozor", "Shofirkon", "Gazli",
    ],
    aliases: { Buxoro: ["Бухара"], Kogon: ["Каган"] },
  },
  {
    id: "navoiy",
    name: "Navoiy viloyati",
    cities: ["Navoiy", "Zarafshon", "Uchquduq", "Karmana", "Nurota", "Qiziltepa", "Konimex", "Beshrabot", "Tomdi", "Yangirabot", "G'ozg'on"],
    aliases: { Navoiy: ["Навои"] },
  },
  {
    id: "xorazm",
    name: "Xorazm viloyati",
    cities: ["Urganch", "Xiva", "Xonqa", "Hazorasp", "Gurlan", "Shovot", "Bog'ot", "Qo'shko'pir", "Yangiariq", "Yangibozor (Xorazm)", "Pitnak"],
    aliases: { Urganch: ["Ургенч"], Xiva: ["Хива"] },
  },
  {
    id: "qoraqalpogiston",
    name: "Qoraqalpog'iston Respublikasi",
    cities: [
      "Nukus", "Xo'jayli", "Beruniy", "To'rtko'l", "Chimboy", "Qo'ng'irot", "Mo'ynoq", "Mang'it", "Bo'ston", "Kegeyli",
      "Qanliko'l", "Qorao'zak", "Shumanay", "Taxtako'pir", "Taxiatosh",
    ],
    aliases: { Nukus: ["Нукус"], "Qo'ng'irot": ["Кунград"] },
  },
  { id: "xorij", name: "Xorij (O'zbekistondan tashqari)", cities: [] },
];

// Toshkent shahri tumanlari. "Toshkent Sergeli" = Toshkent shahri, Sergeli tumani.
export const TASHKENT_DISTRICTS = [
  "Bektemir", "Chilonzor", "Mirobod", "Mirzo Ulug'bek", "Olmazor", "Sergeli", "Shayxontohur", "Uchtepa",
  "Yakkasaroy", "Yashnobod", "Yunusobod", "Yangihayot",
];

export const HOME_COUNTRY = "O'zbekiston";
// O'zbekiston bilan chegaradosh davlatlar (yo'nalish doirasi uchun: scope.js)
export const NEIGHBOR_COUNTRIES = ["Qozog'iston", "Qirg'iziston", "Tojikiston", "Turkmaniston", "Afg'oniston"];

// Xorijiy davlatlar (avval Osiyo) va yuk ko'p boradigan shaharlar. name — e'londa yoziladigan nom.
// aliases — e'lonlardagi boshqa yozilishlar (Almaty, Алматы → Olmaota): places.js ularni bitta nomga keltiradi.
export const COUNTRIES = [
  {
    name: "Qozog'iston",
    cities: ["Olmaota", "Astana", "Shymkent", "Taraz", "Aqtobe", "Qarag'anda", "Atirau", "Aqtau", "Pavlodar", "Oral", "Qostanay", "Turkiston", "Saryag'och"],
    aliases: {
      Olmaota: ["Almaty", "Almati", "Almatı", "Almata", "Алматы", "Алма-Ата", "Алмата"], Shymkent: ["Chimkent", "Shimkent", "Шымкент", "Чимкент"],
      Astana: ["Астана"], Oral: ["Uralsk", "Уральск"], Aqtobe: ["Aktobe", "Актобе"], "Qarag'anda": ["Karaganda", "Караганда"],
      Atirau: ["Atyrau", "Атырау"], Aqtau: ["Aktau", "Актау"], Qostanay: ["Kostanay", "Костанай"], Turkiston: ["Turkestan", "Туркестан"],
      "Saryag'och": ["Saryagash", "Сарыагаш"],
    },
  },
  {
    name: "Qirg'iziston",
    cities: ["Bishkek", "O'sh", "Jalolobod", "Balikchi", "Qorako'l", "Tokmok", "Botken"],
    aliases: { Bishkek: ["Бишкек"], "O'sh": ["Osh", "Ош"], Jalolobod: ["Jalal-Abad", "Джалал-Абад"], Tokmok: ["Tokmak", "Токмок"], Botken: ["Batken", "Баткен"], "Qorako'l": ["Karakol", "Каракол"] },
  },
  {
    name: "Tojikiston",
    cities: ["Dushanbe", "Xo'jand", "Kulob", "Bokhtar", "Panjikent", "Istaravshan"],
    aliases: { Dushanbe: ["Душанбе"], "Xo'jand": ["Khujand", "Xujand", "Худжанд"], Kulob: ["Kulyab", "Куляб"], Panjikent: ["Penjikent", "Пенджикент"] },
  },
  {
    name: "Turkmaniston",
    cities: ["Ashxobod", "Turkmanobod", "Mari", "Dashoguz", "Turkmanboshi", "Farob", "Saraxs"],
    aliases: { Ashxobod: ["Ashgabat", "Ашхабад"], Turkmanobod: ["Turkmenabat", "Туркменабат"], Mari: ["Mary", "Мары"], Dashoguz: ["Дашогуз"], Farob: ["Farap", "Фараб"], Saraxs: ["Sarahs", "Серахс"] },
  },
  {
    name: "Afg'oniston",
    cities: ["Mozori Sharif", "Hayraton", "Kobul", "Hirot", "Qunduz"],
    aliases: { "Mozori Sharif": ["Mazari Sharif", "Mazar-i-Sharif", "Мазари-Шариф"], Hayraton: ["Hairatan", "Хайратон"], Kobul: ["Kabul", "Кабул"], Hirot: ["Herat", "Герат"], Qunduz: ["Kunduz", "Кундуз"] },
  },
  { name: "Eron", cities: ["Tehron", "Mashhad", "Bandar Abbos", "Tabriz"] },
  { name: "Turkiya", cities: ["Istanbul", "Mersin", "Ankara", "Izmir", "Bursa", "Trabzon"] },
  { name: "Xitoy", cities: ["Urumchi", "Qashg'ar", "Horgos", "Alashankou", "Manchjuriya", "Yiwu", "Guanchjou", "Bahti"] },
  { name: "Gruziya", cities: ["Tbilisi", "Poti", "Batumi", "Kutaisi"] },
  { name: "Ozarbayjon", cities: ["Boku", "Ganja", "Olyat"] },
  { name: "Armaniston", cities: ["Yerevan"] },
  { name: "Pokiston", cities: ["Karachi", "Lahor"] },
  { name: "Hindiston", cities: ["Dehli", "Mumbay"] },
  { name: "Mo'g'uliston", cities: ["Ulan-Bator"] },
  { name: "BAA", cities: ["Dubay"] },
  {
    name: "Rossiya",
    cities: [
      "Moskva", "Sankt-Peterburg", "Yekaterinburg", "Novosibirsk", "Krasnodar", "Samara", "Qozon", "Chelyabinsk", "Omsk",
      "Ufa", "Tyumen", "Rostov-na-Donu", "Volgograd", "Nijniy Novgorod", "Krasnoyarsk", "Irkutsk", "Orenburg", "Saratov",
      "Perm", "Surgut", "Lyubersy", "Podolsk", "Tolyatti",
    ],
  },
  { name: "Belarus", cities: ["Minsk", "Brest"] },
  { name: "Ukraina", cities: ["Kiyev", "Odessa", "Xarkov"] },
  { name: "Polsha", cities: ["Varshava"] },
  { name: "Litva", cities: ["Vilnyus", "Kaunas"] },
  { name: "Latviya", cities: ["Riga"] },
  { name: "Germaniya", cities: ["Berlin", "Gamburg"] },
];

// "Toshkent" deyilsa, ham shahar, ham viloyat tushuniladi — moslashda ular bitta hudud hisoblanadi
export const NEIGHBOR_REGIONS = {
  toshkent_sh: ["toshkent"],
  toshkent: ["toshkent_sh"],
};

// Ikki viloyat kodi bir hududmi (bir xil yoki qo'shni deb belgilangan)
export function sameArea(a, b) {
  if (!a || !b) return false;
  return a === b || (NEIGHBOR_REGIONS[a] ?? []).includes(b);
}

export const REGION_IDS = REGIONS.map((r) => r.id);
export const COUNTRY_NAMES = ["O'zbekiston", ...COUNTRIES.map((c) => c.name)];
