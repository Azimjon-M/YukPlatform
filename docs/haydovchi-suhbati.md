# Haydovchi bilan suhbat — faktlar va qarorlar

**Manba:** Azimjonning yuk tashiydigan do'sti bilan suhbat, 2026-11-04.
Bu fayl parser, mashina profili va moslash (matching) qoidalarining asosi. Kod shu yerdagi faktlarga tayanadi.

## 1. Mashinalar

### O'lchami (sinfi) bo'yicha — `TRUCK_CLASSES` (`packages/shared/src/vehicles.js`)

| Sinf | Yuk ko'tarishi | Izoh |
|---|---|---|
| Fura | yakka most 24 t, qo'sh most 25–26 t; eng ko'pi 40 t | 92 m³, uzunligi 14 m, eni 2.5 m, balandligi 3 m. 8 tonnadan kam yuk uchun fura chaqirilmaydi |
| Mini fura | 9–15 t | Shacman ("chakman") 15 t |
| Isuzu | 5–9 t | Isuzu 5 t kuzovi: 4.85 × 2.15 × 1.95 m |
| Kichik | ~2.5 t | Kia (Bongo), Porter, Gazel |
| Labo | ~0.7 t | Chevrolet Labo 700 kg, Damas |

- Isuzu haydovchisi **faqat o'ziga mos** yuklarni ko'rishni xohlaydi. "Hammasini ko'rish" rejimini tanlagan foydalanuvchiga hammasi ko'rsatiladi.
- Isuzu uchun **yuklash tomoni** (ustidan, orqadan, yonidan) muhim.

### Kuzov turi bo'yicha — `BODY_TYPES`

| Kuzov | Ma'nosi |
|---|---|
| Tent | Hamma tomoni qalin brezentga o'xshash mato bilan yopilgan |
| Ref / izoterm | Xolodilnikli. E'lonlarda odatda "ref kerak" deb yoziladi: hamma tomoni temir bilan yopilgan, havo o'tkazmaydi |
| Ploshatka | Kontenerovoz = shalanda = ploshatka: bortsiz tekis platforma, konteyner ham shunga yuklanadi |
| Tral (triler) | Pritsepi uzunroq, og'ir va negabarit yuklar uchun (40 t va undan og'ir) |
| Samosval (tonar) | Kuzovini domkrat bilan ko'tarib, yukni to'kadi |
| Sementavoz | Faqat sement tashiydigan dumaloq bochka-pritsep |
| Manipulyator | Og'ir yukni o'z krani bilan ko'tarib, o'zi yuklaydi |
| Tyagach | Fura boshi, pritsepsiz (pritsepni tortib ketish uchun) |

- **Polupritsep**: "fura" so'zidan keyin kelsa, furaning pritsepi degani.
- **Ro'yxatdan o'tishda** haydovchidan so'raladi: mashina rusumi; kuzovning eni, bo'yi, uzunligi (shundan kub hisoblanadi); necha kg ko'tarishi; yuklash eshiklari (ust / orqa / o'ng / chap).
- **O'ng va chap mashinaga orqasidan qaraganda belgilanadi**, aks holda chalkashib ketadi. Shu qoidani ilovada yozib qo'yish kerak.
- Jonli (live) lokatsiya kerak emas.

## 2. Og'irlik va hajm

- **"20 22 ton"** "20 yoki 22 tonna" degani. **Katta raqam olinadi** (22): ko'p yozilsa yozilsin, kam yozilmasin, keyin kelishmovchilik bo'lmaydi.
- **Palet (paddon):** haydovchi buni "polda qancha joy egallaydi" deb tushunadi. Standart furaga **33 tagacha** yevropalet sig'adi. Do'stingiz paletni 1.20 × 1.20 m dedi. Standart yevropalet 1.20 × 0.80 m, 33 ta ham shu o'lchamdan kelib chiqadi.
- **Pochka:** g'isht, penoblok, profnastil kabi qadoqlangan qurilish mollari. Haydovchi ularni qanday mahkamlashni o'ylaydi.
- **Kub (m³):** yukning umumiy hajmi. Haydovchi uni mashinasining kubiga (86, 92, 120 kub) solishtiradi. Taxta, penoplast kabi yengil, lekin katta joy egallaydigan yuklar kub bilan o'lchanadi.
- **"Furaga qo'shimcha yuk" / dogruz:** do'stingiz javob bermadi. Ma'nosi: mashina yarim yuklangan, bo'sh joyini to'ldirish uchun qo'shimcha yuk. Parserda `partial: true` qilib belgilanadi.

## 3. Narx

