// Kirish sahifasi (Azimjon, 2026-11-11: «Web uchun Login saxifa qilsang!»).
// Dashboard internetga chiqqani uchun kirish so'raladi — nginx'ning oddiyBrauzer oynasi o'rniga loyihaning
// o'z sahifasi. 2026-11-11 (Azimjon: «username va parolli bo'lishligi kerak»): endi LOGIN + PAROL so'raladi.
// Login serverda saqlanadi (settings.admin_user), parol kabi — ochiq matn emas. Xato login va xato parolda
// bir xil javob qaytadi («Login yoki parol noto'g'ri») — tashqaridagi odam login'ni sinab topa olmasin.
// Login/parol hali qo'yilmagan bo'lsa (birinchi ishga tushirish) — birinchilarini shu yerda qo'yamiz.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api.js";
import { checkSession, setupPassword, signIn } from "./session.js";
import { Button, Field } from "./ui.jsx";

// Serverdan kelgan xato matni (login 401/429) yoki tarmoq xatosi — foydalanuvchiga tushunarli matn
function errorText(error, timeoutSec = null) {
  if (error instanceof ApiError) {
    if (error.kind === "timeout") return `Server ${timeoutSec ?? Math.round(error.timeoutMs / 1000)} soniya ichida javob bermadi — qayta urinib ko'ring`;
    if (error.offline) return "Serverga ulanib bo'lmadi — boshqaruv markazi ishlayaptimi?";
    return error.message;
  }
  return "Kutilmagan xato. Sahifani yangilab, qayta urinib ko'ring.";
}

export function LoginPage() {
  const [configured, setConfigured] = useState(true); // false — parol hali qo'yilmagan (birinchi ishga tushirish)
  const [phase, setPhase] = useState("checking"); // checking | form | offline
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0); // «Qayta urinish» — serverni yana tekshirish
  const loginInput = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const state = await checkSession();
      if (!alive) return;
      if (state.status === "offline") return setPhase("offline");
      setConfigured(state.configured);
      // Birinchi ishga tushirishda .env dagi ADMIN_LOGIN oldindan keltirilgan bo'lishi mumkin —
      // uni maydonga qo'yib qo'yamiz (kirilgan bo'lsa), parolda esa login aslamiz (tashqaridan ko'rinmasin)
      if (!state.configured && state.envLogin) setUsername((v) => v || state.envLogin);
      setPhase("form");
    })();
    return () => (alive = false);
  }, [retry]);

  useEffect(() => {
    // Sahifa ochilganda kursor birinchi bo'sh joyga qo'yiladi (brauzer login/parolni avtomatik to'ldiradi).
    // DIKKAT: faqat phase o'zgarsa — har klavishda emas. Aks holda login yozayotganda kursor parol
    //joyiga sakrab, so'zlar ikkalamaydonga aralashib ketadi.
    if (phase !== "form") return;
    (loginInput.current && !loginInput.current.value ? loginInput.current : input.current)?.focus();
  }, [phase]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim()) return setError("Loginni kiriting");
    if (!password) return setError("Parolni kiriting");
    if (!configured && password !== repeat) return setError("Parol ikki marta bir xil yozilmadi");
    setBusy(true);
    setError(null);
    try {
      if (configured) await signIn({ username, password, remember });
      else await setupPassword({ username, password, repeat });
      // Muvaffaqiyat: App.jsx session holatini o'qib, panelni ochadi
    } catch (err) {
      setError(errorText(err));
      setPassword((value) => (err?.status === 401 ? "" : value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 16V7l9-4 9 4v9l-9 4-9-4Z" />
              <path d="M3 7l9 4 9-4M12 11v9" />
            </svg>
          </span>
          <div>
            <strong>Yuk Ekspert</strong>
            <small>Boshqaruv markazi</small>
          </div>
        </div>

        <h1>{configured ? "Kirish" : "Birinchi hisobni yarating"}</h1>
        <p className="login-hint">
          {phase === "offline"
            ? "Server javob bermayapti. Boshqaruv markazi va tunnel ishlayotganini tekshiring."
            : configured
              ? "Bu panel login va parol bilan ochiladi. Ikkalasi ham serverda hisoblab saqlanadi — hech qayerda ochiq yozilmaydi."
              : "Hali hisob qo'yilmagan. Quyida birinchi login va parolni kiriting — u bazaga hisoblangan holida saqlanadi."}
        </p>

        {phase === "form" && (
          <>
            <Field label="Login">
              <input
                ref={loginInput}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="login-error"
                minLength={3}
                maxLength={40}
                required
              />
            </Field>

            <Field label="Parol">
              <input
                ref={input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={configured ? "current-password" : "new-password"}
                aria-invalid={error ? "true" : undefined}
                aria-describedby="login-error"
                minLength={configured ? undefined : 8}
                required
              />
            </Field>

            {!configured && (
              <Field label="Parol (qayta)">
                <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" minLength={8} required />
              </Field>
            )}

            {configured && (
              <label className="check login-remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Meni eslab qol (30 kun)</span>
              </label>
            )}

            <p id="login-error" className="login-error" role="alert" aria-live="polite">
              {error}
            </p>

            <Button variant="primary" busy={busy} type="submit">
              {configured ? "Kirish" : "Hisobni yaratish"}
            </Button>
          </>
        )}

        {phase === "offline" && (
          <Button variant="primary" type="button" onClick={() => { setError(null); setRetry((n) => n + 1); setPhase("checking"); }}>
            Qayta urinish
          </Button>
        )}
        {phase === "checking" && <p className="login-hint">Server tekshirilmoqda…</p>}
      </form>
    </div>
  );
}
