# Ilova uchun API (mobil / kompyuter)

Server: **`https://yuk.gtpro.uz/pub`**. Bu Mini App va sayt ishlatadigan API, ilova ham xuddi shuni ishlatadi.
Barcha yo'llar va qoidalar `apps/api/src/public.js` faylining boshidagi izohda yozilgan.

- JSON yuboriladi va qaytadi.
- CORS ochiq (`*`), shuning uchun localhost'dagi Expo web ham ishlaydi.
- Xato bo'lsa javob `{ error, code? }` ko'rinishida keladi:
  - `401 code:"auth"`: qayta kirish kerak;
  - `403 code:"blocked"`: foydalanuvchi bloklangan;
  - `429`: juda ko'p so'rov (bitta IP dan daqiqasiga 240 tadan ko'p).

## Kirish: «Telegram orqali kirish»

Ilovada Telegram imzosi yo'q, shuning uchun kirishni bot tasdiqlaydi.

1. `POST /pub/auth/app` yuboriladi. Javob:
   `{ code, url, tgUrl, expiresIn: 600, pollMs: 2000 }`
2. Ilova `url`ni ochadi (`Linking.openURL(url)`), masalan `https://t.me/Yuk_Ekspert_agent?start=app_<code>`. Telegram ilovasi ochiladi.
3. Botda foydalanuvchi **Start** tugmasini, keyin **«✅ Ha, kiraman»** tugmasini bosadi.
4. Bu vaqtda ilova har `pollMs` millisekundda `GET /pub/auth/app/<code>` so'raydi:
   - `202 { status: "pending" }`: hali tasdiqlanmagan, so'rashda davom etiladi;
   - `200 { token, me }`: kirish tayyor. Token **faqat bir marta** beriladi;
   - `410`: kod eskirgan (10 daqiqa o'tgan) yoki allaqachon ishlatilgan. Ilova «Qaytadan urinish» tugmasini ko'rsatadi.
5. `token`ni xavfsiz joyda saqlang (`expo-secure-store`). Keyingi har bir so'rovda shu sarlavha yuboriladi:
   `Authorization: Bearer <token>`.

Token 30 kun amal qiladi. Muddati o'tsa server `401` qaytaradi, shunda yuqoridagi kirish qaytadan bajariladi.
`code` maxfiy, uni logga yozmang.

## Asosiy yo'llar (kirgandan keyin)

| Yo'l | Nima uchun |
|---|---|
| `GET /pub/config` | bot nomi, yo'nalish doirasi (kirishsiz) |
| `GET /pub/me` | foydalanuvchi: `chatId, name, role, plan, isAdmin, profile, active, phone` |
| `PUT /pub/me/role` `{ role }` | `haydovchi` yoki `yuk_beruvchi` |
| `PUT /pub/me/profile` `{ profile }` | sozlamalar (Mini App'dagi forma bilan bir xil) |
| `PATCH /pub/me` `{ active }` | pauza / davom |
| `GET /pub/loads?view=all&hours=24&limit=50&offset=0` | yuklar (haydovchi uchun), eng yangisi birinchi |
| `GET /pub/trucks?…` | bo'sh mashinalar (yuk beruvchi uchun) |
| `GET /pub/me/feed-sources` | guruh va kanallar ro'yxati |
| `GET /pub/me/load-form`, `POST /pub/loads` `{ load }` | yuk berish (yuk beruvchi) |
| `POST /pub/me/logout` | hisobdan chiqish |

Javoblarning to'liq ko'rinishi `apps/api/test/public.test.js` faylida misollar bilan berilgan. Mini App
(`apps/web/src/api.js` va sahifalar) shu API'ni qanday chaqirishini ko'rib chiqing, ilovada ham xuddi shunday qiling.

Telefon raqami: ilovada `tel:+998…` havolasini to'g'ridan-to'g'ri ochsa bo'ladi.
