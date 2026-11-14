// «🛠 Boshqaruv» → «Telegram akkauntlari» (2026-11-13, Azimjon: «3 ta telegram accountni terminaldan bog'lash qiyin …
// faqat kompyuterimdan» → «Faqat raqam + kod» → «Browser qilma, O'zimizni MiniApp da qil»).
// Collector qaysi akkauntlar bilan o'qiyotgani va yangi akkaunt qo'shish: nom + raqam → Telegram kod yuboradi →
// kod → (2FA bo'lsa) parol. Kirish holati serverda (apps/api tgLogin.js): bitta telefonda kodni ko'rish uchun Telegram'da
// boshqa akkauntga o'tib, qaytib «🛠 Boshqaruv» ni qayta ochsa — shu bosqichdan davom etadi.
// Kod va parol faqat shu yerga yoziladi: chatga yozilgan kodni Telegram bekor qiladi, parol chat tarixida qolardi.
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ADMIN_TG, MY_TG } from "./api.js";
import { confirmAction, haptic } from "./telegram.js";
import { Notice, Spinner } from "./ui.jsx";
import { ACTIVE_STEPS, accountError, accountLabel, accountStatus, accountWho, codeWhere, scanText, suggestAccountName } from "./tgAccounts.js";

const POLL_MS = 10_000; // yangi akkaunt collector'ga ulanganini ko'rish uchun (≤ 30 s)
const QR_POLL_MS = 3_000; // QR kutilayotganda: yangi QR (~30 s da) va tasdiqlanganini tezroq ko'rish uchun

