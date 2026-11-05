// Umumiy kichik komponentlar: tugma, belgi (badge), almashtirgich, holat qutilari, sahifalash, xabarchalar.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { formatDateTime, formatNumber, timeAgo } from "./format.js";
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

export function Card({ title, actions, children, className = "", ...rest }) {
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

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="state state-error" role="alert">
      <div>
        <strong>{error.offline ? "Server bilan aloqa yo'q" : "Xato"}</strong>
        <p>
          {error.offline ? (
            <>
              API javob bermayapti — <code>npm start</code> ishlayaptimi? YukPlatform papkasida ishga tushiring va sahifani yangilang.
            </>
          ) : (
            error.message
          )}
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
export function Async({ state, children, loadingText }) {
  if (state.data == null && state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data == null) return <Loading text={loadingText} />;
  return (
    <>
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
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
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`tab ${tab.id === value ? "is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && <span className="tab-count">{formatNumber(tab.count)}</span>}
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
  const notify = useCallback((text, tone = "good") => {
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
