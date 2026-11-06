# bot — Telegram bot (@Yuk_Ekspert_agent)

**Bosqich:** 1 (MVP) ⏳ kod tayyor va testlardan o'tgan, haqiqiy haydovchilar bilan sinov kutilyapti

- **Rollar (2026-11-06):** `/start` da bot «Siz kimsiz?» deb so'raydi:

  | Rol | Nima oladi | Sozlamalar |
  |---|---|---|
  | 🚚 Haydovchi | «yuk bor» e'lonlari — mashinasi va yo'nalishiga mos | mashina, kuzov, sig'im, o'lcham, tomon, yo'nalish |
  | 📦 Yuk beruvchi (yuk egasi, dispetcher) | «mashina bo'sh» e'lonlari — yo'nalishi va kerakli mashinaga mos | qayerdan, qayerga, mashina turlari, kuzovlar |

  «Mashina bo'sh» e'lonlarini AI baribir ajratardi (ilgari tashlab yuborilardi) — yuk beruvchilar **AI limitiga qo'shimcha so'rov qo'shmaydi**.
  Rolni almashtirish — `/rol` (eski sozlamalar o'chadi). Admin — rol emas: `ADMIN_IDS` yoki boshqaruv markazidagi belgi; adminning menyusida «🛠 Boshqaruv» (Mini App ichida).
  Pullik obuna hali yo'q: bazada `plan` ustuni (hammasi `free`) va `planAllows()` (`packages/shared/src/roles.js`) — keyin shu yerda cheklanadi.

- **Pastki menyu** — yozuv qatori ostida doim turadigan tugmalar (javob xabariga tugma yopishtirilmaydi):

  | Tugma | Nima qiladi |
  |---|---|
  | 📋 Mos yuklar / 🚚 Bo'sh mashinalar | Rolga qarab: oxirgi 24 soatdagi mos yuklar yoki bo'sh mashinalar (eng yangi 5 tasi) |
  | 🚚 Ro'yxatdan o'tish / ⚙️ Sozlamalar | Mini App formasini ochadi (`MINIAPP_URL` bo'lsa). Bo'lmasa — chatda savol-javob |
  | ⏸ Pauza / ▶️ Davom ettirish | Yuk yuborishni to'xtatadi yoki yoqadi. Tugma yozuvi holatga qarab almashadi |
  | 📱 Ilovalar | Android/iPhone havolalari yoki APK fayl (bo'lmasa "tez orada"); kanal — faqat `CHANNEL_LOADS=1` bo'lsa |
  | ❓ Yordam | Yordam |
  | 🛠 Boshqaruv | Faqat adminlarga: Mini App'ning boshqaruv bo'limi (`?v=admin`) |

- **Sozlamalar:** mashina turi, kuzov, sig'im, kuzov o'lchami, yuklash tomoni, qayerdan/qayerga (xalqaroda davlatlar ham), xalqaro, rejim. Mini App: [apps/web](../web/README.md)
- Navbatdagi e'lonlarni AI bilan tahlil qiladi, takrorni tashlaydi, yangi yukni **mos haydovchilarga**, bo'sh mashinani **mos yuk beruvchilarga** shaxsiy xabar qilib yuboradi (kanalga — faqat `CHANNEL_LOADS=1` bo'lsa). Shaxsiy xabarda tugma yo'q: telefon raqami bosiladi, "📄 Asl e'lon" — matn ichidagi havola.
- Admin bo'lgan guruhlardagi e'lonlarni ham navbatga qo'yadi (o'z kanalining nusxalaridan tashqari)

## Sozlash (bir marta)

1. @BotFather → `/newbot` → token. ✅ qilingan: `@Yuk_Ekspert_agent`
2. `.env` fayliga **o'zingiz** yozing:

   | O'zgaruvchi | Misol | Izoh |
   |---|---|---|
   | `BOT_TOKEN` | — | BotFather bergan token. Chatga yozmang |
   | `CHANNEL_ID` | `@Yuk_Ekspert` | Loyihaning kanali. Bot o'z kanalidagi (va muhokama guruhidagi) postlarni yangi e'lon deb navbatga olmaydi |
   | `CHANNEL_LOADS` | `1` | Yuklarni kanalga ham joylash. Standart — **yo'q** (2026-11-06): yuklar faqat mos haydovchilarga shaxsiy xabarda boradi. Kanal va guruh keyin boshqa maqsadda ishlatiladi |
   | `ADMIN_IDS` | `123456789` | Adminlar: `/holat` buyrug'i va menyudagi «🛠 Boshqaruv». O'z id'ingizni botga `/id` yozib bilasiz. Boshqaruv markazida ham «Admin» qilish mumkin |
   | `MINIAPP_URL` | `https://yuk-ekspert.pages.dev` | Mini App manzili ([qanday joylash](../web/README.md)). Bo'sh bo'lsa — chatda savol-javob |
   | `ANDROID_URL`, `IOS_URL` | `https://play.google.com/...` | Ixtiyoriy: «📱 Ilovalar» tugmasidagi havolalar |
   | `APK_FILE` | `data/apk/yuk-ekspert.apk` | Ixtiyoriy: Android o'rnatish fayli (50 MB gacha), bot o'zi yuboradi |
   | `ROUTE_SCOPE` | `qoshni` | Qaysi yo'nalishlar: `qoshni` (standart) — O'zbekiston ichi va O'zbekiston ↔ Qozog'iston, Qirg'iziston, Tojikiston, Turkmaniston, Afg'oniston; `ichki` — faqat O'zbekiston ichi; `hammasi` — cheklovsiz. Haydovchi sozlamalarida (savol-javob, Mini App) ham faqat shu doiradagi davlatlar chiqadi |
   | `POST_MAX_AGE_HOURS` | `3` | Joylanganiga shuncha soatdan oshgan e'lon AI'ga bormaydi: boshqaruv markazida «Tayyor», izohi «Eskirgan». Bot o'chib turganda to'plangan kechagi e'lonlar kanalga "yangi yuk" bo'lib chiqmaydi va bepul AI limitini yemaydi. `0` — cheklovsiz. `--dry-run` bu cheklovni ishlatmaydi |

3. Botni kanalga **admin** qiling. Telefonda shu havolani oching va kanalni tanlang:
   <https://t.me/Yuk_Ekspert_agent?startchannel&admin=post_messages>
   Telegram botni "Post messages" huquqi bilan admin qiladi. Boshqa yo'llar ishlamaydi:
   - bot profilidagi "Add to group" kanallarni ko'rsatmaydi;
   - kanal ichidagi qidiruvda bot ko'pincha chiqmaydi;
   - bot taklif havolasi (invite link) orqali qo'shila olmaydi.
4. Muhokama guruhida (@Yuk_Ekspert_chat) ham admin qiling, agar guruhdagi e'lonlarni ham yig'moqchi bo'lsangiz: Guruh → Administratorlar → Admin qo'shish → bot (huquqlar shart emas). Bot guruhda faqat admin bo'lsa hamma xabarni ko'radi, chunki privacy mode yoqilgan.
5. Tekshirish:

   ```bash
   npm run bot:check
   ```

   Token ishlayaptimi va bot kanalda xabar joylay oladimi — shuni ko'rsatadi.

## Ishga tushirish (YukPlatform papkasida, ikkita terminal)

```bash
npm run bot                       # 1-terminal: bot + ishchi (navbatdagi e'lonlarni yuboradi)
npm run tg:live                   # 2-terminal: guruhlardan yangi e'lonlarni navbatga yig'adi (apps/collector)
```

Sinov uchun, Telegram'ga hech narsa yubormasdan:

```bash
npm run bot -- --dry-run          # navbatdagi e'lonlarni tahlil qilib, xabarni ekranga chiqaradi
```

Alohida bazada sinash: buyruq oldidan `YUK_DB=data/sinov.db` (bash). Haqiqiy baza: `data/yuk.db`.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `/start` | Salom, pastki menyu (yo'qolsa ham qaytaradi); rol tanlanmagan bo'lsa «Siz kimsiz?» |
| `/sozlamalar` | Sozlamalarni o'zgartirish (eski javoblar belgilangan holda) |
| `/rol` | Haydovchi ↔ yuk beruvchi |
| `/pauza`, `/davom` | Yuborishni to'xtatish / yoqish |
| `/yordam` | Yordam |
| `/id` | Telegram id raqami (ADMIN_IDS uchun) |
| `/holat` | Faqat adminlar: haydovchilar, yuk beruvchilar, navbat, oxirgi 24 soatdagi yuklar va bo'sh mashinalar |

## Qanday ishlaydi

```
collector (tg:live) ─┐                                    ┌─► kanal @Yuk_Ekspert (faqat CHANNEL_LOADS=1)
                     ├─► navbat (data/yuk.db) ─► ishchi ──┼─► «yuk bor» → mos haydovchilarga shaxsiy xabar
guruh (bot admin)  ──┘    AI → takror? → baza             └─► «mashina bo'sh» → mos yuk beruvchilarga
```

- **Takror:** bir xil matn 3 kun ichida qayta kelsa — AI'ga yuborilmaydi (bepul limit tejaladi). Boshqacha yozilgan o'sha yuk (o'sha telefon, yo'nalish, kuzov, og'irlik) — haydovchiga ikkinchi marta yuborilmaydi.
- **Gemini limiti:** daqiqalik limit tugasa, Google aytgan vaqtcha kutadi. Kunlik limit tugasa, 30 daqiqada bir tekshirib turadi. E'lonlar navbatda kutadi, yo'qolmaydi.
- **Foydalanuvchi botni bloklasa,** unga boshqa yuborilmaydi.

## Muhim

- Inline tugmalarda `tel:` **ishlamaydi**, faqat `https://` va `tg://` havolalari ishlaydi.
  Telefon raqami matnda `+998901234567` ko'rinishida yoziladi: Telegram uni o'zi bosiladigan qiladi va bosganda qo'ng'iroq qilish taklif qilinadi.
- Kanalga joylash (`CHANNEL_LOADS=1`) uchun bot kanalda **admin** bo'lishi shart. Guruhda hamma xabarni ko'rish uchun admin bo'lishi yoki BotFather'da privacy mode o'chirilgan bo'lishi kerak.
- Kanalga ulangan muhokama guruhiga kanal postlari avtomatik nusxalanadi. Bot ularni e'lon deb qayta olmaydi.
- Bot bir vaqtda faqat **bitta** nusxada ishlaydi: ikkinchi `npm run bot` ochilsa, Telegram "409 Conflict" beradi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `src/main.js` | Ishga tushirish, `--check`, `--dry-run` |
| `src/config.js` | `.env` sozlamalarini tekshiradi (qiymatlarni ekranga chiqarmaydi) |
| `src/bot.js` | grammY: buyruqlar, pastki menyu tugmalari, Mini App ma'lumoti, guruh xabarlari, kanalga va haydovchiga yuborish |
| `src/menu.js` | Pastki menyu (reply keyboard) va Mini App manzili |
| `src/wizard.js` | Chatdagi savol-javob (haydovchi va yuk beruvchi), Mini App bo'lmasa ishlatiladi (Telegram'siz test qilinadi) |
| `src/format.js` | Yuk va bo'sh mashina xabarining ko'rinishi |
| `src/pipeline.js` | Navbat → AI → takror → yuborish; limitlarda kutish |

**Texnologiya:** Node.js + grammY (+ auto-retry: Telegram "juda tez" desa, kutib qayta yuboradi). Testlar soxta Telegram bilan ishlaydi: `npm test`.
