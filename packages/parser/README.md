# parser — AI parser

**Bosqich:** 0 ⏳ hozir shu ustida ishlanyapti

**Kirish:** e'lon matni (kirill va lotin aralash, ruscha, qisqartmalar bilan)

**Chiqish:** yuklar massivi, chunki bitta e'londa bir nechta yuk bo'lishi mumkin:

```json
[
  {
    "category": "fura",
    "from": "Toshkent",
    "to": "Farg'ona",
    "cargo": "sement",
    "weightT": 20,
    "vehicle": "tent",
    "price": 3500000,
    "phones": ["+998901234567"],
    "date": null
  }
]
```

## Reja

1. `data/samples/elonlar.txt` faylidan e'lonlarni o'qish
2. Telefon raqamlarini oddiy regex bilan ajratish, buning uchun AI kerak emas
3. Qolgan qismini Claude API bilan JSON'ga aylantirish
4. Qo'lda tekshirilgan 30–50 ta e'lon bilan aniqlikni o'lchash
