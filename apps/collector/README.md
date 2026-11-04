# collector — Userbot

Oddiy Telegram akkaunt orqali yuk guruhlari va kanallarini o'qiydi. Guruh adminidan ruxsat kerak emas.

| Bosqich | Nima qiladi | Holati |
|---|---|---|
| 0 | Guruhlardagi oxirgi xabarlarni `data/samples/elonlar.txt` ga yig'adi (parserni sinash uchun) | ✅ tayyor |
| 1 | Yangi xabarlarni real vaqtda o'qib, `api` ga yuboradi | — |

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
| `npm run tg:logout` | Sessiyani Telegram'da bekor qiladi va faylini o'chiradi |

`tg:export` haqida:

- Ochiq guruh: `@nom`, `t.me/nom` yoki `https://t.me/nom`. Yopiq guruh: avval akkaunt bilan qo'shiling, keyin `tg:dialogs` ko'rsatgan **id** ni yozing. Taklif havolasi (`t.me/+...`) qabul qilinmaydi.
- 20 belgidan qisqa xabarlar ("ok", "rahmat") va takrorlar (fayldagilar bilan ham) tashlab ketiladi.
- Fayl ustidan yozilmaydi, oxiriga qo'shiladi. Qayta ishga tushirsangiz, faqat yangi e'lonlar qo'shiladi.

Keyin: `npm run parse -- --dry-run`, so'ng `npm run parse -- --limit 20`.

## Xavfsizlik

- Alohida telefon raqamdagi akkaunt ishlating, shaxsiy (Premium) akkauntingiz emas: bloklansa, asosiy akkaunt yo'qolmaydi
- Faqat o'qing, hech narsa yozmang. Ko'p guruhga birdaniga qo'shilmang
- `telegram.session` fayli (yoki `TG_SESSION`) = akkauntga to'liq kirish. U gitga tushmaydi (`*.session`), hech kimga bermang
- Sessiya qo'lga tushdi deb o'ylasangiz: `npm run tg:logout` yoki Telegram → Settings → Devices → sessiyani yoping

## Texnik eslatmalar

- **Kutubxona:** GramJS (`telegram` paketi). 2026-yilda arxivlangan, davomi `teleproto` forki. Telegram bilan ishlaydigan butun kod `src/telegram.js` da, shuning uchun almashtirish oson.
- **Port 443:** Node'da GramJS standart holatda 80-portdan ulanadi. Bizning tarmoqda 80-portdagi MTProto javobsiz qoladi va ulanish osilib turadi. Shuning uchun `useWSS: true` qo'yilgan: Node'da u TLS yoqmaydi, ulanishni 443-portga o'tkazadi, xolos.
- **Kirish:** `src/prompt.js` 2FA parolni yashirin o'qiydi (har belgi o'rniga `*`). `src/authErrors.js` qaysi xatoda qayta so'rashni (noto'g'ri kod yoki parol, ko'pi bilan 3 marta) va qaysi birida to'xtashni hal qiladi. Raqamda akkaunt bo'lmasa, yangi akkaunt ochilmaydi, kirish to'xtaydi.
- `src/sources.js` (manzilni tekshirish), `src/samples.js` (tozalash, takrorni olib tashlash), `prompt.js` va `authErrors.js` Telegram'siz test qilinadi: `npm test`.
