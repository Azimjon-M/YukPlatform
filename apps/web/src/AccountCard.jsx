// Sozlamalar ostida «👤 Hisob»: chiqish va hisobni o'chirish (ikkalasida ham oldin «Ha / Yo'q» so'raladi).
// Chiqish — serverda (POST /pub/me/logout): rol va sozlamalar yashiriladi, bot yuk yubormaydi va menyusi olib tashlanadi,
// qayta kirganda «Siz kimsiz?» / «Ro'yxatdan o'tish» dan boshlanadi; rolni tanlasa — sozlamalari tiklanadi.
// (Avval faqat token o'chardi — Telegram'da bot baribir tanirdi va hech narsa o'zgarmasdi, Azimjon 2026-11-07: «chiqmadi».)
// O'chirish — serverda hamma ma'lumot (DELETE /pub/me, botdagi /ochirish bilan bir xil).
import { useState } from "react";
import { deleteMe, signOut } from "./api.js";
import { confirmAction, haptic, showAlert } from "./telegram.js";
import { PLAN_ABOUT } from "./feedGroups.js";
import { Section } from "./ui.jsx";

const LOGOUT_QUESTION =
  "Hisobdan chiqasizmi? Bot sizga yuk yubormaydi. Ma'lumotlaringiz saqlanadi: qayta kirib rolingizni tanlasangiz, sozlamalaringiz tiklanadi.";
const DELETE_QUESTION =
  "Hisobingiz o'chirilsinmi? Bot sizga boshqa yuk yubormaydi, qaytsangiz boshidan ro'yxatdan o'tasiz. Ma'lumotlaringiz (raqam, sozlamalar, tarix) xizmat yozuvlarida saqlanib qoladi.";

// me — serverdagi foydalanuvchi; onSignedOut(me) — hisobdan chiqilgach; onDeleted() — hisob o'chirilgach
export function AccountCard({ me, onSignedOut, onDeleted }) {
  const [busy, setBusy] = useState(null); // "logout" | "delete"

  async function run(kind, question, action, done) {
    if (!(await confirmAction(question))) return;
    setBusy(kind);
    try {
      const result = await action();
      haptic.success();
      done(result);
    } catch (error) {
      haptic.error();
      setBusy(null);
      showAlert(error.message);
    }
  }

  const who = [me.name, me.username && `@${me.username}`].filter(Boolean).join(" · ");
  return (
    <Section title="👤 Hisob">
      {who && <p className="account-who">Telegram: {who}</p>}
      {/* Obuna (2026-11-27: Free / Pro / Max) — admin beradi */}
      {me.role !== "yuk_beruvchi" && <p className="hint">Obuna: {PLAN_ABOUT[me.plan] ?? PLAN_ABOUT.free} Obunani admin beradi.</p>}
      <div className="account-actions">
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => run("logout", LOGOUT_QUESTION, signOut, onSignedOut)}>
          {busy === "logout" ? "Chiqilyapti..." : "🚪 Chiqish"}
        </button>
        <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => run("delete", DELETE_QUESTION, deleteMe, onDeleted)}>
          {busy === "delete" ? "O'chirilyapti..." : "🗑 Hisobni o'chirish"}
        </button>
      </div>
      <p className="hint">
        Chiqish — bot yuk yubormaydi, qayta kirganingizda «Ro'yxatdan o'tish» dan boshlanadi, sozlamalaringiz esa saqlanib
        qoladi. O'chirish — hammasi butunlay o'chadi.{" "}
        {me.profile && "Vaqtincha kerak bo'lmasa — tepadagi «⏸ Pauza» yetarli."}
      </p>
    </Section>
  );
}
