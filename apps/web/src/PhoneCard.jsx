// Sozlamalar ostida: foydalanuvchining O'Z telefon raqami (ixtiyoriy).
// Telegram ichida «📱 Raqam ulashish» → Telegram so'raydi → raqam botga kontakt bo'lib boradi → bot saqlaydi
// (apps/bot bot.js, faqat o'z kontakti). Ilova serverdan /pub/me ni bir necha marta so'rab, saqlanganini ko'radi.
// Saytda (Telegram'dan tashqarida) tugma yo'q — botdagi /raqam buyrug'i.
import { useState } from "react";
import { formatContactPhone } from "@yuk/shared";
import { getMe } from "./api.js";
import { canRequestContact, haptic, requestContact, showAlert } from "./telegram.js";
import { Section } from "./ui.jsx";

const WAIT_TRIES = 8; // bot kontaktni olib saqlaguncha: 8 marta, har 1 soniyada
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HINT =
  "Ixtiyoriy. Raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi. Hech kimga ko'rsatilmaydi.";

// me — serverdagi foydalanuvchi; onChange(me) — raqam saqlangach
export function PhoneCard({ me, onChange }) {
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState(false); // ulashildi, lekin bot hali saqlamadi (masalan, bot o'chiq)

  async function share() {
    setBusy(true);
    setLate(false);
    try {
      if (!(await requestContact())) return; // «Bekor qilish» bosildi
      for (let i = 0; i < WAIT_TRIES; i++) {
        await sleep(1000);
        const fresh = await getMe();
        if (fresh.phone && fresh.phone !== me.phone) {
          haptic.success();
          onChange(fresh);
          return;
        }
      }
      setLate(true);
    } catch (error) {
      showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="📱 Telefon raqam" hint={HINT}>
      {me.phone && (
        <p className="phone-line">
          <strong>{formatContactPhone(me.phone)}</strong> <span className="muted small">· o'chirish — botda /ochirish</span>
        </p>
      )}
      {canRequestContact ? (
        <button type="button" className="primary" disabled={busy} onClick={share}>
          {busy ? "Kutilyapti..." : me.phone ? "Raqamni almashtirish" : "📱 Raqam ulashish"}
        </button>
      ) : (
        !me.phone && <p className="hint">Raqamni botda ulashasiz: /raqam buyrug'ini yuboring.</p>
      )}
      {late && <p className="hint">Raqam botga yuborildi. Bir ozdan keyin ilovani qayta oching — shu yerda chiqadi.</p>}
    </Section>
  );
}
