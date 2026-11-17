// Umumiy kichik komponentlar: tugma, belgi (badge), almashtirgich, holat qutilari, sahifalash, xabarchalar, tasdiqlash oynasi.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { describeError } from "./errorInfo.js";
import { recordMessage } from "./errors.js";
import { ErrorScreen } from "./ErrorScreen.jsx";
import { formatDateTime, formatNumber, formatTime, timeAgo } from "./format.js";
import { Link } from "./navigation.jsx";
import { pageInfo } from "./query.js";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// collapsible — sarlavhani bosib ochiladigan karta (telefonda uzun sahifani qisqartiradi). hint — yopiqligida sarlavha
// yonidagi qisqa holat; actions ochilganda kartaning ichida (summary ichidagi tugma kartani ham ochib-yopib yuborardi)
export function Card({ title, actions, children, className = "", collapsible = false, defaultOpen = false, hint = null, ...rest }) {
  if (collapsible) {
    return (
      <details className={`card card-collapsible ${className}`} open={defaultOpen || undefined} {...rest}>
        <summary className="card-head">
          <span className="card-summary">
            <h2>{title}</h2>
            {hint && <span className="card-hint">{hint}</span>}
          </span>
          <span className="chevron" aria-hidden="true" />
        </summary>
        {actions && <div className="card-actions">{actions}</div>}
        {children}
      </details>
    );
  }
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// tone: good | warning | serious | critical | info | neutral — rang + belgi + so'z (rang yolg'iz emas)
export function Badge({ tone = "neutral", icon, children, title }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {icon && (
        <span className="badge-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

export function Button({ variant = "secondary", busy = false, disabled, children, className = "", ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ariaLabel — o'zgarmas nom (ko'rinadigan label holat bilan o'zgarsa: "Yoqilgan" / "O'chirilgan")
export function Toggle({ checked, onChange, label, disabled, busy, hideLabel = false, ariaLabel }) {
  return (
    <label className={`toggle ${disabled || busy ? "is-disabled" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? (hideLabel ? label : undefined)}
        disabled={disabled || busy}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
      {!hideLabel && <span className="toggle-label">{label}</span>}
    </label>
  );
}

// «Ishonchingiz komilmi?» oynasi (modal). Brauzerning o'z <dialog> elementi: ochilganda orqadagi sahifa bosilmaydi,
// klaviatura oyna ichida qoladi, Esc yoki orqa fonni bosish — bekor qilish. Fokus avval «Bekor qilish» da
// (tasodifan Enter bosilsa — hech narsa bo'lmaydi). busy — so'rov ketyapti: oynani yopib bo'lmaydi
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Bekor qilish", tone = "danger", busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  const cancel = () => !busy && onCancel();
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Esc — o'zimiz yopamiz (open holati React'da)
        cancel();
      }}
      onClick={(e) => e.target === ref.current && cancel()}
    >
      {open && (
        <div className="modal-body">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <div className="modal-text">{children}</div>
          <div className="modal-actions">
            <Button onClick={cancel} disabled={busy} autoFocus>
              {cancelLabel}
            </Button>
            <Button variant={tone} onClick={onConfirm} busy={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Loading({ text = "Yuklanmoqda…" }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" /> {text}
    </div>
  );
}

// Qisqa xato qutisi (sahifa ichida). Turi bo'yicha sarlavha: «Server javob bermadi», «Serverda xato (500)» ...
// updatedAt — ekrandagi ma'lumot qachongi (yangilash xato bo'lsa, eski ma'lumot ko'rinib turadi)
export function ErrorBox({ error, onRetry, updatedAt = null }) {
  if (!error) return null;
  const info = describeError(error, { kind: error.kind ?? "client" });
  return (
    <div className="state state-error" role="alert">
      <div>
        <strong>
          <span aria-hidden="true">{info.icon}</span> {info.title}
        </strong>
        <p>
          {info.text}
          {info.kind === "offline" || info.kind === "timeout" ? ` ${info.hint}` : ""}
        </p>
        <p className="muted small">
          {updatedAt ? `Ko'rinib turgan ma'lumot ${formatTime(updatedAt, { seconds: true })} holatida. ` : ""}
          <Link to="/xatolar">Barcha xatolar →</Link>
        </p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} variant="secondary">
          Qayta urinish
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="state state-empty">
      <strong>{title}</strong>
      {children && <div className="state-text">{children}</div>}
    </div>
  );
}

// Sahifa holatini bir joyda: birinchi yuklanish, xato (ma'lumot hali yo'q), keyin — kontent
// Ma'lumot hali yo'q va xato — to'liq xato sahifasi (server javob bermadi / aloqa yo'q / 500 ...);
// ma'lumot bor, faqat yangilash xato — ustida qisqa quti, eski ma'lumot ko'rinib turadi
export function Async({ state, children, loadingText }) {
  if (state.data == null && state.error) return <ErrorScreen error={state.error} onRetry={state.reload} />;
  if (state.data == null) return <Loading text={loadingText} />;
  return (
    <>
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} updatedAt={state.updatedAt} />}
      <div className={state.loading ? "is-refreshing" : undefined}>{children(state.data)}</div>
    </>
  );
}

export function Pager({ offset, limit, total, onChange: change }) {
  const info = pageInfo({ offset, limit, total });
  const onChange = (next) => {
    change(next);
    window.scrollTo({ top: 0 });
  };
  if (total <= limit && offset === 0) return null;
  return (
    <nav className="pager" aria-label="Sahifalar">
      <Button onClick={() => onChange(info.prevOffset)} disabled={!info.hasPrev}>
        ← Oldingi
      </Button>
      <span className="pager-info">
        {formatNumber(info.first)}–{formatNumber(info.last)} / {formatNumber(info.total)}
      </span>
      <Button onClick={() => onChange(info.nextOffset)} disabled={!info.hasNext}>
        Keyingi →
      </Button>
    </nav>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs chips" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`chip ${tab.id === value ? "is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && <span className="chip-count">{formatNumber(tab.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function TimeAgo({ ts, now }) {
  if (ts == null) return <span>—</span>;
  return (
    <time dateTime={new Date(ts).toISOString()} title={formatDateTime(ts)}>
      {timeAgo(ts, now)}
    </time>
  );
}

export function ExternalLink({ href, children, className = "" }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`ext-link ${className}`}>
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (yangi oynada)</span>
    </a>
  );
}

// --- Xabarchalar: "Saqlandi", "Xato: ..." — pastki burchakda bir necha soniya ---
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  // record: false — xato allaqachon jurnalga yozilgan (masalan, ushlanmagan xato haqidagi xabarcha)
  const notify = useCallback((text, tone = "good", { record = true } = {}) => {
    if (tone === "critical" && record) recordMessage(String(text)); // «Xatolar» bo'limida ham qolsin
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "critical" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast tone-${t.tone}`}>
            <span aria-hidden="true">{t.tone === "critical" ? "✖" : "✓"}</span> {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Sahifa sarlavhasi (brauzer tabida)
export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — Boshqaruv markazi` : "Boshqaruv markazi";
  }, [title]);
}

// Ixcham akkordeon qatori (Yuklar, Navbat, AI): yopiq — sarlavha, ikkinchi satr va o'ngda qisqa holat;
// bosilsa — hamma tafsilot. lead — chapdagi kichik belgi (ixtiyoriy). Ro'yxat: <ul className="rows">
export function ExpandRow({ lead = null, title, sub = null, side = null, children, defaultOpen = false, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <li className={`row-item ${open ? "is-open" : ""} ${className}`.trim()}>
      <button type="button" className={`row-head ${lead ? "has-lead" : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {lead && <span className="row-lead">{lead}</span>}
        <span className="row-main">
          <span className="row-title">{title}</span>
          {sub && <span className="row-sub">{sub}</span>}
        </span>
        {side && <span className="row-side">{side}</span>}
        <span className="chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="row-body" id={id}>
          {children}
        </div>
      )}
    </li>
  );
}

// Kichik dumaloq rasm (haydovchi profili, guruh/kanal — /api/avatar/..., apps/api avatars.js). Rasm kelguncha va
// umuman yo'q bo'lsa (404) — bosh harflar. badge — burchakdagi kichik belgi (🔒 yopiq guruh), online — yashil nuqta
export function Avatar({ src, text, online = false, badge = null, className = "" }) {
  const [state, setState] = useState("loading"); // loading | ok | none
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {state !== "ok" && <span className="avatar-text">{text}</span>}
      {src && state !== "none" && (
        <img src={src} alt="" loading="lazy" decoding="async" className={state === "ok" ? "is-loaded" : ""} onLoad={() => setState("ok")} onError={() => setState("none")} />
      )}
      {online && <span className="avatar-online" />}
      {badge && <span className="avatar-badge">{badge}</span>}
    </span>
  );
}

export const avatarUrl = (kind, key) => `/api/avatar/${kind}/${encodeURIComponent(key)}`;