// tg://login?token=… → QR (SVG kvadratlar). Kutubxona faqat matritsani beradi — chizish o'zimizda (tashqi so'rovsiz)
function QrImage({ text }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    let d = "";
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { size: modules.size + 8, path: d };
  }, [text]);
  return (
    <svg className="tg-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Kirish uchun QR kod" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

// Faqat QR — «Telegram'da tasdiqlash» havolasi (tg://login?token=…) olib tashlandi (2026-11-14): Telegram uni ataylab
// qabul qilmaydi (fishingdan himoya) — Android (LaunchActivity, AuthAnotherClientUrl) ham, iOS (UrlLoginHint) ham havola
// bosilsa faqat «Sozlamalar → Qurilmalar → QR'ni skanerlang» deydi. Shuning uchun QR'ni BOSHQA qurilma skanerlaydi.
// Azimjon sinadi: kompyuterdagi Mini App'dagi QR'ni telefon skanerladi — ishladi.
function QrStep({ login, onCancel }) {
  return (
    <div className="section tg-acc">
      <h2>📷 Kodsiz kirish — QR'ni skanerlang</h2>
      <p className="hint">
        Qo'shilayotgan akkaunt ochiq turgan telefonda: Telegram → Sozlamalar → Qurilmalar → «Qurilma ulash» (Link Desktop Device) ni
        bosib, shu QR kodni skanerlang.
      </p>
      {login.qrUrl && <QrImage text={login.qrUrl} />}
      <p className="hint">QR har ~30 soniyada o'zi yangilanadi. Tasdiqlangach shu yerda «✅ qo'shildi» chiqadi (2FA bo'lsa — parol so'raladi).</p>
      <p className="hint">
        QR'ni boshqa qurilma skanerlaydi: bu sahifani kompyuterda (Telegram Desktop) yoki boshqa telefonda oching. Telefon bitta bo'lsa —
        «Bekor qilish» ni bosib, raqam va kod bilan kiring.
      </p>
      <div className="account-actions tg-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Bekor qilish
        </button>
      </div>
    </div>
  );
}

function AccountRow({ account, mine, onRelogin }) {
  const status = accountStatus(account);
  const who = accountWho(account);
  return (
    <article className="user">
      <div className="user-head">
        <strong>{mine ? accountWho(account) || "Telegram akkaunt" : accountLabel(account.name)}</strong>
        <span className={`tag${status.problem ? " tag-bad" : ""}`}>
          {status.icon} {status.label}
        </span>
      </div>
      <p className="muted small">
        {who && !mine ? `${who} · ` : ""}
        {account.dialogs} ta guruh/kanalga a'zo · {account.sources} ta manbani o'qiydi
      </p>
      {scanText(account.scan) && <p className="muted small">{scanText(account.scan)}</p>}
      {status.problem && accountError(account) && <p className="error small">{accountError(account)}</p>}
      {status.hint && <p className="muted small">{status.hint}</p>}
      {status.relogin && (
        <div className="user-actions">
          <button type="button" className="pill ghost" onClick={() => onRelogin(account.name)}>
            🔑 Qayta kirish
          </button>
        </div>
      )}
    </article>
  );
}

// Yangi kirish: nom + raqam
function StartForm({ initial, mine, busy, error, onSubmit, onQr, onCancel }) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState("");
  return (
    <form
      className="section tg-acc"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name.trim().toLowerCase(), phone);
      }}
    >
      <h2>{mine && name ? `🔑 «${name}» — qayta kirish` : "➕ Yangi Telegram akkaunt"}</h2>
      <p className="hint">Collector shu akkaunt bilan u a'zo bo'lgan guruhlarni (yopiqlarini ham) o'qiydi. Shaxsiy akkauntingizni emas — alohida raqamdagisini qo'shing.</p>
      {mine ? (
        <p className="hint">⚠️ Akkaunt sessiyasi serverimizda saqlanadi: u orqali guruhlardagi e'lonlar o'qiladi. Istalgan vaqtda Telegram'da «Sozlamalar → Qurilmalar» dan bu seansni yopib, ulanishni bekor qilasiz.</p>
      ) : (
        <>
          <label className="field">
            <span>Nom</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ikkinchi" autoCapitalize="none" autoCorrect="off" spellCheck="false" maxLength={20} />
          </label>
          <p className="hint tg-under">Ro'yxatda shu nom bilan ko'rinadi: kichik lotin harflari, raqam, _ yoki -.</p>
        </>
      )}
      <button type="button" className="primary tg-qr-start" disabled={busy || (!mine && !name.trim())} onClick={() => onQr(name.trim().toLowerCase())}>
        📷 QR orqali (kodsiz)
      </button>
      <p className="hint tg-under">Kod kutish shart emas: QR'ni akkaunt ochiq turgan telefon skanerlaydi — bu sahifa boshqa qurilmada (masalan, kompyuterda) ochiq bo'lishi kerak.</p>
      <p className="hint tg-or">yoki raqam va kod bilan:</p>
      <label className="field">
        <span>Raqami</span>
        <input type="tel" inputMode="tel" autoComplete="off" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="account-actions tg-actions">
        <button type="submit" className="secondary" disabled={busy || (!mine && !name.trim()) || !phone.trim()}>
          {busy ? "Yuborilyapti…" : "📨 Kod yuborish"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Bekor qilish
        </button>
      </div>
    </form>
  );
}

function SecretStep({ title, children, label, input, busy, error, submitText, onSubmit, onCancel }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="section tg-acc"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value);
      }}
    >
      <h2>{title}</h2>
      {children}
      <label className="field">
        <span>{label}</span>
        <input {...input} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="account-actions tg-actions">
        <button type="submit" className="primary" disabled={busy || !value.trim()}>
          {busy ? "Tekshirilyapti…" : submitText}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Bekor qilish
        </button>
      </div>
    </form>
  );
}

const RESEND_TO = { sms: "SMS orqali", call: "qo'ng'iroq orqali", fragment: "Fragment orqali" };

