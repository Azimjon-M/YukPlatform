// «🗺 Xaritadan tanlash» — haydovchining yo'nalishi xaritada (Azimjon, 2026-11-10): avval «📍 Qayerdan?», keyin «🏁 Qayerga?».
// Botdagi «Qayerdan?» / «Qayerga?» xabarlari ostidagi tugma shu sahifani ochadi (?v=yonalish, «Qayerga?» dan — &f=<qayerdan>);
// web'dagi «📋 Yuklar» → yo'nalish tanlashda ham bor. Har doira — bitta viloyat yoki (Faqat O'zbekiston tanlanmagan bo'lsa)
// qo'shni davlat: joylar serverdan (GET /pub/me/route — botdagi tugmalar bilan bir xil ro'yxat). «Hamma joydan» yo'q
// (yuk bir vaqtda hamma joyda bo'lmaydi); «Qayerga?» da «🌐 Istalgan joyga» bor. Xorij (nuqtasi yo'q) — xarita ostida tugma.
// Doira kichik, barmoq esa katta: bosilgan joyga eng yaqin doira tanlanadi (routeMap.js nearestArea).
// Saqlash — PUT /pub/me/route; botdan ochilgan bo'lsa (notify) bot chatda «✅ Yo'nalish: …» deb mos yuklarni yuboradi,
// ilova esa o'zi yopiladi.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ROUTE_ANY, routeSide } from "@yuk/shared";
import { getRoute, saveRoute } from "./api.js";
import { areaPoint, tapAction } from "./routeMap.js";
import { closeApp, haptic, inTelegram, useBackButton, useMainButton } from "./telegram.js";
import { Chips, Notice, Spinner } from "./ui.jsx";

const LABEL_ZOOM = 6.5; // shundan yaqinda hamma joy nomi ko'rinadi (uzoqda — faqat tanlangani: nomlar ustma-ust tushmasin)
const PICK_PX = 34; // bosilgan joydan shuncha pikselgacha uzoqdagi doira tanlanadi
const HIT_PX = 11; // doiraning o'ziga tegdi (radiusi 9) — yonida boshqasi bo'lsa ham shu tanlanadi
const ANY_LABEL = "🌐 Istalgan joyga";

