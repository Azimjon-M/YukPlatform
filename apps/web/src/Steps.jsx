// Ro'yxatdan o'tish — qadamma-qadam (birinchi marta, profil hali yo'q). Keyin sozlamalar bitta sahifa bo'lib ochiladi.
//   tepada:   ①──②──③  Transport · O'lcham · Tasdiqlash (o'tilgan qadamni bosib, qaytish mumkin)
//   Telegram: pastdagi katta tugma «Keyingi» / «✅ Saqlash», tepadagi «← Orqaga» — Telegram'ning o'z tugmalari
//   saytda:   sahifa pastida «← Orqaga» va «Keyingi →» tugmalari
// Oxirgi qadamda tanlanganlar ro'yxati (@yuk/shared profileRows — bot «✅ Saqlandi» xabarida ham shular): qatorni
// bosib, o'sha qadamga qaytib o'zgartiradi va «✅ Tayyor» bilan yana «Tekshiring» ga qaytadi (keyingi qadamlarga emas).
import { useCallback, useState } from "react";
import { haptic, inTelegram, useBackButton, useMainButton } from "./telegram.js";

// steps — [{ id, title }] (ro'yxat o'zgarishi mumkin: tyagachda «O'lcham» qadami yo'q — shuning uchun qadam id bilan
// eslab qolinadi). validate(upTo, go, index) → true (o'tish mumkin) | false (xato ko'rsatildi; xato boshqa qadamda
// bo'lsa, validate o'zi go(o'sha qadam) qiladi); upTo — shu qadamgacha tekshiriladi. onFinish — oxirgi qadamda «Saqlash»
export function useSteps(steps, { validate = () => true, onFinish }) {
  const [currentId, setCurrentId] = useState(steps[0].id);
  const [returnTo, setReturnTo] = useState(null); // «O'zgartirish» bosilgan qadam («Tekshiring») — o'shanga qaytamiz
  const found = steps.findIndex((s) => s.id === currentId);
  const index = found >= 0 ? found : 0;
  const last = index === steps.length - 1;
  const returnIndex = returnTo ? steps.findIndex((s) => s.id === returnTo) : -1;
  const returning = returnIndex > index;
  const go = useCallback(
    (target) => {
      setCurrentId(steps[Math.max(0, Math.min(target, steps.length - 1))].id);
      window.scrollTo(0, 0);
    },
    [steps],
  );
  const back = useCallback(() => {
    haptic.select();
    setReturnTo(null);
    go(Math.max(0, index - 1));
  }, [go, index]);
  const next = useCallback(() => {
    const target = returning ? returnIndex : index + 1;
    if (!validate(last ? index : target - 1, go, index)) return;
    if (last) {
      onFinish();
      return;
    }
    haptic.select();
    setReturnTo(null);
    go(target);
  }, [go, index, last, returning, returnIndex, validate, onFinish]);
  // Oldingi qadamga o'zgartirish uchun o'tish (tepadagi raqam yoki «Tekshiring» dagi qator): keyin shu yerga qaytadi
  const edit = useCallback(
    (target) => {
      haptic.select();
      setReturnTo(steps[index].id);
      go(target);
    },
    [go, index, steps],
  );
  return { index, step: steps[index], last, returning, back, next, go, edit };
}

// Telegram tugmalari. registering — qadamlar (Keyingi / Orqaga), aks holda sozlamalar sahifasi (bitta «Saqlash»)
export function useFormButtons({ registering, wizard, save, busy }) {
  const text = busy ? "Saqlanyapti..." : !registering ? "Saqlash" : wizard.returning ? "✅ Tayyor" : wizard.last ? "✅ Saqlash" : "Keyingi";
  useMainButton(text, registering ? wizard.next : save);
  useBackButton(wizard.back, registering && wizard.index > 0);
}

export function StepHeader({ steps, index, onJump }) {
  return (
    <nav className="steps" aria-label={`Ro'yxatdan o'tish: ${index + 1}-qadam, jami ${steps.length}`}>
      <ol>
        {steps.map((s, i) => {
          const state = i < index ? "done" : i === index ? "on" : "todo";
          return (
            <li key={s.id} className={state}>
              <button type="button" disabled={i >= index} aria-current={i === index ? "step" : undefined} onClick={() => onJump(i)}>
                <span className="dot" aria-hidden="true">
                  {i < index ? "✓" : i + 1}
                </span>
                <span className="name">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// Saytda (Telegram'dan tashqarida) pastdagi tugmalar
export function StepNav({ index, last, returning, back, next, busy }) {
  if (inTelegram) return null;
  return (
    <div className="footer step-nav">
      {index > 0 && (
        <button type="button" className="back" onClick={back} disabled={busy}>
          ← Orqaga
        </button>
      )}
      <button type="button" className="save" onClick={next} disabled={busy}>
        {busy ? "Saqlanyapti..." : returning ? "✅ Tayyor" : last ? "✅ Saqlash" : "Keyingi →"}
      </button>
    </div>
  );
}

// label'siz qatorlar (🌍 doira) uchun sarlavha
const ROW_TITLES = { intl: "Hudud" };

// rows — profileRows(); stepOf(rowId) → qadam raqami; onEdit(index)
export function ProfileSummary({ rows, stepOf, onEdit }) {
  return (
    <section className="section summary-card">
      <h2>✅ Tekshiring</h2>
      <ul className="summary-list">
        {rows.map((r) => {
          const target = stepOf(r.id);
          const content = (
            <>
              <span className="icon" aria-hidden="true">
                {r.icon}
              </span>
              <span className="text">
                <small>{r.label ?? ROW_TITLES[r.id] ?? ""}</small>
                <span>{r.value}</span>
              </span>
            </>
          );
          return (
            <li key={r.id}>
              {target == null ? (
                <div className="summary-row">{content}</div>
              ) : (
                <button type="button" className="summary-row" onClick={() => onEdit(target)}>
                  {content}
                  <span className="edit">O'zgartirish</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