function CodeStep({ login, busy, error, onSubmit, onResend, onCancel }) {
  const canResend = (login.resends ?? 0) < 3 && Boolean(login.next); // next yo'q — Telegram boshqa yo'l bermaydi (ResendCode xato beradi)
  return (
    <SecretStep
      title={`🔑 «${login.name}» — kodni kiriting`}
      label="Kod"
      input={{ inputMode: "numeric", autoComplete: "one-time-code", placeholder: login.codeLength ? "•".repeat(login.codeLength) : "12345", maxLength: 40 }}
      busy={busy}
      error={error}
      submitText="Kirish"
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      <p className="hint">{codeWhere(login)}</p>
      {login.via === "app" && (
        <p className="hint">
          Kod SMS bo'lib emas, Telegram'ning o'zida keladi: shu raqamli akkaunt ochiq turgan telefon yoki kompyuterda «Telegram» nomli
          rasmiy chatni oching.
        </p>
      )}
      {canResend && (
        <button type="button" className="secondary tg-resend" disabled={busy} onClick={onResend}>
          🔁 Kod kelmadimi? {login.next && RESEND_TO[login.next] ? `${RESEND_TO[login.next]} yuborish` : "Qayta yuborish"}
          {login.resendIn > 0 ? ` (${login.resendIn} soniyadan keyin)` : ""}
        </button>
      )}
      <details className="tg-help">
        <summary>Shu telefonning o'zida qanday qilinadi?</summary>
        <ol>
          <li>Telegram'da o'sha akkauntga o'ting (Android — chap menyu; iPhone — pastdagi «Sozlamalar» ni bosib turing).</li>
          <li>«Telegram» chatidagi kodni nusxalang.</li>
          <li>Shu akkauntga qaytib, ilovada shu bo'limni qayta oching — shu yerdan davom etasiz (15 daqiqa ichida).</li>
        </ol>
      </details>
      <p className="hint">⚠️ Kodni faqat shu yerga yozing — hech kimga va hech qanday chatga yubormang: chatga yozilgan kodni Telegram bekor qiladi.</p>
    </SecretStep>
  );
}

function PasswordStep({ login, busy, error, onSubmit, onCancel }) {
  return (
    <SecretStep
      title={`🔒 «${login.name}» — ikki bosqichli parol`}
      label="Parol"
      input={{ type: "password", autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: "false", maxLength: 256 }}
      busy={busy}
      error={error}
      submitText="Kirish"
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      <p className="hint">
        Bu akkauntda 2FA paroli bor — akkaunt egasi qo'ygan parolni kiriting.{login.hint ? ` Eslatma: «${login.hint}».` : ""} Parol hech qayerda saqlanmaydi.
      </p>
    </SecretStep>
  );
}

