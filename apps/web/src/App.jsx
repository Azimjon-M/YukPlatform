// Yuk Ekspert ilovasi: Telegram Mini App va oddiy sayt — bitta kod. Bo'limlar rolga qarab:
//   haydovchi:     📋 Yuklar (menga mos — tanlangan yo'nalish bo'yicha / hammasi) · 🗺 Xarita · 🎛 Filtr (qaysi yuklar kelsin:
//                  mashina, qayerdan, guruhlar — 2026-11-27 dan botda emas, faqat shu yerda) · ⚙️ Sozlamalar (raqam, Telegram
//                  akkaunt, ilova, hisob)
//   yuk beruvchi:  📦 Yuk berish (o'z yukini haydovchilarga) · ⚙️ Sozlamalar (raqam, Telegram akkaunt, ilova, hisob).
//                  «🚚 Mashinalar» va bo'sh mashina sozlamalari yo'q (Azimjon, 2026-11-27: «biz faqat yuk e'lonlarini qidiramiz»)
// Rol tanlanmagan bo'lsa — «Siz kimsiz?» ekrani. Bot ham shu sozlamalar bo'yicha shaxsiy xabar yuboradi.
// Adminlarga qo'shimcha 🛠 Boshqaruv (botdagi «🛠 Boshqaruv» tugmasi ?v=admin bilan ochadi).
// Kirish (api.js resume): Telegram'da inline / menyu tugmasidan — o'zi (initData); botning PASTKI MENYU tugmasidan —
// bot manzilga qo'ygan token (?t=), chunki Telegram u yerda initData bermaydi; saytda — «Telegram bilan kirish».
// Birinchi marta (profil yo'q) sozlamalar qadamma-qadam ochiladi — ro'yxatdan o'tish (Steps.jsx). Server: apps/api public.js.
import { useCallback, useEffect, useRef, useState } from "react";
import { BLOCKED_TEXT, FEED_MODES, ROLES, decodeProfile, feedMode, routeLabel, sortedReady, validRole, validRouteScope } from "@yuk/shared";
import { AccountCard } from "./AccountCard.jsx";
import { TgAccounts } from "./TgAccounts.jsx";
import { AdminPage } from "./AdminPage.jsx";
import { getConfig, logout, onBlocked, resume, setActive, setRole, signOut } from "./api.js";
import { LoadFormPage } from "./LoadFormPage.jsx";
import { LoadsPage } from "./LoadsPage.jsx";
import { LoginPage } from "./LoginPage.jsx";
import { MapPage } from "./MapPage.jsx";
import { PhoneCard } from "./PhoneCard.jsx";
import { AppCard } from "./AppCard.jsx";
import { RolePage } from "./RolePage.jsx";
import { RouteMapPage } from "./RouteMapPage.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { closeApp, haptic, inTelegram, showAlert } from "./telegram.js";
import { Notice, Section, Spinner } from "./ui.jsx";

const SETTINGS_TAB = { id: "sozlamalar", icon: "⚙️", label: "Sozlamalar" };
// «🎛 Filtr» (Azimjon, 2026-11-27: «Filtr To'liq MiniApp da bo'lsin … Sozlamalar saxifasida esa Telefon raqam, Telegram
// akkount ulashish, ilova va hisob qolishi kifoya»): haydovchining ro'yxatdan o'tishi ham shu yerda (profil hali yo'q)
const FILTER_TAB = { id: "filtr", icon: "🎛", label: "Filtr" };
const LOAD_TAB = { id: "yuk", icon: "📦", label: "Yuk berish" };
const ROLE_TABS = {
  haydovchi: [{ id: "yuklar", icon: "📋", label: "Yuklar" }, { id: "xarita", icon: "🗺", label: "Xarita" }, FILTER_TAB, SETTINGS_TAB],
  yuk_beruvchi: [LOAD_TAB, SETTINGS_TAB],
};
// Rol tanlangach / sozlamalarsiz ochilganda qaysi bo'lim: yuk beruvchi — «📦 Yuk berish» (sozlamalar unga shart emas),
// haydovchi — «🎛 Filtr» (ro'yxatdan o'tish)
const startTab = (role) => (role === "yuk_beruvchi" ? LOAD_TAB.id : FILTER_TAB.id);
const ADMIN_TAB = { id: "admin", icon: "🛠", label: "Boshqaruv" };
// Rolga qarab so'zlar
const ROLE_TEXT = {
  haydovchi: { many: "yuklar", saved: "✅ Saqlandi. Mos yuklar shu yerda va botda shaxsiy xabarda." },
  yuk_beruvchi: { many: "bo'sh mashinalar", saved: "✅ Saqlandi. Mos bo'sh mashinalar shu yerda va botda shaxsiy xabarda." },
};

