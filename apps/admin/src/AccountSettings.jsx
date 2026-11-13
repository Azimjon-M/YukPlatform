// Hisob oynasi: login va parolni almashtirish (Azimjon, 2026-11-11: «username va parolli bo'lishligi kerak»).
// Panel internetga chiqqani uchun login ham almashtiriladigan bo'ldi — «admin» deb ochiq qolib ketmasin.
// Eski parol shart: kompyuter oldida ketma-ket o'tirgan odam sessiyadan foydalanib hisobni o'zibertmasin.
// Sessiya uzilmaydi — kirgan holat saqlanadi, faqat keyingi kirishda yangi login/parol so'raladi.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api.js";
import { sessionState, subscribeSession, updateAccount } from "./session.js";
import { Button, Field } from "./ui.jsx";

// Xato matnini foydalanuvchiga tushunarli qilib qaytaramiz (server matni avval beriladi — u o'zbekcha)
function text(error) {
  if (error instanceof ApiError) {
    if (error.kind === "timeout") return "Server javob bermadi — qayta urinib ko'ring";
    if (error.offline) return "Serverga ulanib bo'lmadi";
    return error.message;
  }
  return "Kutilmagan xato. Sahifani yangilab qayta urinib ko'ring.";
}

export function AccountSettings() {
  const session = useSyncExternalStore(subscribeSession, sessionState, sessionState);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = (node) => (dialog.current = node);
  const dialog = { current: null };

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);

  // login maydoniga hozirgi login'ni qo'yamiz — odam o'zi bilishi shart emas (u parolni biladi)
  function openDialog() {
    setUsername(session.login ?? "");
    setOldPassword("");
    setPassword("");
    setRepeat("");
    setError(null);
    setOpen(true);
  }

  async function save() {
    if (busy) return;
    if (!oldPassword) return setError("O'zgarishni tasdiqlash uchun eski parolni kiriting");
    if (password && password !== repeat) return setError("Yangi parol ikki marta bir xil yozilmadi");
    if (!password && (!username.trim() || username.trim() === session.login)) return setError("Login yoki yangi parol kiriting");
    setBusy(true);
    setError(null);
    try {
      await updateAccount({
        username: username.trim() && username.trim() !== session.login ? username.trim() : undefined,
        oldPassword,
        password: password || undefined,
        repeat: password ? repeat : undefined,
      });
      setOpen(false);
    } catch (err) {
      setError(text(err));
      if (err?.status === 401) setOldPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="link-button" onClick={openDialog}>
        Hisob
      </button>
      <dialog
        className="modal"
        ref={ref}
        aria-labelledby="account-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setOpen(false);
        }}
        onClick={(e) => e.target === dialog.current && !busy && setOpen(false)}
      >
        {open && (
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h2 id="account-title" className="modal-title">
              Hisob (login va parol)
            </h2>
            <div className="modal-text">
              <p className="muted small">
                Panelga kirish login va parol bilan. Hozirgi login: <strong>{session.login ?? "—"}</strong>
                {session.loginSource === "env" ? " (.env orqali qo'yilgan)" : ""}
              </p>
              <Field label="Login">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={3}
                  maxLength={40}
                />
              </Field>
              <Field label="Eski parol (tasdiq uchun)">
                <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Field label="Yangi parol (bo'sh — o'zgarmaydi)">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} />
              </Field>
              <Field label="Yangi parol (qayta)">
                <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} />
              </Field>
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Bekor qilish
              </Button>
              <Button variant="primary" type="submit" busy={busy}>
                Saqlash
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
