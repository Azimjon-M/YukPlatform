// Kichik umumiy bo'laklar: bo'lim, tanlov tugmalari, ikki-uch tanlovli almashtirgich, bo'sh/xato holati.
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
// Har tanlov: { id, label, sub? (o'ngda, qisqa: "20–40 tonna"), note? (nom ostida, uzunroq izoh) }
export function Chips({ options, selected, onPick, layout = "wrap" }) {
  return (
    <div className={`chips ${layout}`}>
      {options.map((o) => {
        const on = selected(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => {
              haptic.select();
              onPick(o.id);
            }}
          >
            {o.note ? (
              <span className="chip-main">
                <span>{o.label}</span>
                <small className="note">{o.note}</small>
              </span>
            ) : (
              <span>{o.label}</span>
            )}
            {o.sub && <small>{o.sub}</small>}
          </button>
        );
      })}
    </div>
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