const params = new URLSearchParams(window.location.search);
const TAB_IDS = new Set([...Object.values(ROLE_TABS).flat(), ADMIN_TAB].map((t) => t.id));
// Bot sozlamalar tugmasida ?v=sozlamalar&r=<rol>&p=<hozirgi profil>&s=<doira> beradi
// ?v=akkaunt — botdagi /account_qosh: Sozlamalar ochilib, «📡 Telegram akkauntlarim» bo'limiga o'tadi
const tgAccountsRequest = params.get("v") === "akkaunt";
const requestedTab = TAB_IDS.has(params.get("v")) ? params.get("v") : params.has("p") || tgAccountsRequest ? "sozlamalar" : null;
let tgAccountsScrolled = false;
// Bo'lim sarlavhasi chizilganda — bir marta unga suriladi (sozlamalar formasi tepada turadi)
const scrollToTgAccounts = (el) => {
  if (!el || !tgAccountsRequest || tgAccountsScrolled) return;
  tgAccountsScrolled = true;
  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
};
// ?r= — bot bilgan rol; ?p= shu rolning profili (eski bot havolasida r= yo'q edi — u haydovchi profili)
const roleHint = validRole(params.get("r"));
const profileRole = roleHint ?? "haydovchi";
// ?v=yonalish — botdagi «🗺 Xaritadan tanlash» (yo'nalish xaritada; &f= — «Qayerga?» qadamidan, tanlangan «Qayerdan»).
// Telegram ichida saqlansa, bot chatda javob beradi (notify) va ilova yopiladi
const routeMapRequest = params.get("v") === "yonalish" ? { from: params.get("f"), notify: inTelegram } : null;
// ?v=yuk&d=1 — botdagi «✏️ Formada tuzatish»: forma botga yozilgan (hali yuborilmagan) yuk bilan to'ldiriladi
const loadDraftRequest = params.get("v") === LOAD_TAB.id && params.get("d") === "1";

// Saralanmaydigan rejimdagi haydovchiga «📋 Yuklar» tepasidagi qator
function rawFeedNote(profile) {
  const mode = FEED_MODES[feedMode(profile)];
  const how = mode.groups ? "tanlagan guruhlaringizdagi yuk e'lonlari" : "yuk e'lonlari";
  const tail = mode.vehicle ? " Mos yuklar uchun «🎛 Filtr» da transportingizni kiriting." : "";
  return `${mode.icon} ${mode.name}: ${how} botga darhol keladi. Bu yerda — hammasi.${tail}`;
}

