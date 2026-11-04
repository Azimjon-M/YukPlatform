# bot — Telegram bot

**Bosqich:** 1 (MVP)

- `/start`, haydovchini ro'yxatdan o'tkazish
- Filtr sozlash: qayerdan, qayerga, mashina turi, tonnaj
- Mos yuk chiqsa, haydovchiga shaxsiy xabar yuboradi
- Hamkor guruhlarda admin sifatida e'lonlarni o'qiydi

## Muhim

- Inline tugmalarda `tel:` **ishlamaydi**, faqat `https://` va `tg://` havolalari ishlaydi.
  Telefon raqami matnda `+998901234567` ko'rinishida yozilsa, Telegram uni o'zi bosiladigan qiladi va bosganda qo'ng'iroq qilish taklif qilinadi.
- Kanaldagi postlarni o'qish uchun bot **admin** bo'lishi shart. Guruhda esa admin bo'lishi yoki BotFather'da privacy mode o'chirilgan bo'lishi kerak.

**Texnologiya:** Node.js + grammY
