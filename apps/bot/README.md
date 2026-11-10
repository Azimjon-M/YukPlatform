# bot — Telegram bot (@Yuk_Ekspert_agent)

**Bosqich:** 1 (MVP) ⏳ kod tayyor va testlardan o'tgan, haqiqiy haydovchilar bilan sinov kutilyapti

- **Rollar (2026-11-06):** `/start` da bot «Iltimos, rolingizni tanlang» deb so'raydi (2026-11-10 gacha «Siz kimsiz?» edi). **Rol tanlanmaguncha pastki menyu yo'q** (`menu()` → `remove_keyboard`), yozish qatoridagi Telegram «Menu» tugmasi (buyruqlar) ham yo'q — buyruqlar hamma uchun emas, rol tanlagan odamning chatiga alohida qo'yiladi (`src/commands.js`, `drivers.commands_on`, har daqiqada tekshiriladi). Rol tanlanmagan odam nima bossa yoki yozsa ham — /start ekrani:

  | Rol | Nima oladi | Sozlamalar |
  |---|---|---|
  | 🚚 Haydovchi | «yuk bor» e'lonlari — mashinasi va yo'nalishiga mos | mashina, kuzov, sig'im, o'lcham, tomon, yo'nalish |
  | 📦 Yuk beruvchi (yuk egasi, dispetcher) | «mashina bo'sh» e'lonlari — yo'nalishi va kerakli mashinaga mos | qayerdan, qayerga, mashina turlari, kuzovlar |

  «Mashina bo'sh» e'lonlarini AI baribir ajratardi (ilgari tashlab yuborilardi) — yuk beruvchilar **AI limitiga qo'shimcha so'rov qo'shmaydi**.
  Rolni almashtirish — pastki menyudagi «🔄 Rolni almashtirish» yoki `/rol`. Har rolning sozlamalari alohida saqlanadi (`store.switchRole`): yuk beruvchi bo'lib, keyin haydovchiga qaytsa, mashinasi va yo'nalishi tiklanadi («Oldingi sozlamalaringiz tiklandi»), qaytadan so'ralmaydi. Admin — rol emas: `ADMIN_IDS` yoki boshqaruv markazidagi belgi; adminning menyusida «🛠 Boshqaruv» (Mini App ichida).
  Pullik obuna hali yo'q: bazada `plan` ustuni (hammasi `free`) va `planAllows()` (`packages/shared/src/roles.js`) — keyin shu yerda cheklanadi.

