# store — Baza

Node'ning o'zidagi SQLite (`node:sqlite`): o'rnatish ham, server ham, pul ham kerak emas. Fayl: `data/yuk.db` (gitga tushmaydi, ichida haydovchilar va telefon raqamlari bor).

Collector va bot — alohida dasturlar, ikkalasi shu faylni ochadi. Collector e'lonni navbatga yozadi, bot olib tahlil qiladi.

| Jadval | Ichida |
|---|---|
| `posts` | E'lonlar navbati: manba guruh, xabar raqami, havola, matn, joylangan vaqti, holati (`new` / `done` / `duplicate` / `failed`) |
| `loads` | Tahlil qilingan yangi yuklar: takror kaliti, JSON, nechta haydovchiga ketgani, kanal xabari raqami |
| `drivers` | Haydovchilar: profil (`@yuk/shared` match.js formatida), ro'yxatdan o'tish qoralamasi, faol yoki pauza |
| `cursors` | Collector har bir guruhni qaysi xabargacha o'qigani |

- Boshqa fayl bilan sinash: `YUK_DB=data/sinov.db`.
- Keyin `apps/api` paydo bo'lganda PostgreSQL'ga o'tiladi: shu paketdagi funksiyalar (`addPost`, `takeNewPosts`, `saveDriver`...) o'sha yerga ko'chadi, bot va collector kodi deyarli o'zgarmaydi.
- Node 24 SQLite'ni hali "experimental" deb yozadi. Ishlashiga ta'sir qilmaydi, ogohlantirish `--disable-warning=ExperimentalWarning` bilan o'chirilgan.