// profile — me.profile (hozirgi yo'nalish belgilanib turadi); initialFrom — botdagi «Qayerga?» qadamidan (?f=);
// notify — botdan ochilgan (saqlangach bot chatda javob beradi, ilova yopiladi); onDone(me) — saqlandi (saytda);
// onCancel — «Bekor qilish» (saytda; Telegram'da ilovaning o'zini yopadi)
export function RouteMapPage({ profile, initialFrom = null, notify = false, onDone, onCancel, onAuthLost }) {
  const [state, setState] = useState({ areas: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [from, setFrom] = useState(initialFrom && initialFrom !== ROUTE_ANY ? initialFrom : null); // null — «Qayerdan?» qadami
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(null); // Telegram'da: «✅ Saqlandi» ekrani (ilova yopilguncha)
  const [labels, setLabels] = useState(false); // hamma nomlar ko'rinadimi (yaqinlashtirilgan)
  const element = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pointsRef = useRef([]);
  const step = from ? "to" : "from";

  // Joylar ro'yxati (sonlari kerak emas — xaritada ko'rsatilmaydi)
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, error: null }));
    getRoute({ hours: 24 }).then(
      (data) => alive && setState({ areas: data.areas.map(({ id, label }) => ({ id, label })), error: null }),
      (error) => {
        if (!alive) return;
        if (error.code === "auth") onAuthLost();
        setState({ areas: null, error });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt, onAuthLost]);

  const areas = state.areas;
  const byId = useMemo(() => new Map((areas ?? []).map((a) => [a.id, a])), [areas]);
  const onMap = useMemo(() => (areas ?? []).map((a) => ({ ...a, point: areaPoint(a.id) })).filter((a) => a.point), [areas]);
  const offMap = useMemo(() => (areas ?? []).filter((a) => !areaPoint(a.id)), [areas]);
  const labelOf = (id) => (id === ROUTE_ANY ? ANY_LABEL : (byId.get(id)?.label ?? id));

  // Botdan kelgan «Qayerdan» bu haydovchiga ko'rsatilmaydigan joy bo'lsa — «Qayerdan?» dan boshlaymiz
  useEffect(() => {
    if (areas && from && !byId.has(from)) setFrom(null);
  }, [areas, byId, from]);

  // Qadam ochilganda hozirgi tanlov belgilanib turadi (botdagi ✅ kabi): «Qayerga?» da — faqat o'sha «Qayerdan» bo'lsa.
  // «⬅️ Orqaga» bilan qaytilsa — hozirgina tanlangan «Qayerdan»
  const backTo = useRef(null);
  useEffect(() => {
    if (!areas) return;
    const returned = step === "from" ? backTo.current : null;
    backTo.current = null;
    const current =
      returned ?? (step === "from" ? routeSide(profile, "from") : routeSide(profile, "from") === from ? routeSide(profile, "to") : null);
    const known = current === ROUTE_ANY ? step === "to" : byId.has(current);
    setPicked(known ? current : null);
  }, [areas, byId, step, from, profile]);

  // Xarita bir marta yaratiladi
  useEffect(() => {
    const instance = L.map(element.current, { center: [41.0, 65.5], zoom: 5, zoomSnap: 0.25, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    const zoomed = () => setLabels(instance.getZoom() >= LABEL_ZOOM);
    instance.on("zoomend", zoomed);
    zoomed();
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Bosilgan joyga eng yaqin doira (doiralarning o'zi bosilmaydi — interactive: false). Bir nechta doira orasiga
  // tegsa — avval o'sha joy kattalashadi (routeMap.js tapAction)
  const pickAt = useCallback((event) => {
    const instance = map.current;
    if (!instance) return;
    const click = instance.latLngToContainerPoint(event.latlng);
    const points = pointsRef.current.map((a) => ({ id: a.id, ...instance.latLngToContainerPoint(a.point) }));
    const zoom = instance.getZoom();
    const action = tapAction(points, click, { maxPx: PICK_PX, hitPx: HIT_PX, canZoom: zoom < LABEL_ZOOM });
    if (!action) return;
    if (action.zoom) {
      instance.setView(event.latlng, Math.max(LABEL_ZOOM, zoom + 1)); // kamida nomlar chiqadigan darajagacha
      return;
    }
    haptic.select();
    setPicked(action.pick);
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return undefined;
    instance.on("click", pickAt);
    return () => instance.off("click", pickAt);
  }, [pickAt]);

  // Doiralar: tanlangani to'q; «Qayerga?» da «Qayerdan» doirasi alohida (qora) va undan tanlangan joyga chiziq.
  // «Qayerdan» ning o'zini ham «Qayerga» qilib tanlash mumkin — viloyat ichidagi yuklar (botdagidek)
  useEffect(() => {
    const target = layer.current;
    if (!target) return;
    target.clearLayers();
    pointsRef.current = onMap;
    const start = step === "to" ? onMap.find((a) => a.id === from) : null;
    const end = onMap.find((a) => a.id === picked);
    if (start && end && end.id !== start.id) {
      L.polyline([start.point, end.point], { className: "map-line", weight: 2, interactive: false }).addTo(target);
    }
    for (const area of onMap) {
      const isStart = area === start;
      const on = area.id === picked;
      const marker = L.circleMarker(area.point, {
        className: `route-dot${on ? " on" : ""}${isStart ? " start" : ""}`,
        radius: on || isStart ? 12 : 9,
        weight: on ? 3 : 2,
        interactive: false,
      });
      if (labels || on || isStart) {
        const name = isStart ? `📍 ${area.label}` : area.label;
        marker.bindTooltip(name, { permanent: true, direction: "top", offset: [0, -10], className: `route-label${on ? " on" : ""}` });
      }
      marker.addTo(target);
    }
  }, [onMap, picked, step, from, labels]);

  // Birinchi marta — hamma doira ko'rinadigan qilib
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !onMap.length || !map.current) return;
    fitted.current = true;
    // Telefon eni tor — chetdan joy kam qoldiramiz, doiralar kattaroq ko'rinsin
    map.current.fitBounds(L.latLngBounds(onMap.map((a) => a.point)), { padding: [18, 18], maxZoom: 7 });
  }, [onMap]);

  const next = useCallback(async () => {
    if (!picked || saving) return;
    if (step === "from") {
      haptic.select();
      setFrom(picked);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const me = await saveRoute(from, picked, { notify });
      haptic.success();
      if (notify && inTelegram) {
        // Bot chatdagi xabarni «✅ Yo'nalish» ga almashtirib, mos yuklarni yuboradi — ilova o'zi yopiladi
        setSaved(me);
        setTimeout(() => closeApp() || onDone(me), 1200);
        return;
      }
      onDone(me);
    } catch (error) {
      haptic.error();
      if (error.code === "auth") onAuthLost();
      setSaveError(error.message);
      setSaving(false);
    }
  }, [picked, saving, step, from, notify, onDone, onAuthLost]);

  const back = useCallback(() => {
    backTo.current = from;
    setFrom(null);
    setSaveError(null);
  }, [from]);

  const buttonText = step === "from" ? "Keyingi: 🏁 Qayerga? →" : "✅ Saqlash";
  useMainButton(buttonText, next, inTelegram && Boolean(picked) && !saving && !saved);
  useBackButton(back, inTelegram && step === "to" && !saving && !saved);

  if (saved) {
    return (
      <div className="center">
        <Notice title="✅ Yo'nalish saqlandi">
          🧭 {labelOf(from)} → {labelOf(picked)}
          <br />
          Mos yuklar botga yuborilyapti.
        </Notice>
      </div>
    );
  }

  const extra = [...offMap, ...(step === "to" ? [{ id: ROUTE_ANY, label: ANY_LABEL }] : [])];
  return (
    <section className="route-map-page" aria-busy={!areas || saving}>
      {step === "from" ? (
        <>
          <h2>📍 Qayerdan yuk olasiz?</h2>
          <p className="hint">Hozir turgan yoki yuk olmoqchi bo'lgan joyni xaritada bosing. Kattalashtirsangiz, hamma nomlar chiqadi.</p>
        </>
      ) : (
        <>
          <p className="route-from">
            <span>
              📍 Qayerdan: <b>{labelOf(from)}</b>
            </span>
            {!inTelegram && (
              <button type="button" className="link" disabled={saving} onClick={back}>
                ⬅️ Orqaga
              </button>
            )}
          </p>
          <h2>🏁 Qayerga yuk olib bormoqchisiz?</h2>
          <p className="hint">Borish joyini xaritada bosing yoki pastdan tanlang.</p>
        </>
      )}

      <div className="map-wrap">
        <div ref={element} className="map route-map" role="application" aria-label={step === "from" ? "Qayerdan — xarita" : "Qayerga — xarita"} />
        {!areas && !state.error && (
          <div className="map-overlay">
            <Spinner />
          </div>
        )}
      </div>

      {state.error ? (
        <Notice
          title="Joylar ochilmadi"
          action={
            <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>
              Qayta urinish
            </button>
          }
        >
          {state.error.message}
        </Notice>
      ) : (
        areas && (
          <>
            {extra.length > 0 && (
              <fieldset className="plain route-extra" disabled={saving}>
                <Chips layout="list" options={extra} selected={(id) => id === picked} onPick={setPicked} />
              </fieldset>
            )}
            <div className="route-pick" aria-live="polite">
              {picked ? (
                <span>
                  {step === "from" ? "📍 Qayerdan" : "🏁 Qayerga"}: <b>{labelOf(picked)}</b>
                </span>
              ) : (
                <span className="muted">Hali tanlanmadi — xaritadagi doirani bosing.</span>
              )}
            </div>
            {saveError && <p className="error">{saveError}</p>}
            {saving && <p className="hint">Saqlanyapti...</p>}
            {!inTelegram && (
              <div className="route-actions">
                <button type="button" className="primary" disabled={!picked || saving} onClick={next}>
                  {buttonText}
                </button>
                {onCancel && (
                  <button type="button" className="link" disabled={saving} onClick={onCancel}>
                    Bekor qilish
                  </button>
                )}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
