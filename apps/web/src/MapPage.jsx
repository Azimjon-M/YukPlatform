// Xarita: qayerda yuk ko'p. Har bir doira — bitta shahar (uzuq chiziqli — faqat viloyat yoki davlat yozilgan).
// Doira bosilsa: o'sha joydagi yuklar pastda ro'yxat bo'lib chiqadi va ular qayerga borishi chiziq bilan ko'rsatiladi.
// Xarita: Leaflet + OpenStreetMap (bepul; ko'p foydalanuvchida boshqa tile xizmatiga o'tish kerak bo'ladi — README).
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { placePoint } from "@yuk/shared";
import { getLoads } from "./api.js";
import { LoadCard } from "./LoadCard.jsx";
import { VIEW_OPTIONS } from "./LoadsPage.jsx";
import { groupByPlace, markerRadius } from "./mapData.js";
import { Notice, Segmented, Spinner } from "./ui.jsx";

const SIDE_OPTIONS = [
  { id: "from", label: "Yuklash joyi" },
  { id: "to", label: "Tushirish joyi" },
];
const CENTER = [41.0, 65.5]; // O'zbekiston
const REFRESH_MS = 60_000;

export function MapPage({ view, onView, feedNote = null, onNeedProfile, onAuthLost }) {
  const [side, setSide] = useState("from");
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const element = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef(false);

  // Oxirgi 24 soatdagi yuklar (500 tagacha)
  useEffect(() => {
    let cancelled = false;
    fitted.current = false; // boshqa ro'yxat — xaritani unga qayta moslaymiz
    async function load({ silent = false } = {}) {
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getLoads({ view, hours: 24, limit: 500 });
        if (cancelled) return;
        setNow(Date.now());
        setState({ items: data.items, total: data.total, loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        if (error.code === "auth") onAuthLost();
        setState((s) => ({ ...s, loading: false, error: silent && s.items.length ? null : error }));
      }
    }
    load();
    const timer = setInterval(() => load({ silent: true }), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view, onAuthLost]);

  const { groups, unplaced } = useMemo(() => groupByPlace(state.items, side), [state.items, side]);
  const current = groups.find((g) => g.key === selected) ?? null;

  // Xaritani bir marta yaratamiz
  useEffect(() => {
    const instance = L.map(element.current, { center: CENTER, zoom: 6, zoomSnap: 0.5, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Doiralar va tanlangan joydan chiziqlar
  useEffect(() => {
    const target = layer.current;
    if (!target) return;
    target.clearLayers();
    const max = groups[0]?.items.length ?? 1;
    const other = side === "from" ? "to" : "from";

    if (current) {
      const ends = new Map();
      for (const item of current.items) {
        const end = placePoint(item.load, other);
        if (end && end.key !== current.key) ends.set(end.key, end);
      }
      for (const end of ends.values()) {
        L.polyline(
          [
            [current.lat, current.lon],
            [end.lat, end.lon],
          ],
          { className: "map-line", weight: 2, interactive: false },
        ).addTo(target);
        L.circleMarker([end.lat, end.lon], { className: "map-end", radius: 4, weight: 1, interactive: false }).addTo(target);
      }
    }

    for (const group of groups) {
      const on = group.key === selected;
      L.circleMarker([group.lat, group.lon], {
        className: `map-dot${on ? " on" : ""}${group.exact ? "" : " approx"}`,
        radius: markerRadius(group.items.length, max),
        weight: on ? 3 : 1.5,
        fillOpacity: on ? 0.55 : 0.32,
      })
        .bindTooltip(`${group.label}: ${group.items.length} ta`, { direction: "top", offset: [0, -4] })
        .on("click", () => setSelected((key) => (key === group.key ? null : group.key)))
        .addTo(target);
    }
  }, [groups, current, selected, side]);

  // Birinchi ma'lumot kelganda — hamma doira ko'rinadigan qilib yaqinlashtiramiz
  useEffect(() => {
    if (fitted.current || !groups.length || !map.current) return;
    fitted.current = true;
    const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lon]));
    map.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
  }, [groups]);

  // Ro'yxat ko'rinsa, xarita o'lchamini yangilaymiz (Leaflet o'zi bilmaydi)
  useEffect(() => {
    map.current?.invalidateSize();
  }, [current]);

  const { loading, error, items, total } = state;
  return (
    <>
      <div className="toolbar">
        {onView ? <Segmented label="Qaysi yuklar" options={VIEW_OPTIONS} value={view} onChange={onView} /> : feedNote && <p className="hint feed-note">{feedNote}</p>}
        <Segmented
          label="Xaritada nima"
          options={SIDE_OPTIONS}
          value={side}
          onChange={(value) => {
            setSide(value);
            setSelected(null);
          }}
        />
      </div>

      <div className="map-wrap">
        <div ref={element} className="map" role="application" aria-label="Yuklar xaritasi" />
        {loading && !items.length && (
          <div className="map-overlay">
            <Spinner />
          </div>
        )}
      </div>

      {error?.code === "no_profile" ? (
        <Notice
          title="Transportingizni kiriting"
          action={
            <button type="button" className="primary" onClick={onNeedProfile}>
              ⚙️ Sozlamalarni to'ldirish
            </button>
          }
        >
          «Menga mos» yuklar uchun transportingiz kerak. Hozircha «Hammasi» ni ko'ring.
        </Notice>
      ) : error ? (
        <Notice title="Yuklar ochilmadi">{error.message}</Notice>
      ) : current ? (
        <>
          <div className="map-head">
            <h3>
              {current.label}: {current.items.length} ta yuk
            </h3>
            <button type="button" className="link" onClick={() => setSelected(null)}>
              Yopish
            </button>
          </div>
          {!current.exact && <p className="muted small">E'lonlarda faqat {current.label} yozilgan — aniq shahar noma'lum.</p>}
          <div className="loads">
            {current.items.map((item) => (
              <LoadCard key={item.id} item={item} now={now} />
            ))}
          </div>
        </>
      ) : (
        !loading && (
          <p className="muted small map-hint">
            Oxirgi 24 soatda {total} ta yuk
            {items.length < total && ` (xaritada eng yangi ${items.length} tasi)`}, {groups.length} ta joyda. Doirani bosing — o'sha joydagi
            yuklar chiqadi.
            {unplaced > 0 && ` ${unplaced} tasining joyi yozilmagan.`}
          </p>
        )
      )}
    </>
  );
}
