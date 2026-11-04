# Namunaviy e'lonlar

E'lonlar shu papkadagi `elonlar.txt` fayliga yig'iladi.

**Avtomatik (tavsiya):** `npm run tg:export -- @guruh1 @guruh2 --limit 200`. Bu buyruq guruhlardan xabarlarni olib, qisqa va takror xabarlarni tashlab, faylga qo'shadi. Sozlash: [apps/collector/README.md](../../apps/collector/README.md).

**Qo'lda:** xabarlarni Telegram'dan nusxalab, faylga o'zingiz qo'ying.

**Format:** e'lonlar orasiga alohida qatorga `---` qo'yiladi.

```
Тошкент - Фаргона
20 тонна цемент, тент керак
+998 90 123 45 67
---
Samarqanddan Moskvaga ref kerak, 22t meva
---
```

## Maslahatlar

- 3–5 ta har xil guruhdan jami 100–200 ta e'lon yig'ing
- Har xil turdagi e'lonlar bo'lsin: kirill, lotin, ruscha; bitta e'londa bir nechta yuk; narxi yo'q; faqat telefon raqami bor va hokazo
- Bu papka gitga tushmaydi, chunki ichida haqiqiy telefon raqamlari bor

## Boshqa fayllar (hammasi gitga tushmaydi)

| Fayl | Ichida |
|---|---|
| `gold.jsonl` | Qo'lda tekshirilgan to'g'ri javoblar: 32 ta e'lon, 52 ta yuk. Har qatorda `index` (e'lon raqami), `textStart` (birinchi 20 harf — fayl o'zgarsa, adashmaslik uchun), `postType`, `loads` |
| `natija.jsonl` | `npm run parse` natijasi |
| `natija-v1.jsonl` … `natija-v4.jsonl` | Prompt'ning har xil versiyalari natijasi — `npm run parse:eval` bilan solishtiriladi |

`elonlar.txt` ga yangi e'lon qo'shsangiz, oxiriga qo'shing: `gold.jsonl` e'lonni tartib raqami bilan topadi.
