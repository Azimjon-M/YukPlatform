// Sozlamalar ostida: foydalanuvchining O'Z telefon raqami (ixtiyoriy).
// Raqam bor — raqam, «🔄 Raqamni almashtirish» va «🗑 Raqamni o'chirish» (Azimjon, 2026-11-10: ikkalasi ham; botdagi
// /raqam da ham shu ikkalasi). O'chirilgach bo'lim yo'qolmaydi — «📱 Raqam ulashish» chiqadi, bosilsa raqam qayta ulashiladi.
// Ulashish / almashtirish: Telegram ichida → Telegram so'raydi → raqam botga kontakt bo'lib boradi → bot saqlaydi
// (apps/bot bot.js, faqat o'z kontakti). Ilova serverdan /pub/me ni bir necha marta so'rab, saqlanganini ko'radi
// (raqam yoki phoneAt o'zgarsa — o'sha raqamni qayta ulashsa ham).
// Saytda (Telegram'dan tashqarida) ulashish tugmasi yo'q — botdagi /raqam buyrug'i; o'chirish esa ishlaydi.
import { useState } from "react";
import { formatContactPhone } from "@yuk/shared";
import { deletePhone, getMe } from "./api.js";
import { canRequestContact, confirmAction, haptic, requestContact, showAlert } from "./telegram.js";
import { Section } from "./ui.jsx";

const WAIT_TRIES = 8; // bot kontaktni olib saqlaguncha: 8 marta, har 1 soniyada
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HINT =
  "Ixtiyoriy. Raqamingiz bilan sizni taniymiz: botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi. Hech kimga ko'rsatilmaydi.";
const DELETE_QUESTION = "Raqamingizni o'chirasizmi? Xohlasangiz, keyin shu yerda yana ulashasiz.";

// me — serverdagi foydalanuvchi; onChange(me, kind) — kind: "saved" (ulashildi) | "deleted" (o'chirildi)
export function PhoneCard({ me, onChange }) {
  const [busy, setBusy] = useState(null); // "share" | "delete" | null
  const [late, setLate] = useState(false); // ulashildi, lekin bot hali saqlamadi (masalan, bot o'chiq)

  async function share() {
    setBusy("share");
    setLate(false);
    try {
      if (!(await requestContact())) return; // «Bekor qilish» bosildi
      for (let i = 0; i < WAIT_TRIES; i++) {
        await sleep(1000);
        const fresh = await getMe();
        if (fresh.phone && (fresh.phone !== me.phone || fresh.phoneAt !== me.phoneAt)) {
          haptic.success();
          onChange(fresh, "saved");
          return;
        }
      }
      setLate(true);
    } catch (error) {
      showAlert(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!(await confirmAction(DELETE_QUESTION))) return;
    setBusy("delete");
    setLate(false);
    try {
      const fresh = await deletePhone();
      haptic.success();
      onChange(fresh, "deleted");
    } catch (error) {
      showAlert(error.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="📱 Telefon raqam" hint={HINT}>
      {me.phone ? (
        <>
          <p className="phone-line">
            <strong>{formatContactPhone(me.phone)}</strong>
          </p>
          <div className="account-actions">
            {canRequestContact && (
              <button type="button" className="secondary" disabled={Boolean(busy)} onClick={share}>
                {busy === "share" ? "Kutilyapti..." : "🔄 Raqamni almashtirish"}
              </button>
            )}
            <button type="button" className="danger" disabled={Boolean(busy)} onClick={remove}>
              {busy === "delete" ? "O'chirilyapti..." : "🗑 Raqamni o'chirish"}
            </button>
          </div>
          {!canRequestContact && <p className="hint">Almashtirish — botda /raqam buyrug'i bilan.</p>}
        </>
      ) : canRequestContact ? (
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={share}>
          {busy === "share" ? "Kutilyapti..." : "📱 Raqam ulashish"}
        </button>
      ) : (
        <p className="hint">Raqamni botda ulashasiz: /raqam buyrug'ini yuboring.</p>
      )}
      {late && <p className="hint">Raqam botga yuborildi. Bir ozdan keyin ilovani qayta oching — shu yerda chiqadi.</p>}
    </Section>
  );
}
