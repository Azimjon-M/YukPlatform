# shared — Umumiy ma'lumotlar

Barcha dasturlar (parser, api, bot, web, mobile) bir xil ma'lumotlarni shu yerdan oladi.
Faktlar manbai: [docs/haydovchi-suhbati.md](../../docs/haydovchi-suhbati.md).

| Fayl | Ichida |
|---|---|
| `regions.js` | 14 viloyat + xorij, ulardagi shahar va tuman markazlari, boshqa yozilishlar, Toshkent tumanlari, xorijiy davlatlar, `sameArea` (Toshkent shahri = viloyati) |
| `vehicles.js` | Mashina sinfi (fura, mini fura, isuzu, kichik, labo, sig'imi bilan), kuzov turi (tent, ref, ploshatka, tral...), yuklash tomoni, palet |
| `categories.js` | Turlar (fura / yengil / pochta / yo'lovchi), e'lon turi, narx birligi, to'lov turi, valyuta; `cargoCategory` — toifani mashina sinfi yoki og'irlikdan (10 t va undan ortiq → fura) hisoblaydi |
| `places.js` | Shahar nomini ro'yxatdan topish (`lookupCity`): viloyat va davlatni beradi; `normalizePlaces` — AI javobidagi viloyatni ro'yxat bo'yicha to'g'rilaydi, "Toshkent Nazarbek" kabi viloyat + shaharda shaharni oladi |
| `match.js` | Yuk haydovchining mashinasi va yo'nalishiga mos keladimi (`matchLoad` → `{ok, reasons}`), yuk kimlarga yuboriladi (`findDrivers`) |
| `profile.js` | Haydovchi profili: sig'im/xalqaro/rejim variantlari, `sanitizeProfile` (Mini App'dan kelgan ma'lumotni tekshiradi), `encodeProfile` / `decodeProfile` (Mini App manzilidagi `?p=`) — bot va web bir xil qoidalar bilan ishlaydi |
| `dedupe.js` | Bitta yuk ko'p guruhda takrorlansa, uni bir marta yuborish uchun kalit (`loadKey`) va 3 kunlik xotira (`createDeduper`) |

Test: `npm test` (YukPlatform papkasida).

## Moslash qoidalari (`match.js`)

- E'londa yozilmagan narsa cheklov emas: og'irligi yozilmagan yuk har qanday mashinaga mos.
- Og'irlik ≤ mashina sig'imi; hajm ≤ kuzov kubi (uzunlik × eni × balandligi); palet ≤ kuzovga sig'adigan yevropalet (fura — 33).
- Sinf (fura, isuzu...) va kuzov (tent, ref...) yozilgan bo'lsa, aynan shu bo'lishi kerak: Isuzu haydovchisi faqat o'ziga mos yukni ko'radi.
- Yuklash tomoni: e'londagi tomonlardan birortasi mashinada bo'lsa yetadi. Chap/o'ng — mashinaga orqasidan qaraganda.
- `mode: "all"` (hammasini ko'rish) — mashina tekshirilmaydi, yo'nalish tekshiriladi.
- Xalqaro yuk faqat `international: true` bo'lgan haydovchiga. Toshkent shahri va viloyati bitta hudud. Faqat viloyat yozilgan yuk shu viloyatdagi haydovchilarga boradi. `toAreas` — qaytish yuki uchun uy viloyati.
