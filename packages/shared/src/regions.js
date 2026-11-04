// O'zbekiston viloyatlari va ulardagi asosiy shaharlar.
// Haydovchi filtrni viloyat bo'yicha tanlaydi, shuning uchun har bir e'lon viloyat kodiga bog'lanadi.
export const REGIONS = [
  { id: "toshkent_sh", name: "Toshkent shahri", cities: ["Toshkent"] },
  {
    id: "toshkent",
    name: "Toshkent viloyati",
    cities: ["Nurafshon", "Chirchiq", "Olmaliq", "Angren", "Bekobod", "Yangiyo'l", "Ohangaron", "Parkent", "G'azalkent", "Keles"],
  },
  { id: "andijon", name: "Andijon viloyati", cities: ["Andijon", "Asaka", "Xonobod", "Shahrixon", "Qo'rg'ontepa", "Marhamat"] },
  { id: "namangan", name: "Namangan viloyati", cities: ["Namangan", "Chust", "Kosonsoy", "Pop", "Uchqo'rg'on", "Chortoq"] },
  {
    id: "fargona",
    name: "Farg'ona viloyati",
    cities: ["Farg'ona", "Marg'ilon", "Qo'qon", "Quvasoy", "Quva", "Rishton", "Oltiariq", "Beshariq"],
  },
  { id: "sirdaryo", name: "Sirdaryo viloyati", cities: ["Guliston", "Yangiyer", "Shirin", "Sirdaryo", "Boyovut"] },
  { id: "jizzax", name: "Jizzax viloyati", cities: ["Jizzax", "G'allaorol", "Do'stlik", "Zomin", "Paxtakor"] },
  {
    id: "samarqand",
    name: "Samarqand viloyati",
    cities: ["Samarqand", "Kattaqo'rg'on", "Urgut", "Bulung'ur", "Ishtixon", "Jomboy"],
  },
  {
    id: "qashqadaryo",
    name: "Qashqadaryo viloyati",
    cities: ["Qarshi", "Shahrisabz", "Kitob", "G'uzor", "Koson", "Muborak", "Yakkabog'"],
  },
  {
    id: "surxondaryo",
    name: "Surxondaryo viloyati",
    cities: ["Termiz", "Denov", "Sherobod", "Sho'rchi", "Boysun", "Jarqo'rg'on"],
  },
  { id: "buxoro", name: "Buxoro viloyati", cities: ["Buxoro", "G'ijduvon", "Kogon", "Qorako'l", "Romitan", "Vobkent", "Olot"] },
  { id: "navoiy", name: "Navoiy viloyati", cities: ["Navoiy", "Zarafshon", "Uchquduq", "Karmana", "Nurota", "Qiziltepa"] },
  { id: "xorazm", name: "Xorazm viloyati", cities: ["Urganch", "Xiva", "Xonqa", "Hazorasp", "Gurlan", "Shovot"] },
  {
    id: "qoraqalpogiston",
    name: "Qoraqalpog'iston Respublikasi",
    cities: ["Nukus", "Xo'jayli", "Beruniy", "To'rtko'l", "Chimboy", "Qo'ng'irot", "Mo'ynoq"],
  },
  { id: "xorij", name: "Xorij (O'zbekistondan tashqari)", cities: [] },
];

export const REGION_IDS = REGIONS.map((r) => r.id);
