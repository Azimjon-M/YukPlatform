// Haydovchilar ilovasi: Telegram Mini App va oddiy sayt — bitta kod.
//   📋 Yuklar     — menga mos / hammasi, bosib qo'ng'iroq
//   🗺 Xarita     — qayerda yuk ko'p, qayerga boradi
//   ⚙️ Sozlamalar — mashina va yo'nalish (bot ham shu sozlamalar bo'yicha yuboradi)
// Kirish: Telegram ichida — o'zi (initData), saytda — «Telegram bilan kirish». Server: apps/api public.js.
import { useCallback, useEffect, useState } from "react";
import { decodeProfile, validRouteScope } from "@yuk/shared";
import { getConfig, logout, resume, setActive } from "./api.js";
import { LoadsPage } from "./LoadsPage.jsx";
import { LoginPage } from "./LoginPage.jsx";
import { MapPage } from "./MapPage.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { haptic, inTelegram, showAlert } from "./telegram.js";
import { Notice, Spinner } from "./ui.jsx";

const TABS = [
  { id: "yuklar", icon: "📋", label: "Yuklar" },
  { id: "xarita", icon: "🗺", label: "Xarita" },
  { id: "sozlamalar", icon: "⚙️", label: "Sozlamalar" },
];

const params = new URLSearchParams(window.location.search);
// Bot sozlamalar tugmasida ?v=sozlamalar&p=<hozirgi profil>&s=<doira> beradi
const requestedTab = TABS.some((t) => t.id === params.get("v")) ? params.get("v") : params.has("p") ? "sozlamalar" : null;

export function App() {
  const [session, setSession] = useState({ status: "loading", me: null, error: null }); // loading | in | out | offline
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState(requestedTab ?? "yuklar");
  const [view, setView] = useState("mine");
  const [toast, setToast] = useState(null);

  // Yo'nalish doirasi: botdan (?s=) yoki serverdan
  const scope = validRouteScope(params.get("s") ?? config?.scope);
  const me = session.me;

  const connect = useCallback(async () => {
    setSession({ status: "loading", me: null, error: null });
    try {
      const { me: found } = await resume();
      if (!found) {
        setSession({ status: "out", me: null, error: null });
        return;
      }
      setSession({ status: "in", me: found, error: null });
      if (!found.profile) {
        setView("all");
        if (!requestedTab) setTab("sozlamalar");
      }
    } catch (error) {
      setSession({ status: "offline", me: null, error });
    }
  }, []);

  useEffect(() => {
    connect();
    getConfig()
      .then(setConfig)
      .catch(() => setConfig({}));
    // Sahifa ochiq turganda boshqa haydovchi havolasi (#token=...) ochilsa — o'sha bilan qayta kiramiz
    const onHash = () => /token=/.test(window.location.hash) && connect();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [connect]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Token eskirdi: Telegram ichida qayta kiramiz, saytda — kirish sahifasi
  const onAuthLost = useCallback(() => {
    logout();
    if (inTelegram) connect();
    else setSession({ status: "out", me: null, error: null });
  }, [connect]);

  const onNeedProfile = useCallback(() => setTab("sozlamalar"), []);

  const onSaved = useCallback((saved) => {
    setSession({ status: "in", me: saved, error: null });
    setView("mine");
    setTab("yuklar");
    setToast("✅ Saqlandi. Mos yuklar shu yerda va botda shaxsiy xabarda.");
    window.scrollTo(0, 0);
  }, []);

  async function toggleActive() {
    try {
      const updated = await setActive(!me.active);
      haptic.success();
      setSession((s) => ({ ...s, me: updated }));
      setToast(updated.active ? "▶️ Botda yuk yuborish yoqildi" : "⏸ Botda yuk yuborish to'xtatildi");
    } catch (error) {
      showAlert(error.message);
    }
  }

  if (session.status === "loading") {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }
  if (session.status === "out") {
    return <LoginPage config={config} onLogin={(found) => setSession({ status: "in", me: found, error: null })} />;
  }
  // Saytda server bilan aloqa yo'q — faqat qayta urinish. Telegram ichida sozlamalar botga sendData bilan saqlanadi.
  if (session.status === "offline" && !inTelegram) {
    return (
      <div className="center">
        <Notice
          title="Server bilan aloqa yo'q"
          action={
            <button type="button" className="primary" onClick={connect}>
              Qayta urinish
            </button>
          }
        >
          {session.error?.message}
        </Notice>
      </div>
    );
  }

  const online = session.status === "in";
  const switchTab = (id) => {
    haptic.select();
    setTab(id);
    window.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>🚛 Yuk Ekspert</h1>
          {me?.name && <p>{me.name}</p>}
        </div>
        <div className="top-actions">
          {me?.profile && (
            <button type="button" className={`pill${me.active ? "" : " paused"}`} onClick={toggleActive} title="Botdagi shaxsiy xabarlar">
              {me.active ? "⏸ Pauza" : "▶️ Yoqish"}
            </button>
          )}
          {!inTelegram && (
            <button
              type="button"
              className="pill ghost"
              onClick={() => {
                logout();
                setSession({ status: "out", me: null, error: null });
              }}
            >
              Chiqish
            </button>
          )}
        </div>
      </header>

      <main>
        {me && !me.active && me.profile && tab !== "sozlamalar" && (
          <div className="notice">⏸ Pauzadasiz: botga yangi yuklar kelmaydi. Bu yerda ko'rish mumkin.</div>
        )}
        {tab === "sozlamalar" ? (
          <SettingsPage key={me?.chatId ?? "offline"} me={me} initialProfile={decodeProfile(params.get("p"), { scope })} scope={scope} onSaved={onSaved} />
        ) : !online ? (
          <Notice
            title="Server bilan aloqa yo'q"
            action={
              <button type="button" className="primary" onClick={connect}>
                Qayta urinish
              </button>
            }
          >
            Yuklar ro'yxati hozir ochilmaydi. Sozlamalarni baribir o'zgartirishingiz mumkin — ular botga yuboriladi.
          </Notice>
        ) : tab === "xarita" ? (
          <MapPage view={view} onView={setView} onNeedProfile={onNeedProfile} onAuthLost={onAuthLost} />
        ) : (
          <LoadsPage scope={scope} view={view} onView={setView} onNeedProfile={onNeedProfile} onAuthLost={onAuthLost} />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <nav className="tabs" aria-label="Bo'limlar">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => switchTab(t.id)}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
