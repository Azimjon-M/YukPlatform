// Yuk Ekspert ilovasi: Telegram Mini App va oddiy sayt — bitta kod. Bo'limlar rolga qarab:
//   haydovchi:     📋 Yuklar (menga mos — tanlangan yo'nalish bo'yicha / hammasi) · 🗺 Xarita · ⚙️ Sozlamalar (transport)
//   yuk beruvchi:  🚚 Mashinalar (bo'sh mashinalar) · ⚙️ Sozlamalar (yo'nalish va kerakli mashina)
// Rol tanlanmagan bo'lsa — «Siz kimsiz?» ekrani. Bot ham shu sozlamalar bo'yicha shaxsiy xabar yuboradi.
// Adminlarga qo'shimcha 🛠 Boshqaruv (botdagi «🛠 Boshqaruv» tugmasi ?v=admin bilan ochadi).
// Kirish (api.js resume): Telegram'da inline / menyu tugmasidan — o'zi (initData); botning PASTKI MENYU tugmasidan —
// bot manzilga qo'ygan token (?t=), chunki Telegram u yerda initData bermaydi; saytda — «Telegram bilan kirish».
// Birinchi marta (profil yo'q) sozlamalar qadamma-qadam ochiladi — ro'yxatdan o'tish (Steps.jsx). Server: apps/api public.js.
import { useCallback, useEffect, useRef, useState } from "react";
import { ROLES, decodeProfile, routeLabel, validRole, validRouteScope } from "@yuk/shared";
import { AccountCard } from "./AccountCard.jsx";
import { AdminPage } from "./AdminPage.jsx";
import { getConfig, logout, resume, setActive, setRole, signOut } from "./api.js";
import { LoadsPage } from "./LoadsPage.jsx";
import { LoginPage } from "./LoginPage.jsx";
import { MapPage } from "./MapPage.jsx";
import { PhoneCard } from "./PhoneCard.jsx";
import { RolePage } from "./RolePage.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { ShipperSettings } from "./ShipperSettings.jsx";
import { closeApp, haptic, inTelegram, showAlert } from "./telegram.js";
import { Notice, Spinner } from "./ui.jsx";

const SETTINGS_TAB = { id: "sozlamalar", icon: "⚙️", label: "Sozlamalar" };
const ROLE_TABS = {
  haydovchi: [{ id: "yuklar", icon: "📋", label: "Yuklar" }, { id: "xarita", icon: "🗺", label: "Xarita" }, SETTINGS_TAB],
  yuk_beruvchi: [{ id: "mashinalar", icon: "🚚", label: "Mashinalar" }, SETTINGS_TAB],
};
const ADMIN_TAB = { id: "admin", icon: "🛠", label: "Boshqaruv" };
// Rolga qarab so'zlar
const ROLE_TEXT = {
  haydovchi: { many: "yuklar", saved: "✅ Saqlandi. Mos yuklar shu yerda va botda shaxsiy xabarda." },
  yuk_beruvchi: { many: "bo'sh mashinalar", saved: "✅ Saqlandi. Mos bo'sh mashinalar shu yerda va botda shaxsiy xabarda." },
};

const params = new URLSearchParams(window.location.search);
const TAB_IDS = new Set([...Object.values(ROLE_TABS).flat(), ADMIN_TAB].map((t) => t.id));
// Bot sozlamalar tugmasida ?v=sozlamalar&r=<rol>&p=<hozirgi profil>&s=<doira> beradi
const requestedTab = TAB_IDS.has(params.get("v")) ? params.get("v") : params.has("p") ? "sozlamalar" : null;
// ?r= — bot bilgan rol; ?p= shu rolning profili (eski bot havolasida r= yo'q edi — u haydovchi profili)
const roleHint = validRole(params.get("r"));
const profileRole = roleHint ?? "haydovchi";

