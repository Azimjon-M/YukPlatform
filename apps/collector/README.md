# collector — Userbot

Oddiy Telegram akkaunt orqali yuk guruhlari va kanallarini o'qiydi. Guruh adminidan ruxsat kerak emas.

| Bosqich | Nima qiladi | Holati |
|---|---|---|
| 0 | Guruhlardagi oxirgi xabarlarni `data/samples/elonlar.txt` ga yig'adi (parserni sinash uchun) | ✅ tayyor |
| 1 | Jonli rejim: guruhlarni har daqiqada tekshirib, yangi e'lonlarni bot navbatiga (`data/yuk.db`) qo'yadi | ✅ tayyor |

**Nima uchun botdan alohida:** userbot bloklansa yoki to'xtab qolsa ham bot ishlashda davom etadi.

## Birinchi sozlash (bir marta)

1. [my.telegram.org](https://my.telegram.org) → **API development tools** → ilova yarating (nomi ixtiyoriy).
2. `api_id` va `api_hash` ni **o'zingiz** `.env` fayliga yozing: `TG_API_ID=...`, `TG_API_HASH=...`.
3. O'z terminalingizda (YukPlatform papkasida) kiring:

   ```bash
   npm run tg:login
   ```

   Telefon raqam, Telegram yuborgan kod va 2FA parol (bo'lsa) so'raladi. Ularni faqat o'zingiz kiritasiz.
   Sessiya `apps/collector/telegram.session` fayliga saqlanadi va keyingi safar qayta kirish shart emas.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm run tg:login` | Telegram'ga kirish (bir marta) |
| `npm run tg:dialogs` | Akkaunt a'zo bo'lgan guruh/kanallar ro'yxati (manzil yoki id bilan) |
| `npm run tg:search -- yuk "yuk markazi" груз` | Telegram qidiruvidan ochiq guruh/kanallarni topadi (qo'shilmasdan), a'zolar soni bo'yicha |
| `npm run tg:export -- @guruh1 t.me/guruh2` | Har biridan oxirgi 100 ta xabarni `elonlar.txt` ga qo'shadi |
| `npm run tg:export -- @guruh --limit 300` | Har bir chatdan 300 ta xabar |
| `npm run tg:live` | Jonli rejim: `.env` dagi `TG_SOURCES` guruhlarini har 60 s tekshiradi |
| `npm run tg:live -- @guruh1 @guruh2 --interval 90 --backfill 20` | Boshqa guruhlar, 90 s da bir, boshida oxirgi 20 ta xabardan |
| `npm run tg:logout` | Sessiyani Telegram'da bekor qiladi va faylini o'chiradi |

`tg:export` haqida:

- Ochiq guruh: `@nom`, `t.me/nom` yoki `https://t.me/nom`. Yopiq guruh: avval akkaunt bilan qo'shiling, keyin `tg:dialogs` ko'rsatgan **id** ni yozing. Taklif havolasi (`t.me/+...`) qabul qilinmaydi.
- 20 belgidan qisqa xabarlar ("ok", "rahmat") va takrorlar (fayldagilar bilan ham) tashlab ketiladi.
- Fayl ustidan yozilmaydi, oxiriga qo'shiladi. Qayta ishga tushirsangiz, faqat yangi e'lonlar qo'shiladi.

Keyin: `npm run parse -- --dry-run`, so'ng `npm run parse -- --limit 20`.

## Jonli rejim (`tg:live`)

- Guruhlar `.env` da: `TG_SOURCES=@yuk_markazi_gruupa,@yuklar_isuzi_furalar,@TutGruz`.
- Telegram yangi xabar haqida faqat akkaunt **a'zo** bo'lgan chatlar uchun xabar beradi. Biz guruhlarga qo'shilmaymiz, ochiq guruh tarixini a'zo bo'lmasdan o'qish mumkin. Shuning uchun har daqiqada "oxirgi o'qilgandan keyingi xabarlar" so'raladi. 30 soniyadan tez so'rash mumkin emas (FLOOD_WAIT xavfi).
- Birinchi ishga tushganda eski xabarlar olinmaydi, faqat bundan keyingilari (`--backfill N` — oxirgi N tadan boshlash).
- Qayergacha o'qilgani bazada saqlanadi: to'xtatib qayta yoqsangiz, o'tkazib yuborilgan xabarlar ham olinadi.
- Qisqa xabarlar va 3 kun ichida takrorlangan matn AI'ga yuborilmaydi.
- E'lonlarni tahlil qilib yuboradigan — bot: `npm run bot`.

## Xavfsizlik

- Alohida telefon raqamdagi akkaunt ishlating, shaxsiy (Premium) akkauntingiz emas: bloklansa, asosiy akkaunt yo'qolmaydi
- Faqat o'qing, hech narsa yozmang. Ko'p guruhga birdaniga qo'shilmang
- `telegram.session` fayli (yoki `TG_SESSION`) = akkauntga to'liq kirish. U gitga tushmaydi (`*.session`), hech kimga bermang
- Sessiya qo'lga tushdi deb o'ylasangiz: `npm run tg:logout` yoki Telegram → Settings → Devices → sessiyani yoping

## Texnik eslatmalar

- **Kutubxona:** GramJS (`telegram` paketi). 2026-yilda arxivlangan, davomi `teleproto` forki. Telegram bilan ishlaydigan butun kod `src/telegram.js` da, shuning uchun almashtirish oson.
- **Port 443:** Node'da GramJS standart holatda 80-portdan ulanadi. Bizning tarmoqda 80-portdagi MTProto javobsiz qoladi va ulanish osilib turadi. Shuning uchun `useWSS: true` qo'yilgan: Node'da u TLS yoqmaydi, ulanishni 443-portga o'tkazadi, xolos.
- **Kirish:** `src/prompt.js` 2FA parolni yashirin o'qiydi (har belgi o'rniga `*`). `src/authErrors.js` qaysi xatoda qayta so'rashni (noto'g'ri kod yoki parol, ko'pi bilan 3 marta) va qaysi birida to'xtashni hal qiladi. Raqamda akkaunt bo'lmasa, yangi akkaunt ochilmaydi, kirish to'xtaydi.
- `src/sources.js` (manzilni tekshirish), `src/samples.js` (tozalash, takrorni olib tashlash), `src/live.js` (jonli rejim), `prompt.js` va `authErrors.js` Telegram'siz test qilinadi: `npm test`.
