// Saytga kirish (oddiy brauzerda). Telegram ichida bu sahifa chiqmaydi — u yerda kirish o'zi bo'ladi.
// «Telegram bilan kirish» vidjeti faqat BotFather'da /setdomain bilan ko'rsatilgan domenda ishlaydi (README).
import { useEffect, useRef, useState } from "react";
import { login } from "./api.js";
import { Spinner } from "./ui.jsx";

function TelegramLoginButton({ botUsername, onAuth }) {
  const box = useRef(null);
  useEffect(() => {
    if (!botUsername || !box.current) return undefined;
    // Vidjet foydalanuvchi ma'lumotini shu global funksiyaga beradi (Telegram imzosi bilan; server tekshiradi)
    window.onTelegramAuth = (user) => onAuth(user);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = "large";
    script.dataset.radius = "12";
    script.dataset.requestAccess = "write"; // bot keyin shaxsiy xabarda yuk yubora olishi uchun
    script.dataset.onauth = "onTelegramAuth(user)";
    box.current.replaceChildren(script);
    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername, onAuth]);
  return <div ref={box} className="tg-login" />;
}

export function LoginPage({ config, onLogin }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bot = config?.botUsername;

  async function auth(widget) {
    setBusy(true);
    setError(null);
    try {
      onLogin(await login({ widget }));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>🚛 Yuk Ekspert</h1>
        <p>Katta yuk guruhlaridan faqat sizning mashinangiz va yo'nalishingizga mos yuklar — bir joyda, xaritada, bosib qo'ng'iroq qilasiz.</p>
        {config === null ? (
          <Spinner />
        ) : bot ? (
          <>
            <p className="muted small">Kirish uchun Telegram akkauntingizni tasdiqlang (parol kerak emas):</p>
            {busy ? <Spinner label="Kirilyapti..." /> : <TelegramLoginButton botUsername={bot} onAuth={auth} />}
            <p className="muted small">
              Yoki Telegram ichida oching:{" "}
              <a href={`https://t.me/${bot}`} target="_blank" rel="noopener noreferrer">
                @{bot}
              </a>{" "}
              → pastki menyu.
            </p>
          </>
        ) : (
          <p className="muted">Kirish hozircha ishlamayapti: bot hali bir marta ham ishga tushirilmagan. Birozdan keyin urinib ko'ring.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
