// «🚚 Mashinalar» uchun nuqta tanlash (Azimjon, 2026-11-12: «nuqtani haritadan tanlat!»).
// Yuk beruvchiga sozlamalar (ro'yxatdan o'tish) SHART EMAS: u xaritada joyni bosadi —
// «Mashinalar» o'sha nuqtaga yaqin bo'sh mashinalarni massofa bo'yicha tartiblab ko'rsatadi
// (server GET /pub/trucks?near=lat,lng&r=km — masofa @yuk/shared geo.js distanceKm).
// Tanlangan nuqta atrofida aylana radius shuni ko'rsatadi; radius tanlanadi (10/25/50/100/250 km).
import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haptic, inTelegram, useBackButton, useMainButton } from "./telegram.js";
import { Segmented } from "./ui.jsx";

const CENTER = [41.0, 65.5]; // O'zbekiston
export const RADIUS_OPTIONS = [10, 25, 50, 100, 250]; // km — «Mashinalar» ro'yxatining doirasi

// point — oldin tanlangan nuqta ({lat,lng}) yoki null; onPick(point) — «Ko'rsatish»; onCancel — «Bekor qilish»
export function TruckMapPage({ point = null, radius = 50, onRadius, onPick, onCancel }) {
  const [picked, setPicked] = useState(point);
  const element = useRef(null);
  const map = useRef(null);
  const mark = useRef(null); // nuqta + aylana bir guruhda

  // Xarita bir marta yaratiladi (RouteMapPage dagi kabi; Leaflet div'ni qayta ishlatolmaydi)
  useEffect(() => {
    const instance = L.map(element.current, { center: CENTER, zoom: 6, zoomSnap: 0.25, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(instance);
    mark.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Bosilgan joy — nuqta (xaritaning o'zi bosiladi: bu yerda doiralar yo'q)
  useEffect(() => {
    const instance = map.current;
    if (!instance) return undefined;
    const click = (event) => {
      haptic.select();
      setPicked({ lat: Number(event.latlng.lat.toFixed(5)), lng: Number(event.latlng.lng.toFixed(5)) });
    };
    instance.on("click", click);
    return () => instance.off("click", click);
  }, []);

  // Nuqta va radius: belgi + atrofidagi aylana (radius km — aylana metrla)
  useEffect(() => {
    const target = mark.current;
    if (!target) return;
    target.clearLayers();
    if (!picked) return;
    const at = [picked.lat, picked.lng];
    L.circle(at, { className: "truck-near", radius: radius * 1000, interactive: false }).addTo(target);
    L.circleMarker(at, { className: "route-dot on", radius: 10, weight: 3, interactive: false })
      .bindTooltip("📍 Siz tanlagan joy", { permanent: true, direction: "top", offset: [0, -12], className: "route-label on" })
      .addTo(target);
  }, [picked, radius]);

  // Oldindan tanlangan nuqta bor bo'lsa — xaritani unga qaratamiz ( telefon ekrani kichik: radius ko'rinsin)
  const aimed = useRef(false);
  useEffect(() => {
    if (aimed.current || !picked || !map.current) return;
    aimed.current = true;
    map.current.setView([picked.lat, picked.lng], 9);
  }, [picked]);

  const show = useCallback(() => {
    if (!picked) return;
    haptic.success();
    onPick(picked);
  }, [picked, onPick]);

  useMainButton("🔎 Shu joy atrofidagi mashinalar", show, inTelegram && Boolean(picked));
  useBackButton(onCancel, inTelegram && Boolean(onCancel));

  return (
    <section className="truck-map-page" aria-label="Mashinalar uchun joy tanlash">
      <p className="hint">Yuk bermochi bo'lgan joyni xaritada bosing — o'sha joyga yaqin bo'sh mashinalar ro'yxati chiqadi.</p>
      <div className="toolbar">
        <Segmented
          label="Radius"
          options={RADIUS_OPTIONS.map((km) => ({ id: km, label: `${km} km` }))}
          value={radius}
          onChange={(km) => {
            haptic.select();
            onRadius(km);
          }}
        />
      </div>
      <div className="map-wrap">
        <div ref={element} className="map route-map" role="application" aria-label="Joy tanlash xaritasi" />
      </div>
      <div className="route-pick" aria-live="polite">
        {picked ? (
          <span>
            📍 Tanlandi: <b>{picked.lat.toFixed(3)}, {picked.lng.toFixed(3)}</b> · <b>{radius} km</b> ichida
          </span>
        ) : (
          <span className="muted">Hali tanlanmadi — xaritani bosing.</span>
        )}
      </div>
      {!inTelegram && (
        <div className="route-actions">
          <button type="button" className="primary" disabled={!picked} onClick={show}>
            🔎 Mashinalarni ko'rsatish
          </button>
          {onCancel && (
            <button type="button" className="link" onClick={onCancel}>
              Bekor qilish
            </button>
          )}
        </div>
      )}
    </section>
  );
}
