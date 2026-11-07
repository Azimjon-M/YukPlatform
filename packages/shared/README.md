# shared — Umumiy ma'lumotlar

Barcha dasturlar (parser, api, bot, web, mobile) bir xil ma'lumotlarni shu yerdan oladi.
Faktlar manbai: [docs/haydovchi-suhbati.md](../../docs/haydovchi-suhbati.md).

| Fayl | Ichida |
|---|---|
| `regions.js` | 14 viloyat + xorij, ulardagi shahar va tuman markazlari, boshqa yozilishlar, Toshkent tumanlari, xorijiy davlatlar, `sameArea` (Toshkent shahri = viloyati) |
| `vehicles.js` | Transport turi (katta fura, kamaz, fura, mini fura, katta isuzu, isuzu, kichik, labo, yengil mashina — sig'imi, odatdagi kuzovi, AI «oilasi» bilan), kuzov turi (plashatka, tent, skotovoz, ref, izoterm, samosval, sisterna, konteyner, manipulyator, tyagach; eski kodlar `BODY_ALIASES` orqali), yuklash tomoni, palet |
| `categories.js` | Turlar (fura / yengil / pochta / yo'lovchi), e'lon turi, narx birligi, to'lov turi, valyuta; `cargoCategory` — toifani mashina sinfi yoki og'irlikdan (10 t va undan ortiq → fura) hisoblaydi |
| `places.js` | Shahar nomini ro'yxatdan topish (`lookupCity`): viloyat va davlatni beradi; `normalizePlaces` — AI javobidagi viloyatni ro'yxat bo'yicha to'g'rilaydi, "Toshkent Nazarbek" kabi viloyat + shaharda shaharni oladi |
| `match.js` | Yuk haydovchining mashinasi va yo'nalishiga mos keladimi (`matchLoad` → `{ok, reasons}`), yuk kimlarga yuboriladi (`findDrivers`) |
| `profile.js` | Haydovchi profili: sig'im/xalqaro variantlari, `sanitizeProfile` (Mini App'dan kelgan ma'lumotni tekshiradi), `encodeProfile` / `decodeProfile` (Mini App manzilidagi `?p=`), `routeChosen` / `withRoute` (yo'nalish «📋 Mos yuklar» da tanlanadi, forma saqlaganda eskisi qoladi) — bot va web bir xil qoidalar bilan ishlaydi |
| `profileText.js` | Profil matni: bot xabari va web «Tekshiring» qatorlari bir manbadan |
| `route.js` | Haydovchining yo'nalishi («📍 Qayerdan?» → «🏁 Qayerga?»): `routeAreas` (joylar «Qayerda ishlaysiz?» ga qarab), `routeCounts` (har tugmadagi mos yuklar soni), `applyRoute`, `validRouteArea`, `routeSide`. Bot tugmalari (`apps/bot/src/route.js`) va web server (`/pub/me/route`) shundan |
| `loadText.js` | Joy, narx, transport, og'irlik matnlari (`weightText`: 1 tonnadan kami — kg, qolgani — «tonna») |
| `dedupe.js` | Bitta yuk ko'p guruhda takrorlansa, uni bir marta yuborish uchun kalit (`loadKey`) va 3 kunlik xotira (`createDeduper`) |

Test: `npm test` (YukPlatform papkasida).

## Moslash qoidalari (`match.js`)

- E'londa yozilmagan narsa cheklov emas: og'irligi yozilmagan yuk har qanday mashinaga mos.
- Og'irlik ≤ mashina sig'imi; hajm ≤ kuzov kubi (uzunlik × eni × balandligi); palet ≤ kuzovga sig'adigan yevropalet (fura — 33).
- Sinf (fura, isuzu...) yozilgan bo'lsa, haydovchining transporti shu «oila»dan bo'lishi kerak (katta fura — fura oilasi, katta isuzu — isuzu oilasi): Isuzu haydovchisi faqat o'ziga mos yukni ko'radi. Kuzov aniq mos kelishi kerak, faqat ref izotermik yukni, plashatka konteyner yukini ham oladi (`bodyFits`).
- Yuklash tomoni: e'londagi tomonlardan birortasi mashinada bo'lsa yetadi. Chap/o'ng — mashinaga orqasidan qaraganda.
- Mashina doim tekshiriladi: eski `mode: "all"` (hammasini ko'rish) 2026-11-07 dan e'tiborsiz.
- Yo'nalishni haydovchi botdagi «📋 Mos yuklar» da tanlaydi (`routeAt`); tanlamaguncha bot unga yuk yubormaydi (`apps/bot/src/pipeline.js`).
- Xalqaro yuk faqat `international: true` bo'lgan haydovchiga. Toshkent shahri va viloyati bitta hudud. Faqat viloyat yozilgan yuk shu viloyatdagi haydovchilarga boradi. `toAreas` — qaytish yuki uchun uy viloyati.
