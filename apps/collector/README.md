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
| `npm run tg:login -- --account ikkinchi` | **Qo'shimcha akkaunt** bilan kirish (yopiq guruhlar uchun, pastda). `--account` `tg:dialogs`, `tg:logout`, `tg:search`, `tg:export` da ham ishlaydi |

`tg:export` haqida:

- Ochiq guruh: `@nom`, `t.me/nom` yoki `https://t.me/nom`. Yopiq guruh: avval akkaunt bilan qo'shiling, keyin `tg:dialogs` ko'rsatgan **id** ni yozing. Taklif havolasi (`t.me/+...`) qabul qilinmaydi.
- 20 belgidan qisqa xabarlar ("ok", "rahmat") va takrorlar (fayldagilar bilan ham) tashlab ketiladi.
- Fayl ustidan yozilmaydi, oxiriga qo'shiladi. Qayta ishga tushirsangiz, faqat yangi e'lonlar qo'shiladi.

Keyin: `npm run parse -- --dry-run`, so'ng `npm run parse -- --limit 20`.

## Jonli rejim (`tg:live`)

- Guruhlar `.env` da: `TG_SOURCES=@yuk_markazi_gruupa,@yuklar_isuzi_furalar,@TutGruz`.
- Ikki yo'l bor (2026-11-09 dan ikkalasi birga):
  - **Jonli** — akkaunt **a'zo** bo'lgan guruhdagi yangi xabarni Telegram o'zi yuboradi, ~1 soniyada navbatda (GramJS `NewMessage`). Bildirishnoma kerak emas: guruhni ovozsiz qilib, arxivga solsangiz ham keladi. Lekin a'zolikning o'zi yetmaydi: Telegram ba'zi (odatda katta) guruhlardan update'ni umuman yubormaydi — 09.11 da @Uzbyukmarkazi'dan e'lon 0 s da keldi, @TutGruz'dan 4 daqiqada birortasi ham kelmadi. Shuning uchun a'zo guruh ham avval har 60 s so'raladi; jonli xabar haqiqatan kela boshlasa — har 3 daqiqada (zaxira tekshiruv). Zaxira tekshiruv jonli kelmay qolgan e'lon topsa, guruh yana har 60 s ga qaytadi va ketma-ket 3 marta toza chiqqandagina 3 daqiqaga o'tadi (logda «jonli kelmay qolgan N ta» / «jonli xabarlar to'liq kelyapti»). Har 10 daqiqada logga «Jonli tinglash: … update» tashxisi yoziladi (Telegram qancha va qanday update yubordi, manbalardan nechtasi).
  - **So'rab turish** — a'zo bo'lmagan ochiq guruh tarixini ham o'qish mumkin, shuning uchun har ~60 s da "oxirgi o'qilgandan keyingi xabarlar" so'raladi (har guruhdan keyin 2 s tanaffus, ya'ni bitta guruh ~72 s da bir). 30 soniyadan tez so'rash mumkin emas (FLOOD_WAIT xavfi).