- **Pastki menyu** — yozuv qatori ostidagi tugmalar (javob xabariga tugma yopishtirilmaydi). Yig'iladi: yozish qatorining o'ng tomonidagi Telegram belgisi menyuni ochib-yopadi (`is_persistent` yo'q, 2026-11-07). Bot har javobi va har yuk xabari bilan menyuni yuboradi — yopilgan menyu yangi xabar kelganda yana ochiladi (bot chat ochilganini bilmaydi). Tartib (2026-11-10): «📋 Mos yuklar» | «⏸ Pauza», «🔄 Rolni almashtirish» | «📱 Raqam ulashish», «❓ Yordam» | «⚙️ Sozlamalar», adminga pastda «🛠 Boshqaruv». Rol tanlangan, lekin forma hali to'ldirilmagan bo'lsa — faqat «🚚 Ro'yxatdan o'tish», «🔄 Rolni almashtirish» | «❓ Yordam»:

  | Tugma | Nima qiladi |
  |---|---|
  | 📋 Mos yuklar / 🚚 Bo'sh mashinalar | Haydovchi: avval «📍 Qayerdan?» → «🏁 Qayerga?» (tugmalar: «Qayerdan?» da «Farg'ona vil. →», «Qayerga?» da «→ Toshkent vil.» — strelka yuk qayoqqa ketishini ko'rsatadi, yuklar soni yozilmaydi; hozirgi tanlov ✅; «Qayerdan?» da «🌐 Hamma joydan» YO'Q (2026-11-10), «Qayerga?» da «🌐 Istalgan joyga», «⬅️ Orqaga»; ikkala qadamda «🗺 Xaritadan tanlash» — web xaritasi (Mini App), u yerda saqlansa bot shu xabarni «✅ Yo'nalish» ga almashtirib, mos yuklarni yuboradi: server `bot_notices` ga yozadi, bot `src/notices.js` har 2 soniyada oladi), keyin shu yo'nalishdagi mos yuklar (eng yangi 5 tasi). Tanlangan yo'nalish saqlanadi — yangi yuklar ham shu bo'yicha keladi. Yuk beruvchi: darhol oxirgi 24 soatdagi mos bo'sh mashinalar |
  | 🚚 Ro'yxatdan o'tish / ⚙️ Sozlamalar | Mini App formasini ochadi (`MINIAPP_URL` bo'lsa). Bo'lmasa — chatda savol-javob |
  | ⏸ Pauza / ▶️ Davom ettirish | Yuk yuborishni to'xtatadi yoki yoqadi. Tugma yozuvi holatga qarab almashadi |
  | 📱 Raqam ulashish | Doim `request_contact`: bir bosishda raqamni ulashadi (raqami bor odamda — yangilaydi). Ko'rish/almashtirish — `/raqam`. Bot o'zi bir marta so'raydi — forma saqlangach («Saqlandi» → raqam → keyin yo'nalish) |
  | `/ilovalar` | Android/iPhone havolalari yoki APK fayl (bo'lmasa "tez orada"); kanal — faqat `CHANNEL_LOADS=1` bo'lsa. 2026-11-07 gacha menyuda «📱 Ilovalar» tugmasi edi — eski menyuda bosilsa ham ishlaydi |
  | 🔄 Rolni almashtirish | `/rol` bilan bir xil: hozirgi rol va «Haydovchiman» / «Yuk beruvchiman» tugmalari. Faqat rol tanlangach ko'rinadi |
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
   | `ANDROID_URL`, `IOS_URL` | `https://play.google.com/...` | Ixtiyoriy: `/ilovalar` dagi havolalar |
   | `APK_FILE` | `data/apk/yuk-ekspert.apk` | Ixtiyoriy: Android o'rnatish fayli (50 MB gacha), bot o'zi yuboradi |
   | `ROUTE_SCOPE` | `qoshni` | Qaysi yo'nalishlar: `qoshni` (standart) — O'zbekiston ichi va O'zbekiston ↔ Qozog'iston, Qirg'iziston, Tojikiston, Turkmaniston, Afg'oniston; `ichki` — faqat O'zbekiston ichi; `hammasi` — cheklovsiz. Haydovchi sozlamalarida (savol-javob, Mini App) ham faqat shu doiradagi davlatlar chiqadi |
   | `POST_MAX_AGE_HOURS` | `3` | Joylanganiga shuncha soatdan oshgan e'lon AI'ga bormaydi: boshqaruv markazida «Tayyor», izohi «Eskirgan». Bot o'chib turganda to'plangan kechagi e'lonlar kanalga "yangi yuk" bo'lib chiqmaydi va bepul AI limitini yemaydi. `0` — cheklovsiz. `--dry-run` bu cheklovni ishlatmaydi |
   | `REQUIRE_CONTACT` | yoqiq | Aloqasiz e'lon — matnda telefon raqami ham, yozgan odamning username'i («💬 Lichkasi») ham yo'q — qoidaviy parserga ham, AI'ga ham bormaydi va hech kimga yuborilmaydi: navbatga tushishi bilan «Tayyor», izohi «Aloqasiz: …» (boshqaruv markazida «📵 Aloqasiz» belgisi). 2026-11-10 o'lchovi: AI'ga borgan e'lonlarning 51% shunday edi (GLogistics / Targo.uz e'lonlari — aloqa ularning saytida). `0` — o'chiq |

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
| `/start` | «Assalomu alaykum!» + bot haqida, pastki menyu (yo'qolsa ham qaytaradi); rol tanlanmagan bo'lsa — menyusiz, ostida «Iltimos, rolingizni tanlang» va ikki tugma |
| `/sozlamalar` | Sozlamalarni o'zgartirish (eski javoblar belgilangan holda) |
| `/rol` | Haydovchi ↔ yuk beruvchi |
| `/pauza`, `/davom` | Yuborishni to'xtatish / yoqish |
| `/raqam` | Telefon raqamni ulashish yoki almashtirish (ixtiyoriy). Bot o'zi faqat bir marta so'raydi — birinchi saqlashdan keyin (yoki eski foydalanuvchida `/start` da); «⏭ Keyinroq» bosilsa, boshqa so'ramaydi. Faqat o'z kontakti saqlanadi |
| `/ochirish` | Nima saqlanishini ko'rsatadi: «Faqat raqamni o'chirish» yoki «Hammasini o'chirish» (yozuv butunlay o'chadi, hech narsa yuborilmaydi) |
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
- **O'z guruhini qo'shish (2026-11-10):** raqamini ulashgan foydalanuvchining menyusida «📱 Raqam ulashish» o'rnida «➕ Guruh qo'shish» (yoki `/guruh_qoshish` — «Menu» buyruqlar ro'yxatida ham). Raqami yo'q odam bossa yoki havola yuborsa — raqam so'raladi va bu niyat eslab qolinadi (xotirada, 30 daqiqa): raqamni ulashgach yo'nalish savoli emas, guruh qo'shish xabari chiqadi, havola yuborgan bo'lsa — o'sha darhol tekshiriladi; orada boshqa ish qilsa — unutiladi. U ochiq guruh/kanal havolasini yuboradi (`t.me/nom`, `https://t.me/s/nom/123`, `@nom`; yopiq taklif havolasi, bot, odam — rad). Bot Bot API `getChat` bilan tekshiradi (a'zo bo'lmasdan ishlaydi) → manba «tekshiruv» holatida, o'chiq. Collector oxirgi 50 ta xabarini ko'radi (AI'siz, `@yuk/parser` `looksLikeLoad`; faqat telefoni yoki lichkasi borlari sanaladi): 3 tadan kam yuk e'loni yoki 7 kundan beri jim — rad; aks holda 24 soatlik sinov boshlanadi (oxirgi 3 soatdagi e'lonlari darhol navbatga). Sinovda kamida 5 ta yuk e'loni (AI yoki qoidaviy parser yuk deb topgan, boshqa guruhdagining aynan nusxasi va aloqasizi sanalmaydi — aloqasizlar soni izohda aytiladi) chiqsa — doimiy; 40 ta xabaridan 10% dan kami yuk bo'lsa — muddatidan oldin to'xtatiladi; 24 soatda 5 ta bo'lmasa — o'chiriladi. Har natijani bot qo'shgan odamga yozadi (`src/userSources.js` `createSourceWatcher`). Limitlar: bir odamda bir vaqtda 3 ta tekshiruv, 24 soatda 5 ta, hammaga 24 soatda 30 ta; rad etilgani 7 kundan keyin qayta yuboriladi. Havola bizda bor manbaga teng bo'lsa (katta-kichik harf, `t.me`/`@` farqi yo'q) — limitlardan oldin «ℹ️ Bu kanal/guruh bizda avvaldan mavjud: …» + holati (o'zi yuborgan bo'lsa — «siz allaqachon yuborgansiz»). Tugma matni hamma joyda bitta: `ADD_GROUP_TEXT` «➕ Guruh qo'shish — siz yuk guruhi yoki kanali qo'sha olasiz va ulardagi mos e'lonlar ham shu yerga keladi.»

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
| `src/wizard.js` | Chatdagi savol-javob (haydovchi: transport → kuzov → sig'im → o'lcham → yuklash tomoni → qayerda ishlaydi; yuk beruvchi: yo'nalish → transport → kuzov), Mini App bo'lmasa ishlatiladi (Telegram'siz test qilinadi) |
| `src/userSources.js` | «➕ Guruh qo'shish»: havolani tushunish (`parseSourceLink`), tekshirish va limitlar (`createSourceIntake`), sinov qoidasi (`reviewTrial`) va natijani qo'shgan odamga yozish (`createSourceWatcher`) |
| `src/route.js` | «📋 Mos yuklar» dagi yo'nalish tanlash: tugmalar (`mr:f:<joy>`, `mr:t:<qayerdan>:<qayerga>`, `mr:last`, `mr:back`), joylar «Qayerda ishlaysiz?» ga qarab (faqat O'zbekiston — viloyatlar; qo'shnilar bilan — davlatlar ham). Joylar va sonlar `@yuk/shared` `route.js` da — web'dagi «📋 Yuklar» ham shundan |
| `src/format.js` | Yuk va bo'sh mashina xabarining ko'rinishi |
| `src/pipeline.js` | Navbat → AI → takror → yuborish; limitlarda kutish. Yo'nalishni hali tanlamagan haydovchiga yuk yuborilmaydi (`routeChosen`) |

**Texnologiya:** Node.js + grammY (+ auto-retry: Telegram "juda tez" desa, kutib qayta yuboradi). Testlar soxta Telegram bilan ishlaydi: `npm test`.
