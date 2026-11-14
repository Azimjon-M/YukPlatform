// Lenta: yuklar (haydovchiga) yoki bo'sh mashinalar (kind "mashina", yuk beruvchiga).
// «Menga mos» (bot yuboradiganlari) yoki «Hammasi», eng yangisi tepada. Har daqiqada o'zi yangilanadi.
// Haydovchining «Menga mos» i — tanlangan yo'nalish bo'yicha (tepada «🧭 Qayerdan → Qayerga», «O'zgartirish»).
// Yo'nalish hali tanlanmagan bo'lsa, ro'yxat o'rniga avval «📍 Qayerdan?» → «🏁 Qayerga?» (RoutePicker) — botdagidek.
// «Hammasi» da va yuk beruvchida — oddiy «📍 Qayerdan» filtri.
// «🚚 Mashinalar» (yuk beruvchi, Azimjon 2026-11-12): sozlamalarga bog'liq EMAS — nuqta XARITADAN tanlanadi
// (TruckMapPage), ro'yxat o'sha nuqtaga yaqin mashinalarni massofa bo'yicha chiqaradi (near=lat,lng&r=km).
import { useCallback, useEffect, useRef, useState } from "react";
import { REGIONS, regionLabel, routeChosen, routeLabel, scopeCountries } from "@yuk/shared";
import { getLoads, getTrucks } from "./api.js";
import { LoadCard, TruckCard } from "./LoadCard.jsx";
import { RoutePicker, hoursText } from "./RoutePicker.jsx";
import { TruckMapPage } from "./TruckMapPage.jsx";
import { Notice, Segmented, Spinner } from "./ui.jsx";

const PAGE = 30;
const REFRESH_MS = 60_000;
export const VIEW_OPTIONS = [
  { id: "mine", label: "Menga mos" },
  { id: "all", label: "Hammasi" },
];
const HOUR_OPTIONS = [6, 24, 72];

// Turga qarab: qayerdan so'raladi, kartochka va so'zlar
const KINDS = {
  yuk: {
    fetch: getLoads,
    Card: LoadCard,
    one: "yuk",
    fromLabel: "Qayerdan",
    needProfile: "«Menga mos» yuklarni ko'rsatish uchun transportingiz kerak.",
    needTitle: "Transportingizni kiriting",
  },
  mashina: {
    fetch: getTrucks,
    Card: TruckCard,
    one: "bo'sh mashina",
    fromLabel: "Qayerda",
    needProfile: "",
    needTitle: "",
    // Nuqta xaritadan tanlanadi (Sozlamalar shart emas) — TruckMapPage
    fromMap: true,
  },
};

export function areaOptions(scope) {
  return [
    ...REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) })),
    ...scopeCountries(scope).map((name) => ({ id: name, label: name })),
  ];
}

