# bot — Telegram bot (@Yuk_Ekspert_agent)

**Bosqich:** 1 (MVP) ⏳ kod tayyor va testlardan o'tgan, haqiqiy haydovchilar bilan sinov kutilyapti

- **Pastki menyu** — yozuv qatori ostida doim turadigan tugmalar (javob xabariga tugma yopishtirilmaydi):

  | Tugma | Nima qiladi |
  |---|---|
  | 📋 Mos yuklar | Oxirgi 24 soatdagi mos yuklar (eng yangi 5 tasi) |
  | 🚚 Ro'yxatdan o'tish / ⚙️ Sozlamalar | Mini App formasini ochadi (`MINIAPP_URL` bo'lsa). Bo'lmasa — chatda savol-javob |
  | ⏸ Pauza / ▶️ Davom ettirish | Yuk yuborishni to'xtatadi yoki yoqadi. Tugma yozuvi holatga qarab almashadi |
  | 📱 Ilovalar | Android/iPhone havolalari yoki APK fayl (bo'lmasa "tez orada") va kanal |
  | ❓ Yordam | Yordam |

- **Sozlamalar:** mashina turi, kuzov, sig'im, kuzov o'lchami, yuklash tomoni, qayerdan/qayerga (xalqaroda davlatlar ham), xalqaro, rejim. Mini App: [apps/web](../web/README.md)
- Navbatdagi e'lonlarni AI bilan tahlil qiladi, takrorni tashlaydi, yangi yukni **kanalga** joylaydi va **mos haydovchilarga** shaxsiy xabar qilib yuboradi. Shaxsiy xabarda tugma yo'q: telefon raqami bosiladi, "📄 Asl e'lon" — matn ichidagi havola.
- Admin bo'lgan guruhlardagi e'lonlarni ham navbatga qo'yadi (o'z kanalining nusxalaridan tashqari)

## Sozlash (bir marta)

1. @BotFather → `/newbot` → token. ✅ qilingan: `@Yuk_Ekspert_agent`
2. `.env` fayliga **o'zingiz** yozing:

   | O'zgaruvchi | Misol | Izoh |
   |---|---|---|
   | `BOT_TOKEN` | — | BotFather bergan token. Chatga yozmang |
   | `CHANNEL_ID` | `@Yuk_Ekspert` | Yuklar joylanadigan kanal |
   | `ADMIN_IDS` | `123456789` | `/holat` buyrug'ini ko'ra oladiganlar. O'z id'ingizni botga `/id` yozib bilasiz |
   | `MINIAPP_URL` | `https://yuk-ekspert.pages.dev` | Mini App manzili ([qanday joylash](../web/README.md)). Bo'sh bo'lsa — chatda savol-javob |
   | `ANDROID_URL`, `IOS_URL` | `https://play.google.com/...` | Ixtiyoriy: «📱 Ilovalar» tugmasidagi havolalar |
   | `APK_FILE` | `data/apk/yuk-ekspert.apk` | Ixtiyoriy: Android o'rnatish fayli (50 MB gacha), bot o'zi yuboradi |
   | `ROUTE_SCOPE` | `qoshni` | Qaysi yo'nalishlar: `qoshni` (standart) — O'zbekiston ichi va O'zbekiston ↔ Qozog'iston, Qirg'iziston, Tojikiston, Turkmaniston, Afg'oniston; `ichki` — faqat O'zbekiston ichi; `hammasi` — cheklovsiz. Haydovchi sozlamalarida (savol-javob, Mini App) ham faqat shu doiradagi davlatlar chiqadi |

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

## Haydovchi uchun buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `/start` | Salom, pastki menyu (yo'qolsa ham qaytaradi) va ro'yxatdan o'tish |
| `/sozlamalar` | Mashina va yo'nalishni o'zgartirish (eski javoblar belgilangan holda) |
| `/pauza`, `/davom` | Yuk yuborishni to'xtatish / yoqish |
| `/yordam` | Yordam |
| `/id` | Telegram id raqami (ADMIN_IDS uchun) |
| `/holat` | Faqat adminlar: haydovchilar, navbat, oxirgi 24 soatdagi yuklar |

## Qanday ishlaydi

```
collector (tg:live) ─┐                                    ┌─► kanal @Yuk_Ekspert (hamma yangi yuk)
                     ├─► navbat (data/yuk.db) ─► ishchi ──┤
guruh (bot admin)  ──┘    AI → takror? → baza             └─► mos haydovchilarga shaxsiy xabar
```

- **Takror:** bir xil matn 3 kun ichida qayta kelsa — AI'ga yuborilmaydi (bepul limit tejaladi). Boshqacha yozilgan o'sha yuk (o'sha telefon, yo'nalish, kuzov, og'irlik) — haydovchiga ikkinchi marta yuborilmaydi.
- **Gemini limiti:** daqiqalik limit tugasa, Google aytgan vaqtcha kutadi. Kunlik limit tugasa, 30 daqiqada bir tekshirib turadi. E'lonlar navbatda kutadi, yo'qolmaydi.
- **Haydovchi botni bloklasa,** unga boshqa yuborilmaydi.

## Muhim

- Inline tugmalarda `tel:` **ishlamaydi**, faqat `https://` va `tg://` havolalari ishlaydi.
  Telefon raqami matnda `+998901234567` ko'rinishida yoziladi: Telegram uni o'zi bosiladigan qiladi va bosganda qo'ng'iroq qilish taklif qilinadi.
- Kanalga joylash uchun bot kanalda **admin** bo'lishi shart. Guruhda hamma xabarni ko'rish uchun admin bo'lishi yoki BotFather'da privacy mode o'chirilgan bo'lishi kerak.
- Kanalga ulangan muhokama guruhiga kanal postlari avtomatik nusxalanadi. Bot ularni e'lon deb qayta olmaydi.
- Bot bir vaqtda faqat **bitta** nusxada ishlaydi: ikkinchi `npm run bot` ochilsa, Telegram "409 Conflict" beradi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `src/main.js` | Ishga tushirish, `--check`, `--dry-run` |
| `src/config.js` | `.env` sozlamalarini tekshiradi (qiymatlarni ekranga chiqarmaydi) |
| `src/bot.js` | grammY: buyruqlar, pastki menyu tugmalari, Mini App ma'lumoti, guruh xabarlari, kanalga va haydovchiga yuborish |
| `src/menu.js` | Pastki menyu (reply keyboard) va Mini App manzili |
| `src/wizard.js` | Chatdagi savol-javob, Mini App bo'lmasa ishlatiladi (Telegram'siz test qilinadi) |
| `src/format.js` | Yuk xabarining ko'rinishi |
| `src/pipeline.js` | Navbat → AI → takror → yuborish; limitlarda kutish |

**Texnologiya:** Node.js + grammY (+ auto-retry: Telegram "juda tez" desa, kutib qayta yuboradi). Testlar soxta Telegram bilan ishlaydi: `npm test`.