- Narx har xil hisoblanadi: sabzavot **kilosiga**, katta hajmli (karobka) narsalar **kubiga**, o'tin kabi narsalar **reysiga**. Ko'pincha hammasi yo'nalishga qarab **reysiga** hisoblanadi.
- **3800, 3.800, 3.800.000, "3 mln 800 ming"** — hammasi 3 800 000 so'm.
- **Fiyat / fiat** turkchada "narx" degani. Notanish so'z uchrasa, qo'shni tillardan qidirish kerak: rus, qirg'iz, qozoq, turkman, tojik, turk.
- **"5200 + 300 gpis":** 5200 — narx. "+300 gpis" nimaligi aniq emas (do'stingizning taxmini: gips/alebastr turi). Narxga qo'shilmaydi, izohga yoziladi.
- **To'lov turi muhim:** zavod yuki odatda perechisleniye (o'tkazma), shaxsiy yuk naqd. "Dogovornoy" yoki "kelishiladi" bo'lsa, narx yozilmagan bo'ladi yoki yozilgan narx o'zgarishi mumkin.
- **Narxsiz e'lonlar ham kerak.** Ko'pincha yuk beruvchi narxni bilmaydi va uni tashuvchi belgilashini xohlaydi.
- Narx bo'yicha filtr hozircha kerak emas. Keyinchalik narx bo'yicha saralash uchun tayyor turishi kerak.

## 4. Joylar

- O'zbekistondagi barcha viloyatlarning shaharlari ro'yxati kerak, unga Osiyo mamlakatlari ham qo'shiladi.
- **"Toshkent"** ham shaharni, ham viloyatni bildiradi. **"Toshkent Sergeli"** esa Toshkent shahar, Sergeli tumani degani.
- **Faqat viloyat yozilgan bo'lsa** (masalan, "Surxondaryodan"), shu viloyatdagi haydovchilarga bildirishnoma yuboriladi.
- **Yo'lakay yuk:** katta mashinalar yuk yo'lida bo'lsagina oladi, chunki ba'zi joylarga kirib-chiqa olmaydi. Masofa (km) emas, **yuklash joyining lokatsiyasi** muhim: haydovchi xaritada qanchalik uzoqligini ko'rishi kerak.
- **Qaytish yuki (obratka)** bor va juda kerak. Haydovchi oldindan boshqa ish kelishib qo'ymagan bo'lsa, deyarli doim qaytish yukini oladi.
- **Xalqaro yuklar** alohida rejimda bo'lsin. Hujjatlar uchun joy qoldirsa bo'ladi, lekin muhim hujjatlar platforma orqali rasmiylashtirilmaydi.

## 5. Vaqt

- Yuk qancha tez olib ketilishini biz boshqara olmaymiz, buni faqat yuk beruvchi biladi. Lekin **yuklash vaqtini ko'rsatish foydali**.
- "Pogruzka 10.11": soati odatda yozilmaydi. Sana tartibi (kun.oy yoki oy.kun) aniqlanmadi, shuning uchun **sana e'londa qanday yozilgan bo'lsa, shunday saqlanadi**.
- Platforma **24 soat** ishlashi kerak.

## 6. Biznes qoidalari

- **Boshida** e'lonlar ochiq kanal va guruhlardan olinadi: kerakli yuk kerakli haydovchiga yo'naltiriladi. Platforma mashhur bo'lgach, ish beruvchilar ham o'tadi. Shuning uchun **ish beruvchi (yuk beruvchi) roli** kerak.
- Haydovchilar dispetcherni yoqtirmaydi, ish beruvchi bilan **to'g'ridan-to'g'ri** bog'lanishni xohlaydi. Platforma ham shunday ishlaydi, vositachilik foizi olinmaydi. Daromad keyinchalik oylik to'lov va reklamadan.
- Bitta yuk istalgan guruhga, istalgancha marta tashlanadi. Biz uni **bir marta** mos haydovchilarga yuboramiz. Takror yubormaymiz, chunki yuk yopilganmi yoki yo'qmi, bilmaymiz.
- Yuk yopilganini bilib bo'lmaydi. Eski e'lonlar yangilari bilan pastga suriladi. **E'lon joylangan vaqti ko'rinib turishi** kerak, shunda haydovchi o'zi tushunadi yoki yuk beruvchiga qo'ng'iroq qilib tekshiradi.
- Shuningdek: bizning kanalimizga ham tashlab borish mumkin. Ilova va saytda saralash hamda "hammasi" rejimi bo'ladi.

## Ochiq savollar

- **Dogruz** (2.9) — haydovchidan tasdiqlash kerak.
- **"+300 gpis"** nima ekanligi.
- **Sana tartibi**: "10.11" — 10-noyabrmi yoki 11-oktyabrmi? Odatda kun.oy yoziladi.
- **Takror muddati**: bir xil yuk (o'sha telefon, o'sha yo'nalish) necha kundan keyin yangi yuk hisoblanadi? Hozir 3 kun deb olindi (`packages/shared/src/dedupe.js`). Har kuni bir xil yo'nalishda yuk beradigan zavodlar bor-yo'qligini so'rash kerak.
- **Yuklash tomoni**: e'londa "orqadan yoki yonidan" kabi bir nechta tomon yozilsa, birortasi yetadi deb olindi. "Ustidan va orqadan" (ikkalasi ham shart) degan e'lonlar uchraydimi?
- **Kuzov almashinuvi**: "tent kerak" yukini ref (izoterm) mashina olib keta oladimi? Hozir kuzov aniq mos kelishi kerak.
- **Yo'lakay**: yuklash joyi xaritada ko'rsatiladi (lokatsiya). Buning uchun manzilni koordinataga aylantirish kerak — keyingi bosqich.
