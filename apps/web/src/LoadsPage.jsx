// Lenta: yuklar (haydovchiga) yoki bo'sh mashinalar (kind "mashina", yuk beruvchiga).
// «Menga mos» (bot yuboradiganlari) yoki «Hammasi», qayerdan filtri, eng yangisi tepada. Har daqiqada o'zi yangilanadi.
import { useCallback, useEffect, useRef, useState } from "react";
import { REGIONS, regionLabel, scopeCountries } from "@yuk/shared";
import { getLoads, getTrucks } from "./api.js";
import { LoadCard, TruckCard } from "./LoadCard.jsx";
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
    needProfile: "«Menga mos» yuklarni ko'rsatish uchun mashina turi va yo'nalishingiz kerak.",
    needTitle: "Mashinangizni kiriting",
  },
  mashina: {
    fetch: getTrucks,
    Card: TruckCard,
    one: "bo'sh mashina",
    fromLabel: "Qayerda",
    needProfile: "«Menga mos» mashinalarni ko'rsatish uchun yukingiz qayerdan qayerga borishi kerak.",
    needTitle: "Yo'nalishingizni kiriting",
  },
};

export function areaOptions(scope) {
  return [
    ...REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) })),
    ...scopeCountries(scope).map((name) => ({ id: name, label: name })),
  ];
}

export function LoadsPage({ kind = "yuk", scope, view, onView, onNeedProfile, onAuthLost }) {
  const k = KINDS[kind];
  const [from, setFrom] = useState("");
  const [hours, setHours] = useState(24);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef(PAGE);

  // count — nechta yuk ko'rsatiladi (yangilashda ham shuncha qoladi); silent — ro'yxat o'rniga spinner chiqmasin
  const fetchLoads = useCallback(
    async (count, { silent = false } = {}) => {
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await k.fetch({ view, from, hours, limit: Math.min(count, 500) });
        shown.current = count;
        setNow(Date.now());
        setState({ items: data.items, total: data.total, loading: false, error: null });
      } catch (error) {
        if (error.code === "auth") onAuthLost();
        setState((s) => ({ ...s, loading: false, error: silent && s.items.length ? null : error }));
      }
    },
    [k, view, from, hours, onAuthLost],
  );

  useEffect(() => {
    fetchLoads(PAGE);
  }, [fetchLoads]);

  useEffect(() => {
    const timer = setInterval(() => fetchLoads(shown.current, { silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchLoads]);

  const { items, total, loading, error } = state;
  return (
    <>
      <div className="toolbar">
        <Segmented label={kind === "mashina" ? "Qaysi mashinalar" : "Qaysi yuklar"} options={VIEW_OPTIONS} value={view} onChange={onView} />
        <div className="filters">
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
          <label className="select narrow">
            <span className="sr-only">Muddat</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h === 72 ? "3 kun" : `${h} soat`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error?.code === "no_profile" ? (
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
        <Notice title={`Hozircha ${k.one} yo'q`}>
          {view === "mine"
            ? `Oxirgi ${hours} soatda sizga mos ${k.one} chiqmadi. Yangisi chiqishi bilan botda ham xabar beramiz.`
            : `Oxirgi ${hours} soatda bu yo'nalishda ${k.one} yo'q.`}
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
