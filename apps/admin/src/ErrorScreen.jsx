// Xato sahifasi: sahifa yiqilsa (React chizishda xato), server javob bermasa / aloqa yo'q / 500, manzil topilmasa.
// Oq ekran o'rniga — nima bo'lgani, nima qilish kerakligi, texnik tafsilotlar va «Nusxa olish».
import { Component, useState } from "react";
import { describeError } from "./errorInfo.js";
import { recordError } from "./errors.js";
import { Link } from "./navigation.jsx";
import { Button } from "./ui.jsx";

// Ekrandagi hamma narsa oddiy matn bo'lib — Claude'ga yoki boshqaga yuborish uchun
function screenReport(info) {
  return [
    `${info.title}`,
    info.text,
    ...info.rows.map(([name, value]) => `${name}: ${value}`),
    `Manzil: ${window.location.href}`,
    info.stack ? `\n${info.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// Nusxa olish: localhost — xavfsiz kontekst, clipboard ishlaydi; bo'lmasa (eski brauzer) — yashirin maydon orqali
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Nusxa olish" }) {
  const [state, setState] = useState(null); // null | "ok" | "fail"
  async function copy() {
    setState((await copyText(typeof text === "function" ? text() : text)) ? "ok" : "fail");
    setTimeout(() => setState(null), 2500);
  }
  return (
    <Button onClick={copy} aria-live="polite">
      {state === "ok" ? "✓ Nusxa olindi" : state === "fail" ? "Nusxa olinmadi" : label}
    </Button>
  );
}

// error — Error / ApiError; kind — majburiy tur ("crash", "notfound"); onRetry — «Qayta urinish»;
// standalone — butun ilova yiqilgan (menyu yo'q): faqat «Sahifani yangilash»
export function ErrorScreen({ error = null, kind = null, componentStack = null, path = null, onRetry = null, standalone = false }) {
  const info = describeError(error, { kind, componentStack, path, page: window.location.pathname });
  const titleId = "error-title";
  return (
    <section className={`error-screen tone-${info.kind}${standalone ? " is-standalone" : ""}`} role="alert" aria-labelledby={titleId}>
      <div className="error-icon" aria-hidden="true">
        {info.icon}
      </div>
      <h1 id={titleId}>{info.title}</h1>
      {info.text && <p className="error-text">{info.text}</p>}
      {info.hint && <p className="error-hint">{info.hint}</p>}
      <div className="error-actions">
        {onRetry && (
          <Button variant="primary" onClick={onRetry}>
            Qayta urinish
          </Button>
        )}
        <Button variant={onRetry ? "secondary" : "primary"} onClick={() => window.location.reload()}>
          Sahifani yangilash
        </Button>
        {info.kind !== "notfound" && <CopyButton text={() => screenReport(info)} />}
        {!standalone && (
          <>
            {info.kind !== "notfound" && (
              <Link to="/xatolar" className="btn btn-ghost">
                Barcha xatolar →
              </Link>
            )}
            <Link to="/" className="btn btn-ghost">
              Bosh sahifa
            </Link>
          </>
        )}
      </div>
      {(info.rows.length > 0 || info.stack) && (
        <details className="error-details">
          <summary>Texnik tafsilotlar</summary>
          {info.rows.length > 0 && (
            <dl className="error-rows">
              {info.rows.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {info.stack && <pre className="error-stack">{info.stack}</pre>}
        </details>
      )}
    </section>
  );
}

// Sahifa chizilayotganda xato — butun ilova oq bo'lib qolmasin: shu qism o'rniga xato sahifasi.
// App har sahifani alohida o'raydi (key = sahifa: boshqa bo'limga o'tsangiz — qaytadan), main.jsx butun ilovani.
// React'da bu faqat class komponent bilan qilinadi (getDerivedStateFromError + componentDidCatch).
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    recordError(error, { kind: "crash", componentStack: info?.componentStack ?? null });
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorScreen
        error={error}
        kind="crash"
        componentStack={componentStack}
        standalone={this.props.standalone}
        onRetry={this.props.standalone ? null : () => this.setState({ error: null, componentStack: null })}
      />
    );
  }
}