// mine — Sozlamalardagi «Telegram akkauntlarim» (istalgan foydalanuvchi, faqat o'zi qo'shganlari, nomni server beradi);
// aks holda — admin «🛠 Boshqaruv» (collector'ning hamma akkauntlari)
export function TgAccounts({ onAuthLost, mine = false }) {
  const api = mine ? MY_TG : ADMIN_TG;
  const [data, setData] = useState(null); // { accounts, login, unavailable }
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null); // { name } — «Yangi akkaunt» formasi ochiq
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get());
      setLoadError(null);
    } catch (e) {
      if (e.code === "auth") onAuthLost();
      setLoadError(e);
    }
  }, [api, onAuthLost]);

  useEffect(() => {
    load();
    const timer = setInterval(() => !document.hidden && load(), POLL_MS);
    // Telegram'da akkaunt almashtirib qaytganda — darhol yangilaymiz
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // QR kutilayotganda tezroq: yangi QR va «tasdiqlandi» darhol ko'rinsin
  const waitingQr = data?.login?.step === "qr";
  useEffect(() => {
    if (!waitingQr) return undefined;
    const timer = setInterval(() => !document.hidden && load(), QR_POLL_MS);
    return () => clearInterval(timer);
  }, [waitingQr, load]);

  // Har amal: javobdagi kirish holati darhol ko'rsatiladi; xato — tugmalar ostida
  const act = useCallback(
    async (fn, { closeForm = false } = {}) => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        setData((d) => (d ? { ...d, login: result.login ?? null } : d));
        if (closeForm) setForm(null);
        if (result.login?.error || result.login?.step === "failed") haptic.error();
        else haptic.success();
        load();
      } catch (e) {
        haptic.error();
        if (e.code === "auth") onAuthLost();
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [load, onAuthLost],
  );

  if (loadError && !data) {
    if (loadError.code === "outdated") return <Notice title="Telegram akkauntlari">Server qayta ishga tushirilgach ko'rinadi.</Notice>;
    return (
      <Notice
        title="Telegram akkauntlari ochilmadi"
        action={
          <button type="button" className="primary" onClick={load}>
            Qayta urinish
          </button>
        }
      >
        {loadError.message}
      </Notice>
    );
  }
  if (!data) return <Spinner />;

  const login = data.login;
  const active = login && ACTIVE_STEPS.has(login.step);
  const openForm = (name) => {
    setError(null);
    setForm({ name: name ?? (mine ? "" : suggestAccountName(data.accounts)) });
  };
  const cancel = async () => {
    if (active && !(await confirmAction("Kirish bekor qilinsinmi? Kod kelgan bo'lsa ham ishlatilmaydi."))) return;
    setError(null);
    await act(() => api.cancel(login.id).then(() => ({ login: null })));
  };

  let panel;
  if (form && !active) {
    panel = (
      <StartForm
        key={form.name}
        initial={form}
        mine={mine}
        busy={busy}
        error={error}
        onSubmit={(name, phone) => act(() => api.start(name || null, phone), { closeForm: true })}
        onQr={(name) => act(() => api.startQr(name || null), { closeForm: true })}
        onCancel={() => {
          setForm(null);
          setError(null);
        }}
      />
    );
  } else if (login?.step === "code") {
    panel = <CodeStep key={`code-${login.id}`} login={login} busy={busy} error={error ?? login.error} onSubmit={(code) => act(() => api.code(login.id, code))} onResend={() => act(() => api.resend(login.id))} onCancel={cancel} />;
  } else if (login?.step === "qr") {
    panel = <QrStep key={`qr-${login.id}`} login={login} onCancel={cancel} />;
  } else if (login?.step === "password") {
    panel = (
      <PasswordStep key={`pw-${login.id}`} login={login} busy={busy} error={error ?? login.error} onSubmit={(password) => act(() => api.password(login.id, password))} onCancel={cancel} />
    );
  } else if (active) {
    // Boshqa oynada so'rov ketyapti (kod yuborilyapti / tekshirilyapti)
    panel = (
      <div className="section tg-acc">
        <Spinner label={login.step === "sending" ? "Kod yuborilyapti…" : "Tekshirilyapti…"} />
      </div>
    );
  } else if (login?.step === "done") {
    const who = login.user ? accountWho(login.user) : "";
    panel = (
      <div className="section tg-acc">
        <h2>✅ «{login.name}» qo'shildi</h2>
        <p>{who ? `${who} akkauntiga kirildi.` : "Akkauntga kirildi."} Collector uni 30 soniya ichida o'qishga ulaydi — yuqoridagi ro'yxatda «✅ ishlayapti» bo'ladi.</p>
        <p className="hint">
          {mine
            ? "Bu akkaunt a'zo bo'lgan guruh va kanallarni adminlar tekshiruvdan o'tkazadi: yuk e'lonlari bor bo'lganlari manbaga olinadi va ulardagi mos yuklar sizga ham keladi."
            : "Yopiq guruhni o'qitish: shu akkauntni guruhga qo'shing (guruh a'zosi qo'shadi), keyin kompyuterdagi boshqaruv markazida «Manbalar» → «Yopiq guruh qo'shish»."}
        </p>
        <div className="account-actions tg-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => act(() => api.cancel(login.id).then(() => ({ login: null })))}>
            Yopish
          </button>
        </div>
      </div>
    );
  } else if (login?.step === "failed") {
    panel = (
      <div className="section tg-acc">
        <h2>❌ «{login.name}» ga kirilmadi</h2>
        <p className="error">{login.error}</p>
        <div className="account-actions tg-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => openForm(login.name)}>
            Qaytadan boshlash
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => act(() => api.cancel(login.id).then(() => ({ login: null })))}>
            Yopish
          </button>
        </div>
      </div>
    );
  } else if (!data.unavailable) {
    panel = (
      <button type="button" className="more" onClick={() => openForm()}>
        ➕ Akkaunt qo'shish
      </button>
    );
  }

  return (
    <>
      {data.accounts.length === 0 ? (
        mine ? null : <div className="notice">Collector hali hech bir akkaunt haqida yozmagan (u ishga tushgach ko'rinadi).</div>
      ) : (
        <div className="users">
          {data.accounts.map((account) => (
            <AccountRow key={account.name} account={account} mine={mine} onRelogin={(name) => !active && openForm(name)} />
          ))}
        </div>
      )}
      {data.unavailable && !active ? <div className="notice">{data.unavailable}</div> : panel}
    </>
  );
}