export function App() {
  const [session, setSession] = useState({ status: "loading", me: null, error: null }); // loading | in | out | offline | signedOut | deleted
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState(requestedTab);
  const [view, setView] = useState("mine");
  const [toast, setToast] = useState(null);
  const [offlineRole, setOfflineRole] = useState(roleHint); // server bilan aloqa yo'q paytda tanlangan rol
  const [changingRole, setChangingRole] = useState(false);
  const [busy, setBusy] = useState(false);
  // Hisobdan chiqildi yoki o'chirildi — kechikkan so'rovning 401 i o'zi qayta kirmasin (kirish yangi hisob ochardi)
  const ended = useRef(false);

  // Yo'nalish doirasi: botdan (?s=) yoki serverdan
  const scope = validRouteScope(params.get("s") ?? config?.scope);
  const me = session.me;
  const online = session.status === "in";
  const role = online ? me.role : offlineRole;

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
    // Sahifa ochiq turganda boshqa foydalanuvchi havolasi (#token=...) ochilsa — o'sha bilan qayta kiramiz
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
    if (ended.current) return;
    logout();
    if (inTelegram) connect();
    else setSession({ status: "out", me: null, error: null });
  }, [connect]);

  const onNeedProfile = useCallback(() => setTab("sozlamalar"), []);

  // «🚪 Chiqish» dan keyin (server hisobdan chiqardi — store.signOut): «Hisobdan chiqdingiz» ekrani.
  // Saytda token ham o'chadi (qaytish — kirish sahifasi). Telegram'da token qoladi: «Qayta kirish» → «Siz kimsiz?»,
  // rolni tanlasa sozlamalari tiklanadi (u yerda kirish baribir o'zi bo'ladi)
  const onSignedOut = useCallback((user) => {
    ended.current = true;
    if (!inTelegram) logout();
    setSession({ status: "signedOut", me: user, error: null });
  }, []);

  // Saytda rol tanlash / ro'yxatdan o'tish paytidagi tepadagi «Chiqish» (Sozlamalardagi «Hisob» u paytda ko'rinmaydi)
  async function headerLogout() {
    try {
      onSignedOut(await signOut());
    } catch (error) {
      showAlert(error.message);
    }
  }

  // «🗑 Hisobni o'chirish» dan keyin: qayta kirmaymiz (kirish yangi, bo'sh hisob ochadi) — faqat «o'chirildi» ekrani
  const onDeleted = useCallback(() => {
    ended.current = true;
    logout();
    setSession({ status: "deleted", me: null, error: null });
  }, []);

  // «📋 Yuklar» da yo'nalish tanlandi — bot ham yangi yuklarni shu bo'yicha yuboradi
  const onRouteSaved = useCallback((saved) => {
    setSession({ status: "in", me: saved, error: null });
    setToast(`🧭 Yo'nalish: ${routeLabel(saved.profile)}. Bot ham shu bo'yicha yuboradi.`);
  }, []);

  const onSaved = useCallback((saved) => {
    setSession({ status: "in", me: saved, error: null });
    setView("mine");
    setTab(ROLE_TABS[saved.role]?.[0].id ?? "sozlamalar");
    setToast(ROLE_TEXT[saved.role]?.saved ?? "✅ Saqlandi");
    window.scrollTo(0, 0);
  }, []);

  // Rol tanlash. Server bilan aloqa bo'lmasa — faqat shu ochilish uchun (forma botga sendData bilan rolni ham yuboradi)
  async function pickRole(id) {
    if (!online) {
      setOfflineRole(id);
      setChangingRole(false);
      setTab("sozlamalar");
      return;
    }
    if (me.role === id) {
      setChangingRole(false);
      return;
    }
    setBusy(true);
    try {
      const updated = await setRole(id);
      haptic.success();
      setSession((s) => ({ ...s, me: updated }));
      setChangingRole(false);
      if (updated.profile) {
        // Bu rolda avval to'ldirgan — sozlamalari tiklandi, darhol ro'yxatga
        setView("mine");
        setTab(ROLE_TABS[id][0].id);
        setToast(`${ROLES[id].icon} Siz: ${ROLES[id].name}. Oldingi sozlamalaringiz tiklandi.`);
      } else {
        setView("all");
        setTab("sozlamalar");
        setToast(`${ROLES[id].icon} Siz: ${ROLES[id].name}. Endi sozlamalarni to'ldiring.`);
      }
      window.scrollTo(0, 0);
    } catch (error) {
      if (error.code === "auth") onAuthLost();
      else showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    try {
      const updated = await setActive(!me.active);
      haptic.success();
      setSession((s) => ({ ...s, me: updated }));
      setToast(updated.active ? "▶️ Botda yuborish yoqildi" : "⏸ Botda yuborish to'xtatildi");
    } catch (error) {
      showAlert(error.message);
    }
  }

  if (session.status === "signedOut") {
    const again = () => {
      ended.current = false;
      if (inTelegram) {
        setChangingRole(false);
        setSession({ status: "in", me: session.me, error: null }); // rol yo'q → «Siz kimsiz?»
      } else setSession({ status: "out", me: null, error: null });
    };
    return (
      <div className="center">
        <Notice
          title="🚪 Hisobdan chiqdingiz"
          action={
            <div className="notice-actions">
              <button type="button" className="primary" onClick={again}>
                🚚 Qayta kirish
              </button>
              {inTelegram && (
                <button type="button" className="secondary" onClick={closeApp}>
                  Yopish
                </button>
              )}
            </div>
          }
        >
          Bot sizga endi yuk yubormaydi. Ma'lumotlaringiz saqlanib qoldi: qayta kirib rolingizni tanlasangiz, sozlamalaringiz
          tiklanadi.
        </Notice>
      </div>
    );
  }
  if (session.status === "deleted") {
    return (
      <div className="center">
        <Notice
          title="✅ Hisobingiz o'chirildi"
          action={
            inTelegram ? (
              <button type="button" className="primary" onClick={closeApp}>
                Yopish
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  ended.current = false;
                  setSession({ status: "out", me: null, error: null });
                }}
              >
                Kirish sahifasiga
              </button>
            )
          }
        >
          Ma'lumotlaringiz o'chirildi, bot sizga boshqa hech narsa yubormaydi. Qaytadan boshlash — botda /start
          {inTelegram ? "." : " yoki «Telegram bilan kirish»."}
        </Notice>
      </div>
    );
  }
  if (session.status === "loading") {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }
  // Kirish sahifasi faqat saytda. Telegram ichida «Telegram bilan kirish» vidjeti ishlamaydi («Bot domain invalid») —
  // u yerda kirib bo'lmasa ham sozlamalar ochiladi va botga sendData bilan saqlanadi.
  if (session.status === "out" && !inTelegram) {
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

  // Server bilan aloqa yo'q (yoki Telegram ichida kirib bo'lmadi) — faqat sozlamalar: ular botga sendData bilan ketadi.
  // Admin bo'limi faqat server bilan aloqa bo'lsa (ma'lumot serverdan, huquq ham serverda tekshiriladi)
  const tabs = online ? [...(ROLE_TABS[role] ?? []), ...(me.isAdmin ? [ADMIN_TAB] : [])] : [SETTINGS_TAB];
  const current = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? null);
  const switchTab = (id) => {
    haptic.select();
    setTab(id);
    window.scrollTo(0, 0);
  };
  // ?p= dagi profil faqat o'sha rolniki bo'lsa (rol keyin almashtirilgan bo'lishi mumkin)
  const initialProfile = role === profileRole ? decodeProfile(params.get("p"), { scope, role }) : null;
  // Ro'yxatdan o'tish (profil hali yo'q): qadamlar, pastdagi bo'limlar yashiriladi — chalg'itmasin
  const registering = Boolean(role) && !changingRole && current === "sozlamalar" && !(me?.profile ?? initialProfile);
  // Ro'yxat / xarita / boshqaruv so'ralgan, lekin server bilan aloqa yo'q
  const listNotice =
    !online && requestedTab && requestedTab !== "sozlamalar" ? (
      <div className="notice">
        {session.status === "offline"
          ? "Server bilan aloqa yo'q — ro'yxat hozir ochilmaydi. Sozlamalarni baribir saqlashingiz mumkin: ular botga yuboriladi."
          : "Ro'yxat ochilmadi: botdagi tugma eskirgan. Botga /start yuboring — pastki menyu yangilanadi, keyin qayta oching."}
      </div>
    ) : null;
  const roleLine = role ? (
    <div className="role-switch">
      <span>
        Siz: {ROLES[role].icon} {ROLES[role].name}
      </span>
      <button type="button" className="link" onClick={() => setChangingRole(true)}>
        Rolni almashtirish
      </button>
    </div>
  ) : null;

  let page;
  if (!role || changingRole) {
    page = <RolePage current={changingRole ? role : null} busy={busy} onPick={pickRole} onCancel={changingRole ? () => setChangingRole(false) : null} />;
  } else if (current === "sozlamalar") {
    const settingsKey = `${me?.chatId ?? "offline"}-${role}`;
    const settingsProps = { me, initialProfile, scope, onSaved, roleLine };
    page = (
      <>
        {listNotice}
        {role === "yuk_beruvchi" ? <ShipperSettings key={settingsKey} {...settingsProps} /> : <SettingsPage key={settingsKey} {...settingsProps} />}
        {online && !registering && (
          <PhoneCard
            me={me}
            onChange={(updated) => {
              setSession((s) => ({ ...s, me: updated }));
              setToast("✅ Raqamingiz saqlandi");
            }}
          />
        )}
        {!registering && roleLine}
        {online && !registering && <AccountCard me={me} onSignedOut={onSignedOut} onDeleted={onDeleted} />}
      </>
    );
  } else if (current === "admin") {
    page = <AdminPage onAuthLost={onAuthLost} />;
  } else if (current === "xarita") {
    page = <MapPage view={view} onView={setView} onNeedProfile={onNeedProfile} onAuthLost={onAuthLost} />;
  } else {
    page = (
      <LoadsPage
        key={current}
        kind={current === "mashinalar" ? "mashina" : "yuk"}
        scope={scope}
        view={view}
        onView={setView}
        profile={me?.profile ?? null}
        onRouteSaved={onRouteSaved}
        onNeedProfile={onNeedProfile}
        onAuthLost={onAuthLost}
      />
    );
  }

  const showTabs = online && role && !changingRole && !registering;
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
          {!inTelegram && (!role || changingRole || registering) && (
            <button type="button" className="pill ghost" onClick={headerLogout}>
              Chiqish
            </button>
          )}
        </div>
      </header>

      <main>
        {me && !me.active && me.profile && showTabs && current !== "sozlamalar" && current !== "admin" && (
          <div className="notice">⏸ Pauzadasiz: botga yangi {ROLE_TEXT[role].many} kelmaydi. Bu yerda ko'rish mumkin.</div>
        )}
        {page}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {showTabs && (
        <nav className="tabs" aria-label="Bo'limlar">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={current === t.id ? "on" : ""} aria-current={current === t.id ? "page" : undefined} onClick={() => switchTab(t.id)}>
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
