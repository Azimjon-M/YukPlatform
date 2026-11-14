// Sozlamalar ostida: foydalanuvchining O'Z telefon raqami (ixtiyoriy).
// Raqam bor — raqam, «🔄 Raqamni almashtirish» va «🗑 Raqamni o'chirish» (Azimjon, 2026-11-10: ikkalasi ham; botdagi
// /raqam da ham shu ikkalasi). O'chirilgach bo'lim yo'qolmaydi — «📱 Raqam ulashish» chiqadi, bosilsa raqam qayta ulashiladi.
// Ulashish / almashtirish: Telegram ichida → Telegram so'raydi → raqam botga kontakt bo'lib boradi → bot saqlaydi
// (apps/bot bot.js, faqat o'z kontakti). Ilova serverdan /pub/me ni bir necha marta so'rab, saqlanganini ko'radi
// (raqam yoki phoneAt o'zgarsa — o'sha raqamni qayta ulashsa ham).
// Saytda (Telegram'dan tashqarida) ulashish tugmasi yo'q — botdagi /raqam buyrug'i; o'chirish esa ishlaydi.
// «📱 Raqam ulashish» bosilganda avval O'ZIMIZNING oyna (PhoneIntro) — afzalliklar; Telegram'ning «Telefon raqamingizni
// ulashmoqchimisiz?» oynasi (matnini o'zgartirib bo'lmaydi) faqat undagi tugmadan keyin (Azimjon, 2026-11-13).
// Almashtirishda oyna yo'q — odam nima uchunligini allaqachon biladi.
import { useEffect, useRef, useState } from "react";
import { formatContactPhone } from "@yuk/shared";
import { deletePhone, getMe } from "./api.js";
import { canRequestContact, confirmAction, haptic, requestContact, showAlert } from "./telegram.js";
import { Section } from "./ui.jsx";

const WAIT_TRIES = 8; // bot kontaktni olib saqlaguncha: 8 marta, har 1 soniyada
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HINT =
  "Ixtiyoriy. Raqamingiz bilan sizni taniymiz — botni o'chirib qayta yoqsangiz yoki ilovaga kirsangiz ham, ma'lumotlaringiz saqlanib qoladi.";
// Bot (apps/bot bot.js PHONE_WHY) bilan bir xil ma'no
const BENEFITS = [
  "Botni o'chirib qayta yoqsangiz ham ma'lumotlaringiz saqlanib qoladi",
  "Ilovaga kirsangiz — sizni darhol taniymiz, joyidan davom etaverasiz",
  "Qaytadan ro'yxatdan o'tish shart emas",
  "«➕ Guruh qo'shish» ochiladi — o'zingiz yuk guruhi yoki kanali qo'shasiz, undagi mos e'lonlar ham keladi",
];

// Pastdan chiqadigan oyna (<dialog> showModal: Esc va fonni bosish — yopadi)
function PhoneIntro({ open, onShare, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="phone-intro"
      aria-labelledby="phone-intro-title"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
    >
      <div className="phone-intro-body">
        <div className="phone-intro-icon" aria-hidden="true">📱</div>
        <h2 id="phone-intro-title">Raqamingizni ulashasizmi?</h2>
        <p className="phone-intro-lead">Raqamingizni ulashsangiz:</p>
        <ul className="phone-intro-list">
          {BENEFITS.map((text) => (
            <li key={text}>
              <span aria-hidden="true">✅</span>
              {text}
            </li>
          ))}
        </ul>
        <p className="phone-intro-note">🔒 Raqamingiz boshqa foydalanuvchilarga ko'rsatilmaydi. Xohlasangiz, shu yerda istalgan payt o'chirasiz.</p>
        <button type="button" className="primary phone-intro-go" onClick={onShare}>
          📱 Raqam ulashish
        </button>
        <button type="button" className="phone-intro-later" onClick={onClose}>
          Keyinroq
        </button>
        <p className="phone-intro-foot">Keyingi oynada Telegram bir marta tasdiqlashni so'raydi. Ulashish ixtiyoriy.</p>
      </div>
    </dialog>
  );
}
const DELETE_QUESTION = "Raqamingizni o'chirasizmi? Xohlasangiz, keyin shu yerda yana ulashasiz.";

// me — serverdagi foydalanuvchi; onChange(me, kind) — kind: "saved" (ulashildi) | "deleted" (o'chirildi)
export function PhoneCard({ me, onChange }) {
  const [busy, setBusy] = useState(null); // "share" | "delete" | null
  const [late, setLate] = useState(false); // ulashildi, lekin bot hali saqlamadi (masalan, bot o'chiq)
  const [intro, setIntro] = useState(false); // afzalliklar oynasi ochiqmi

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
        <>
          <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => setIntro(true)}>
            {busy === "share" ? "Kutilyapti..." : "📱 Raqam ulashish"}
          </button>
          <PhoneIntro
            open={intro}
            onClose={() => setIntro(false)}
            onShare={() => {
              setIntro(false);
              share();
            }}
          />
        </>
      ) : (
        <p className="hint">Raqamni botda ulashasiz: /raqam buyrug'ini yuboring.</p>
      )}
      {late && <p className="hint">Raqam botga yuborildi. Bir ozdan keyin ilovani qayta oching — shu yerda chiqadi.</p>}
    </Section>
  );
}
