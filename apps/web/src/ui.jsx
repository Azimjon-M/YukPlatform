// Kichik umumiy bo'laklar: bo'lim, tanlov tugmalari, ikki-uch tanlovli almashtirgich, bo'sh/xato holati.
import { useLayoutEffect, useRef, useState } from "react";
import { sourceAvatarUrl } from "./api.js";
import { haptic } from "./telegram.js";

export function Section({ id, title, hint, error, children }) {
  return (
    <section id={id} className={`section${error ? " invalid" : ""}`}>
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Tanlov tugmalari: selected(id) — tanlanganmi, onPick(id) — bosilganda.
// Har tanlov: { id, label, sub? (o'ngda, qisqa: "20–40 tonna"), note? (nom ostida, uzunroq izoh), icon? (nom oldida — masalan guruh rasmi) }
// check — chapda chekbox katakchasi: bir nechtasini belgilash mumkinligi ko'rinib tursin
export function Chips({ options, selected, onPick, layout = "wrap", check = false }) {
  return (
    <div className={`chips ${layout}`}>
      {options.map((o) => {
        const on = selected(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`chip${on ? " on" : ""}${o.disabled ? " locked" : ""}`}
            aria-pressed={on}
            aria-disabled={o.disabled || undefined}
            onClick={() => {
              haptic.select();
              onPick(o.id);
            }}
          >
            {check && <span className="chip-box" aria-hidden="true">{on ? "✓" : ""}</span>}
            {o.icon}
            {o.note || o.marquee ? (
              <span className="chip-main">
                {o.marquee ? <Marquee text={o.label} /> : <span>{o.label}</span>}
                {o.note && <small className="note">{o.note}</small>}
              </span>
            ) : (
              <span>{o.label}</span>
            )}
            {o.sub2 ? (
              <span className="chip-side">
                {o.sub && <small>{o.sub}</small>}
                <small className="note">{o.sub2}</small>
              </span>
            ) : (
              o.sub && <small>{o.sub}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Bir qatorli matn: sig'masa — sekin chapga surilib oxirigacha ko'rsatadi, to'xtab, qaytadi (2026-11-27, Azimjon: «nomini 1
// qatorda qilib hammasini o'qish uchun chapdan unga borib qaytadigan qilsak»). Sig'sa — oddiy matn. Kenglik o'zgarsa qayta
// o'lchanadi; «harakatni kamaytirish» yoqilgan bo'lsa — surilmaydi, oxiri «…» (CSS)
export function Marquee({ text }) {
  const box = useRef(null);
  const inner = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const over = (inner.current?.scrollWidth ?? 0) - (box.current?.clientWidth ?? 0);
      setShift(over > 2 ? over : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [text]);
  // Tezlik ~35 px/s, ikki chetda to'xtash — animatsiyaning o'zida (keyframes), shuning uchun umumiy vaqt uzunroq
  const style = shift ? { "--marquee-shift": `-${shift}px`, "--marquee-time": `${Math.max(5, (shift / 35) * 2 + 3).toFixed(1)}s` } : undefined;
  return (
    <span ref={box} className={`marquee${shift ? " is-moving" : ""}`} title={text} style={style}>
      <span ref={inner} className="marquee-inner">
        {text}
      </span>
    </span>
  );
}

// Guruh/kanal rasmi (2026-11-27, «🎛 Filtr» dagi guruhlar): /pub/avatar/source/<nomi> (apps/api public.js). Kelguncha va
// yo'q bo'lsa (404) — nomning birinchi harfi. 🔒 — yopiq guruh
export function SourceAvatar({ name, label, closed = false }) {
  const [state, setState] = useState("loading"); // loading | ok | none
  const letter = Array.from(String(label ?? name).replace(/^[@\s]+/, ""))[0]?.toUpperCase() ?? "•";
  return (
    <span className="chip-avatar" aria-hidden="true">
      {state !== "ok" && <span className="chip-avatar-text">{letter}</span>}
      {state !== "none" && (
        <img src={sourceAvatarUrl(name)} alt="" loading="lazy" decoding="async" className={state === "ok" ? "is-loaded" : ""} onLoad={() => setState("ok")} onError={() => setState("none")} />
      )}
      {closed && <span className="chip-avatar-badge">🔒</span>}
    </span>
  );
}

// [Menga mos | Hammasi] — options: [{ id, label }]
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? "on" : ""}
          onClick={() => {
            haptic.select();
            onChange(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ title, children, action }) {
  return (
    <div className="empty">
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Yuklanyapti..." }) {
  return (
    <div className="spinner" role="status">
      <span className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}
