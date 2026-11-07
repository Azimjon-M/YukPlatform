// Saytga kirish (oddiy brauzerda). Telegram ichida bu sahifa HECH QACHON chiqmaydi (App.jsx): u yerda kirish o'zi bo'ladi
// (initData yoki bot tugmasidagi ?t= token), bo'lmasa — sozlamalar botga sendData bilan saqlanadi.
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
        <p className="lead">Katta yuk guruhlaridagi e'lonlardan faqat sizning mashinangiz va yo'nalishingizga moslari — bir joyda, xaritada, bosib qo'ng'iroq qilasiz.</p>
        {config === null ? (
          <Spinner />
        ) : bot ? (
          <>
            {/* Asosiy yo'l — bot: Telegram ichida kirish o'zi bo'ladi, domen sozlamasiga bog'liq emas */}
            <ol className="login-steps">
              <li>
                <b>1</b>
                <span>Botni oching va kim ekaningizni tanlang: haydovchi yoki yuk beruvchi</span>
              </li>
              <li>
                <b>2</b>
                <span>Pastdagi «🚚 Ro'yxatdan o'tish» tugmasi — 1 daqiqalik forma</span>
              </li>
              <li>
                <b>3</b>
                <span>Mos e'lonlar botga shaxsiy xabar bo'lib keladi</span>
              </li>
            </ol>
            <a className="primary wide" href={`https://t.me/${bot}?start=web`} target="_blank" rel="noopener noreferrer">
              📲 Telegram'da ochish
            </a>
            <div className="login-or">yoki shu saytga kiring</div>
            {busy ? <Spinner label="Kirilyapti..." /> : <TelegramLoginButton botUsername={bot} onAuth={auth} />}
            {/* Vidjet faqat BotFather'da /setdomain bilan ko'rsatilgan manzilda ishlaydi, tunnel manzili esa o'zgarib turadi */}
            <p className="muted small">Kirish tugmasi o'rniga xato chiqsa («Bot domain invalid») — yuqoridagi tugma bilan Telegram'da oching.</p>
          </>
        ) : (
          <p className="muted">Kirish hozircha ishlamayapti: bot hali bir marta ham ishga tushirilmagan. Birozdan keyin urinib ko'ring.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
