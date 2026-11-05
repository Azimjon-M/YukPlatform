// Yuklar lentasi: «Menga mos» (bot yuboradiganlari) yoki «Hammasi», qayerdan filtri, eng yangisi tepada.
// Har daqiqada o'zi yangilanadi.
import { useCallback, useEffect, useRef, useState } from "react";
import { REGIONS, regionLabel, scopeCountries } from "@yuk/shared";
import { getLoads } from "./api.js";
import { LoadCard } from "./LoadCard.jsx";
import { Notice, Segmented, Spinner } from "./ui.jsx";

const PAGE = 30;
const REFRESH_MS = 60_000;
export const VIEW_OPTIONS = [
  { id: "mine", label: "Menga mos" },
  { id: "all", label: "Hammasi" },
];
const HOUR_OPTIONS = [6, 24, 72];

export function areaOptions(scope) {
  return [
    ...REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) })),
    ...scopeCountries(scope).map((name) => ({ id: name, label: name })),
  ];
}

export function LoadsPage({ scope, view, onView, onNeedProfile, onAuthLost }) {
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
        const data = await getLoads({ view, from, hours, limit: Math.min(count, 500) });
        shown.current = count;
        setNow(Date.now());
        setState({ items: data.items, total: data.total, loading: false, error: null });
      } catch (error) {
        if (error.code === "auth") onAuthLost();
        setState((s) => ({ ...s, loading: false, error: silent && s.items.length ? null : error }));
      }
    },
    [view, from, hours, onAuthLost],
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
        <Segmented label="Qaysi yuklar" options={VIEW_OPTIONS} value={view} onChange={onView} />
        <div className="filters">
          <label className="select">
            <span className="sr-only">Qayerdan</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">📍 Qayerdan: hamma joy</option>
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
          title="Mashinangizni kiriting"
          action={
            <button type="button" className="primary" onClick={onNeedProfile}>
              ⚙️ Sozlamalarni to'ldirish
            </button>
          }
        >
          «Menga mos» yuklarni ko'rsatish uchun mashina turi va yo'nalishingiz kerak. Hozircha «Hammasi» ni ko'rishingiz mumkin.
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
        <Notice title="Hozircha yuk yo'q">
          {view === "mine"
            ? `Oxirgi ${hours} soatda sizga mos yuk chiqmadi. Yangisi chiqishi bilan botda ham xabar beramiz.`
            : `Oxirgi ${hours} soatda bu yo'nalishda yuk yo'q.`}
        </Notice>
      ) : (
        <>
          <p className="count">
            {total} ta yuk{loading && " · yangilanyapti..."}
          </p>
          <div className="loads">
            {items.map((item) => (
              <LoadCard key={item.id} item={item} now={now} />
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