// profile — foydalanuvchining sozlamalari (me.profile); onRouteSaved(me) — yo'nalish saqlangach (App yangilaydi);
// onRouteMap(from) — yo'nalishni xaritadan tanlash (App RouteMapPage ni ochadi)
// onView null + feedNote — «⚡ Tezkor» / «📌 Mening guruhlarim»: «Menga mos» yo'q (view = "all"), tanlov o'rniga rejim qatori
export function LoadsPage({ kind = "yuk", scope, view, onView, feedNote = null, profile, onRouteSaved, onRouteMap, onNeedProfile, onAuthLost }) {
  const k = KINDS[kind];
  const [from, setFrom] = useState("");
  const [hours, setHours] = useState(24);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  const [now, setNow] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);
  // «🚚 Mashinalar»: xaritadan tanlangan nuqta ({lat,lng}) va radius (km). Nuqta bo'lmasa — oddiy ro'yxat
  const [point, setPoint] = useState(null);
  const [radius, setRadius] = useState(50);
  const shown = useRef(PAGE);
  // Yo'nalish bo'yicha ro'yxat: haydovchi, «Menga mos», sozlamalari bor
  const routed = kind === "yuk" && view === "mine" && Boolean(profile);
  // «🚚 Mashinalar» da tanlash oynasi ochiq bo'lsa ro'yxat so'ralmaydi (nuqta tanlangach qayta so'raladi)
  const choosing = routed ? picking || !routeChosen(profile) : k.fromMap && picking;
  const area = routed ? "" : from; // «Menga mos» da joyni yo'nalish belgilaydi

  // count — nechta yuk ko'rsatiladi (yangilashda ham shuncha qoladi); silent — ro'yxat o'rniga spinner chiqmasin
  const fetchLoads = useCallback(
    async (count, { silent = false } = {}) => {
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const params = { view, from: area, hours, limit: Math.min(count, 500) };
        if (point) {
          params.near = `${point.lat},${point.lng}`;
          params.r = radius;
        }
        const data = await k.fetch(params);
        shown.current = count;
        setNow(Date.now());
        setState({ items: data.items, total: data.total, loading: false, error: null });
      } catch (error) {
        if (error.code === "auth") onAuthLost();
        setState((s) => ({ ...s, loading: false, error: silent && s.items.length ? null : error }));
      }
    },
    [k, view, area, hours, point, radius, onAuthLost],
  );

  // Yo'nalish tanlanayotganda ro'yxat so'ralmaydi; tanlangach (choosing → false) yangi yo'nalish bilan so'raladi
  useEffect(() => {
    if (!choosing) fetchLoads(PAGE);
  }, [fetchLoads, choosing]);

  useEffect(() => {
    if (choosing) return undefined;
    const timer = setInterval(() => fetchLoads(shown.current, { silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchLoads, choosing]);

  const routeSaved = (me) => {
    setPicking(false);
    onRouteSaved(me);
  };

  const { items, total, loading, error } = state;
  return (
    <>
      <div className="toolbar">
        {onView ? (
          <Segmented label={kind === "mashina" ? "Qaysi mashinalar" : "Qaysi yuklar"} options={VIEW_OPTIONS} value={view} onChange={onView} />
        ) : (
          feedNote && <p className="hint feed-note">{feedNote}</p>
        )}
        {routed && !choosing && (
          <div className="route-bar">
            <span>
              🧭 <b>{routeLabel(profile)}</b>
            </span>
            <button type="button" className="link" onClick={() => setPicking(true)}>
              O'zgartirish
            </button>
          </div>
        )}
        {/* «🚚 Mashinalar»: qayer xaritadan tanlanadi (Sozlamalar shart emas) */}
        {k.fromMap && (
          <div className="route-bar">
            <span>
              {point ? (
                <>
                  📍 <b>{radius} km</b> ichida · {point.lat.toFixed(3)}, {point.lng.toFixed(3)}
                </>
              ) : (
                <span className="muted">📍 Joy tanlanmadi — butun mamlakat bo'yicha</span>
              )}
            </span>
            <button type="button" className="link" onClick={() => setPicking(true)}>
              {point ? "Joyini o'zgartirish" : "🗺 Xaritadan tanlash"}
            </button>
            {point && (
              <button type="button" className="link" onClick={() => setPoint(null)}>
                Bekor qilish
              </button>
            )}
          </div>
        )}
        <div className="filters">
          {!routed && !k.fromMap && (
            <label className="select">
              <span className="sr-only">{k.fromLabel}</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">📍 {k.fromLabel}: hamma joy</option>
                {areaOptions(scope).map((o) => (
                  <option key={o.id} value={o.id}>
                    📍 {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={`select${routed ? "" : " narrow"}`}>
            <span className="sr-only">Muddat</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {routed ? `🕒 Oxirgi ${hoursText(h)}` : hoursText(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {choosing && k.fromMap ? (
        <TruckMapPage
          point={point}
          radius={radius}
          onRadius={setRadius}
          onPick={(picked) => {
            setPoint(picked);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : choosing ? (
        <RoutePicker
          profile={profile}
          hours={hours}
          onSaved={routeSaved}
          onCancel={routeChosen(profile) ? () => setPicking(false) : null}
          onMap={onRouteMap}
          onAuthLost={onAuthLost}
        />
      ) : error?.code === "no_profile" ? (
        <Notice
          title={k.needTitle}
          action={
            <button type="button" className="primary" onClick={onNeedProfile}>
              ⚙️ Sozlamalarni to'ldirish
            </button>
          }
        >
          {k.needProfile} Hozircha «Hammasi» ni ko'rishingiz mumkin.
        </Notice>
      ) : error ? (
        <Notice
          title="Yuklar ochilmadi"
          action={
            <button type="button" className="primary" onClick={() => fetchLoads(PAGE)}>
              Qayta urinish
            </button>
          }
        >
          {error.message}
        </Notice>
      ) : loading && !items.length ? (
        <Spinner />
      ) : !items.length ? (
        <Notice
          title={`Hozircha ${k.one} yo'q`}
          action={
            (routed || point) && (
              <button type="button" className="primary" onClick={() => setPicking(true)}>
                🗺 Joyni o'zgartirish
              </button>
            )
          }
        >
          {point
            ? `Oxirgi ${hoursText(hours)}da tanlangan joydan ${radius} km ichida ${k.one} yo'q. Radiusni kattalashtiring yoki boshqa joyni bosing.`
            : routed
              ? `Oxirgi ${hoursText(hours)}da bu yo'nalishda mashinangizga mos yuk chiqmadi. Yangisi chiqishi bilan botda xabar beramiz.`
              : view === "mine"
                ? `Oxirgi ${hoursText(hours)}da sizga mos ${k.one} chiqmadi. Yangisi chiqishi bilan botda ham xabar beramiz.`
                : `Oxirgi ${hoursText(hours)}da bu yo'nalishda ${k.one} yo'q.`}
        </Notice>
      ) : (
        <>
          <p className="count">
            {total} ta {k.one}{loading && " · yangilanyapti..."}
          </p>
          <div className="loads">
            {items.map((item) => (
              <k.Card key={item.id} item={item} now={now} />
            ))}
          </div>
          {items.length < total && (
            <button type="button" className="more" disabled={loading} onClick={() => fetchLoads(items.length + PAGE)}>
              {loading ? "Yuklanyapti..." : `Yana ko'rsatish (${total - items.length})`}
            </button>
          )}
        </>
      )}
    </>
  );
}