export function App() {
  const [session, setSession] = useState({ status: "loading", me: null, error: null }); // loading | in | out | offline | signedOut | deleted | blocked
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState(requestedTab);
  const [tabPicked, setTabPicked] = useState(false); // pastki menyudan bo'lim tanlandi
  const [view, setView] = useState("mine");
  const [toast, setToast] = useState(null);
  const [offlineRole, setOfflineRole] = useState(roleHint); // server bilan aloqa yo'q paytda tanlangan rol
  const [changingRole, setChangingRole] = useState(false);
  const [busy, setBusy] = useState(false);
  // Yo'nalish xaritasi ochiqmi: { from, notify } yoki null (botdan — ?v=yonalish, «📋 Yuklar» dan — «🗺 Xaritadan tanlash»)
  const [routeMap, setRouteMap] = useState(routeMapRequest);
  // Hisobdan chiqildi yoki o'chirildi — kechikkan so'rovning 401 i o'zi qayta kirmasin (kirish yangi hisob ochardi)
  const ended = useRef(false);

  // Yo'nalish doirasi: botdan (?s=) yoki serverdan
  const scope = validRouteScope(params.get("s") ?? config?.scope);
  const me = session.me;
  const online = session.status === "in";
  const role = online ? me.role : offlineRole;

  // «⚡ Tezkor» / «📌 Mening guruhlarim» (yoki «+ saralangan», lekin mashina yo'q): «Menga mos» hisoblanmaydi (server 409
  // "feed") — ro'yxat va xarita «Hammasi» ni ko'rsatadi, tepada rejim haqida bir qator
  const rawFeed = online && role === "haydovchi" && Boolean(me.profile) && !sortedReady(me.profile);
  const shownView = rawFeed ? "all" : view;
  const viewChange = rawFeed ? null : setView;
  const feedNote = rawFeed ? rawFeedNote(me.profile) : null;

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
        if (!requestedTab) setTab(startTab(found.role));
      }
    } catch (error) {
      if (error.code === "blocked") return; // onBlocked allaqachon «Uzr...» ekranini qo'ydi
      setSession({ status: "offline", me: null, error });
    }
  }, []);

  // Boshqaruv markazidan bloklangan: istalgan so'rov 403 "blocked" qaytarsa — butun ilova o'rniga «Uzr...» ekrani.
  // Token o'chirilmaydi: blokdan chiqarilsa, keyingi ochilishda o'zi kiradi
  useEffect(
    () =>
      onBlocked(() => {
        ended.current = true;
        setSession({ status: "blocked", me: null, error: null });
      }),
    [],
  );

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

  const onNeedProfile = useCallback(() => setTab(FILTER_TAB.id), []);

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

  // Xaritada yo'nalish saqlandi (saytda; Telegram'da botdan ochilgan bo'lsa ilova o'zi yopiladi) — «📋 Yuklar» ga
  const onRouteMapDone = useCallback(
    (saved) => {
      setRouteMap(null);
      setView("mine");
      setTab("yuklar");
      onRouteSaved(saved);
      window.scrollTo(0, 0);
    },
    [onRouteSaved],
  );
  const onRouteMapCancel = useCallback(() => {
    setRouteMap(null);
    setTab("yuklar");
  }, []);
  const openRouteMap = useCallback((from) => {
    setRouteMap({ from, notify: false });
    window.scrollTo(0, 0);
  }, []);

  const onSaved = useCallback((saved) => {
    setRouteMap(null);
    setSession({ status: "in", me: saved, error: null });
    setView("mine");
    setTab(ROLE_TABS[saved.role]?.[0].id ?? "sozlamalar");
    // Saralanmaydigan rejim — yuklar botga darhol keladi (bu yerda «Menga mos» yo'q)
    const raw = saved.role === "haydovchi" && saved.profile && !sortedReady(saved.profile);
    setToast(raw ? "✅ Saqlandi. Yuk e'lonlari botga darhol keladi." : (ROLE_TEXT[saved.role]?.saved ?? "✅ Saqlandi"));
    window.scrollTo(0, 0);
  }, []);

  // Rol tanlash. Server bilan aloqa bo'lmasa — faqat shu ochilish uchun (forma botga sendData bilan rolni ham yuboradi)
  async function pickRole(id) {
    if (!online) {
      setOfflineRole(id);
      setChangingRole(false);
      setTab(startTab(id));
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
      } else if (id === "yuk_beruvchi") {
        setView("all");
        setTab(LOAD_TAB.id);
        setToast(`${ROLES[id].icon} Siz: ${ROLES[id].name}. Yukingizni shu yerda yuboring.`);
      } else {
        setView("all");
        setTab(FILTER_TAB.id);
        setToast(`${ROLES[id].icon} Siz: ${ROLES[id].name}. Endi filtrni to'ldiring.`);
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
  if (session.status === "blocked") {
    return (
      <div className="center">
        <Notice
          title={`⛔ ${BLOCKED_TEXT}`}
          action={
            inTelegram ? (
              <button type="button" className="primary" onClick={closeApp}>
                Yopish
              </button>
            ) : null
          }
        />
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
          Bot sizga boshqa hech narsa yubormaydi. Qaytadan boshlash — botda /start (boshidan ro'yxatdan o'tasiz)
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
  // Yuk berish formasi ham botga sendData bilan yubora oladi (pastki menyu tugmasidan ochilganda)
  // Haydovchida oflayn faqat «🎛 Filtr» (raqam, akkaunt, hisob — server bilan)
  // Yuk beruvchida oflayn faqat «📦 Yuk berish» (Sozlamalardagi hamma narsa server bilan)
  const offlineTabs = role === "yuk_beruvchi" ? [LOAD_TAB] : role === "haydovchi" ? [FILTER_TAB] : [SETTINGS_TAB];
  const tabs = online ? [...(ROLE_TABS[role] ?? []), ...(me.isAdmin ? [ADMIN_TAB] : [])] : offlineTabs;
  // ?p= dagi profil faqat o'sha rolniki bo'lsa (rol keyin almashtirilgan bo'lishi mumkin)
  const initialProfile = role === profileRole ? decodeProfile(params.get("p"), { scope, role }) : null;
  // Ro'yxatdan o'tmagan haydovchi (botdagi «🚚 Ro'yxatdan o'tish» ?v=sozlamalar bilan ochadi) — «🎛 Filtr» dagi qadamlarga
  const unregisteredDriver = role === "haydovchi" && !(me?.profile ?? initialProfile);
  // (faqat manzildan kelganda — pastki menyudan «⚙️ Sozlamalar» ni o'zi bossa, raqam/akkaunt ochilaveradi)
  const wanted = unregisteredDriver && !tabPicked && !tgAccountsRequest && tab === SETTINGS_TAB.id ? FILTER_TAB.id : tab;
  const current = tabs.some((t) => t.id === wanted) ? wanted : (tabs[0]?.id ?? null);
  const switchTab = (id) => {
    haptic.select();
    // Rol almashtirish oynasida pastki menyu ko'rinadi (rol tanlangan hisobda) — tab bosilsa o'sha oyna yopiladi,
    // aks holda sahifa o'zgarmas qolardi (Azimjon, 2026-11-12)
    if (changingRole) setChangingRole(false);
    setTabPicked(true);
    setTab(id);
    window.scrollTo(0, 0);
  };
  // Ro'yxatdan o'tish (qadamlar) faqat haydovchida: yuk beruvchi uchun sozlamalar ixtiyoriy va bitta sahifa
  // (Azimjon, 2026-11-12: «yuk beruvchi uchun Ro'yxatdan o'tish kerak emas — bu funksionallikni olib tashla»)
  const registering = unregisteredDriver && !changingRole && current === FILTER_TAB.id;
  // Ro'yxat / xarita / boshqaruv so'ralgan, lekin server bilan aloqa yo'q
  const listNotice =
    !online && requestedTab && !["sozlamalar", FILTER_TAB.id].includes(requestedTab) && !offlineTabs.some((t) => t.id === requestedTab) ? (
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

  // Xarita faqat transporti kiritilgan haydovchiga (aks holda — oddiy ilova: ro'yxatdan o'tish yoki rol)
  const mapOpen = Boolean(routeMap) && online && role === "haydovchi" && Boolean(me.profile) && !changingRole;

  let page;
  if (mapOpen) {
    page = (
      <RouteMapPage
        profile={me.profile}
        initialFrom={routeMap.from}
        notify={routeMap.notify}
        onDone={onRouteMapDone}
        onCancel={routeMap.notify && inTelegram ? null : onRouteMapCancel}
        onAuthLost={onAuthLost}
      />
    );
  } else if (!role || changingRole) {
    page = <RolePage current={changingRole ? role : null} busy={busy} onPick={pickRole} onCancel={changingRole ? () => setChangingRole(false) : null} />;
  } else if (current === FILTER_TAB.id) {
    // «🎛 Filtr»: rejim (hamma / tanlangan guruhlar), mashina turi, qayerdan, guruhlar (🌍 Global / 👤 Akkauntimdagi)
    page = (
      <>
        {listNotice}
        <SettingsPage key={`${me?.chatId ?? "offline"}-${role}`} me={me} initialProfile={initialProfile} scope={scope} onSaved={onSaved} roleLine={roleLine} />
      </>
    );
  } else if (current === "sozlamalar") {
    page = (
      <>
        {listNotice}
        {/* Haydovchida filtr — alohida «🎛 Filtr» bo'limida; bu yerda rol, raqam, Telegram akkaunt, ilova va hisob */}
        {/* «🔄 Rol» — to'liq bo'lim, eng tepada (Azimjon, 2026-11-27). Yuk beruvchida yo'q (2026-11-12) */}
        {role === "haydovchi" && (
          <Section title="🔄 Rol" hint="Bugun yuk kerak, ertaga yuk berasizmi — rolni almashtiring. Har rolning sozlamalari alohida saqlanadi.">
            <p className="phone-line">
              Siz: <strong>{ROLES[role].icon} {ROLES[role].name}</strong>
            </p>
            <div className="account-actions">
              <button type="button" className="secondary" onClick={() => setChangingRole(true)}>
                🔄 Rolni almashtirish
              </button>
            </div>
          </Section>
        )}
        {online && !registering && (
          <PhoneCard
            me={me}
            onChange={(updated, kind) => {
              setSession((s) => ({ ...s, me: updated }));
              setToast(kind === "deleted" ? "✅ Raqamingiz o'chirildi" : "✅ Raqamingiz saqlandi");
            }}
          />
        )}
        {/* Telegram akkauntini collector'ga ulash — istalgan foydalanuvchi, faqat o'zinikilari (Azimjon, 2026-11-13:
            «adminlik bermasdan shunchaki sozlamalar ichiga qo'shib ber») */}
        {/* Alohida karta (2026-11-19, Azimjon: «Telefon Raqam sectionidan uzib alohida qil» — sarlavha kulrang yozuv edi) */}
        {online && !registering && (
          <section className="section tg-section" id="tg-akkauntlar" ref={scrollToTgAccounts}>
            <h2>📡 Telegram akkaunt ulash</h2>
            <p className="hint">Telegram akkauntingizni ulang — «🔎 Auto scan» undagi yuk guruhlarini topadi, Filtrda «👤 Akkauntimdagi» bo'limida ko'rinadi. Ulash bepul; yopiq guruhlaringizdagi e'lonlar ⭐ Pro obunada keladi.</p>
            <TgAccounts mine onAuthLost={onAuthLost} />
          </section>
        )}
        {/* Android ilovani yuklab olish (AppCard.jsx; APK bo'lmasa — ko'rinmaydi) */}
        {online && !registering && <AppCard />}
        {online && !registering && <AccountCard me={me} onSignedOut={onSignedOut} onDeleted={onDeleted} />}
      </>
    );
  } else if (current === LOAD_TAB.id) {
    page = (
      <>
        <LoadFormPage key={`${me?.chatId ?? "offline"}-yuk`} me={me} scope={scope} draft={loadDraftRequest} onAuthLost={onAuthLost} />
        {/* Azimjon, 2026-11-12: yuk berish formasi pastida «Siz: ... Rolni almashtirish» qatori kerak emas */}
      </>
    );
  } else if (current === "admin") {
    page = <AdminPage onAuthLost={onAuthLost} />;
  } else if (current === "xarita") {
    page = <MapPage view={shownView} onView={viewChange} feedNote={feedNote} onNeedProfile={onNeedProfile} onAuthLost={onAuthLost} />;
  } else {
    page = (
      <LoadsPage
        key={current}
        kind="yuk"
        scope={scope}
        view={shownView}
        onView={viewChange}
        feedNote={feedNote}
        profile={me?.profile ?? null}
        onRouteSaved={onRouteSaved}
        onRouteMap={openRouteMap}
        onNeedProfile={onNeedProfile}
        onAuthLost={onAuthLost}
      />
    );
  }

  // Pastki menyu sozlamalar (birinchi qadam) da ham ko'rinadi — menyu yo'qolib qolsa orqaga qaytib bo'lmaydi
  // (Azimjon, 2026-11-12: «Sozlamalarga o'tsam pastgi menyu yo'q bo'lib qolmoqda»).
  // Rol almashtirish oynasida ham MENYU BOR (Azimjon, 2026-11-12: «rol tanlansa pastgi menu va btn bor bo'lsin» —
  // pastki menyu FAQAT rol tanlanmagan hisobda yo'q). Rol tanlangan odam oynani yopmasdan ham boshqa bo'limga
  // o'ta oladi: switchTab changingRole ni o'chiradi.
  const showTabs = online && role && !mapOpen;
  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>🚛 Yuk Ekspert</h1>
          {me?.name && <p>{me.name}</p>}
        </div>
        <div className="top-actions">
          {/* Pauza — yuk qidirishni to'xtatish: bu FAQAT haydovchi sozlamasi (Azimjon, 2026-11-12: «pauza/davom
              etish va «➕ Guruh qo'shish» faqat haydovchi roli uchun»). Yuk beruvchi yukni o'zi yuboradi —
              pauza unga kerak emas */}
          {me?.profile && role === "haydovchi" && (
            <button type="button" className={`pill${me.active ? "" : " paused"}`} onClick={toggleActive} title="Botdagi shaxsiy xabarlar">
              {me.active ? "⏸ Pauza" : "▶️ Yoqish"}
            </button>
          )}
          {/* «Chiqish» FAQAT pastki menyu yo'q bo'lgan holatlarda: rol tanlanmagan yoki ro'yxatdan o'tish bosqichida.
              Rol tanlangan odamda (almashtirish oynasi dahil) pastki menyu bor — u yerdan bo'limga o'tadi
              (Azimjon, 2026-11-12: «rol tanlansa pastgi menu va btn bor bo'lsin») */}
          {!inTelegram && (!role || registering) && (
            <button type="button" className="pill ghost" onClick={headerLogout}>
              Chiqish
            </button>
          )}
        </div>
      </header>

      <main>
        {me && !me.active && me.profile && role === "haydovchi" && showTabs && !["sozlamalar", FILTER_TAB.id, "admin", LOAD_TAB.id].includes(current) && (
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