- Kim a'zo — har 10 daqiqada bitta so'rov bilan (`channels.getChannels`, `left` belgisi) tekshiriladi va `sources.joined` ga yoziladi: guruhga qo'shilsangiz, 10 daqiqa ichida o'zi jonliga o'tadi. Boshqaruv markazining «Manbalar» bo'limida ⚡ Jonli / 🔄 Har 60 s va o'rtacha kechikish ko'rinadi.
- Bir xabar ikki yo'ldan kelsa ham bazaga bir marta yoziladi (`posts` da `UNIQUE (source, message_id)`); `posts.via` — `live` yoki `poll`. Bot jonli e'lonni 30 s, so'rab olinganini 90 s gacha yig'ib AI'ga beradi (`PARSER_LIVE_WAIT`, `PARSER_BATCH_WAIT`).
- Birinchi ishga tushganda eski xabarlar olinmaydi, faqat bundan keyingilari (`--backfill N` — oxirgi N tadan boshlash).
- **Foydalanuvchi qo'shgan guruh (2026-11-10, `src/probe.js`):** bot «tekshiruv» (`sources.check_state = 'probe'`) holatida qo'ygan guruhning oxirgi 50 ta xabari bitta so'rov bilan o'qiladi va AI'siz baholanadi (`@yuk/parser/rules` `looksLikeLoad`: joy + telefon yoki yuk belgisi; 10.11 da 6 000 e'londa AI bilan 99,9% mos). Kamida 3 tasi yuk e'loniga o'xshasa (va ularda telefon raqami yoki yozgan odamning username'i bo'lsa — bot aloqasiz e'lonni baribir yubormaydi, `.env` `REQUIRE_CONTACT=0` — sanalmaydi ham) va oxirgi xabar 7 kundan yangi bo'lsa — sinov boshlanadi: manba yoqiladi, oxirgi 3 soatdagi e'lonlari navbatga, kursor — oxirgi xabarda. Aks holda rad etiladi. 30 soniyada ko'pi bilan bitta (guruh nomini aniqlash Telegram'da qattiq cheklangan); «bunday guruh yo'q» — darhol rad, boshqa xato — 1 va 2 daqiqadan keyin qayta, uchinchisida rad. Sinov natijasini bot kuzatadi.
- Qayergacha o'qilgani bazada saqlanadi: to'xtatib qayta yoqsangiz, o'tkazib yuborilgan xabarlar ham olinadi.
- Qisqa xabarlar va 3 kun ichida takrorlangan matn AI'ga yuborilmaydi.
- E'lonlarni tahlil qilib yuboradigan — bot: `npm run bot`.

## Bir nechta akkaunt — yopiq guruhlar (2026-11-13, `src/accounts.js`)

Ochiq guruhni a'zo bo'lmasdan ham o'qisa bo'ladi, yopig'ini — faqat unga **a'zo** akkaunt. Shuning uchun collector bir nechta akkaunt bilan ishlaydi:

- **asosiy** — avvalgi akkaunt (`telegram.session` yoki `TG_SESSION`): hamma ochiq guruh, foydalanuvchi qo'shgan guruhlarni tekshirish, «A'zo bo'lish» navbati.
- **qo'shimcha** — `apps/collector/sessions/<nom>.session` (gitga tushmaydi): faqat o'ziga biriktirilgan guruhlarni (`sources.account`) o'qiydi. Tekshirish va a'zo bo'lish navbati unda yo'q.

Qo'shish tartibi:

1. Alohida raqamdagi akkaunt. Yopiq guruh a'zosi (masalan, haydovchi) shu akkauntni guruhga qo'shadi.
2. **Serverda**, loyiha papkasida: `npm run tg:login -- --account ikkinchi` (nom: kichik lotin harfi bilan, 2–20 belgi, «asosiy» emas). Kod va 2FA parolni **akkaunt egasining o'zi** terminalga yozadi — ularni hech qanday bot, chat yoki sahifaga yubormang (bunday imkoniyat ataylab yo'q).
3. Ishlab turgan `tg:live` `sessions/` papkasini har 30 s da qaraydi: yangi akkaunt o'zi ulanadi, kimligi va a'zo bo'lgan guruhlari ro'yxati bazaga yoziladi (`tg_accounts`, `tg_dialogs`; ro'yxat 30 daqiqada bir yoki boshqaruv markazidagi «Ro'yxatni yangilash» bilan 1 daqiqada yangilanadi).
4. Boshqaruv markazi → «Manbalar» → «Yopiq guruh qo'shish»: ro'yxatdan guruhni tanlang. Yopiq guruh id bilan (`-100…`, kichik guruh `-…`) shu akkauntga biriktiriladi; e'lonlarga havola bo'lmaydi (yopiq guruh xabarini a'zo bo'lmagan haydovchi ocha olmaydi), qolgani — boshqa guruhlarnikidek.

Har akkaunt o'z halqasida va o'z sur'atida ishlaydi (`TG_POLL_BUDGET` — har biriga). Qo'shimcha akkauntning xatosi asosiyni to'xtatmaydi: ulanib bo'lmasa 1, 2, 4 … 30 daqiqadan keyin qayta urinadi; sessiyasi bekor qilingan (`AUTH_KEY_*`, `SESSION_REVOKED`) yoki boshqa nom bilan ulangan akkauntning o'zi bo'lsa — egasi qayta kirmaguncha (fayl o'zgarmaguncha) urinmaydi. Fayl o'chirilsa (`tg:logout -- --account …`) — akkaunt to'xtaydi. Asosiy akkaunt sessiyasi yo'q yoki bekor qilingan bo'lsa — collector `EXIT_CONFIG` (78) bilan chiqadi va boshqaruv markazi uni qayta-qayta yoqmaydi.

## Xavfsizlik

- Alohida telefon raqamdagi akkaunt ishlating, shaxsiy (Premium) akkauntingiz emas: bloklansa, asosiy akkaunt yo'qolmaydi
- Faqat o'qing, hech narsa yozmang. Ko'p guruhga birdaniga qo'shilmang
- `telegram.session` fayli (yoki `TG_SESSION`) va `sessions/*.session` = akkauntga to'liq kirish. Ular gitga tushmaydi (`*.session`), hech kimga bermang; serverda faqat egasi o'qiy oladi (0600)
- Sessiya qo'lga tushdi deb o'ylasangiz: `npm run tg:logout` yoki Telegram → Settings → Devices → sessiyani yoping

## Texnik eslatmalar

- **Kutubxona:** GramJS (`telegram` paketi). 2026-yilda arxivlangan, davomi `teleproto` forki. Telegram bilan ishlaydigan butun kod `src/telegram.js` da, shuning uchun almashtirish oson.
- **Port 443:** Node'da GramJS standart holatda 80-portdan ulanadi. Bizning tarmoqda 80-portdagi MTProto javobsiz qoladi va ulanish osilib turadi. Shuning uchun `useWSS: true` qo'yilgan: Node'da u TLS yoqmaydi, ulanishni 443-portga o'tkazadi, xolos.
- **Kirish:** `src/prompt.js` 2FA parolni yashirin o'qiydi (har belgi o'rniga `*`). `src/authErrors.js` qaysi xatoda qayta so'rashni (noto'g'ri kod yoki parol, ko'pi bilan 3 marta) va qaysi birida to'xtashni hal qiladi. Raqamda akkaunt bo'lmasa, yangi akkaunt ochilmaydi, kirish to'xtaydi.
- `src/sources.js` (manzilni tekshirish), `src/samples.js` (tozalash, takrorni olib tashlash), `src/live.js` (jonli rejim), `prompt.js` va `authErrors.js` Telegram'siz test qilinadi: `npm test`.
