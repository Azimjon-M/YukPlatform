// Yo'nalish tanlash: «📍 Qayerdan?» → «🏁 Qayerga?» — botdagi «📋 Mos yuklar» bilan bir xil (server: GET/PUT /pub/me/route).
// Tanlangani profilga yoziladi: bu ro'yxat ham, botdagi yangi yuklar ham shu yo'nalish bo'yicha.
// Joylar «Qayerda ishlaysiz?» ga qarab serverdan keladi; tugmadagi son — tanlangan muddatda mashinangizga mos yuklar.
import { useEffect, useState } from "react";
import { ROUTE_ANY, routeSide } from "@yuk/shared";
import { getRoute, saveRoute } from "./api.js";
import { haptic } from "./telegram.js";
import { Chips, Notice, Spinner } from "./ui.jsx";

export const hoursText = (hours) => (hours === 72 ? "3 kun" : `${hours} soat`);
const countText = (n) => (n ? `${n} ta` : null);

// «Qayerdan?» da «🌐 Hamma joydan» yo'q (Azimjon, 2026-11-10: yuk bir vaqtda hamma joyda bo'lmaydi) — botdagidek;
// «Qayerga?» da «🌐 Istalgan joyga» bor. Har ikki qadamda «🗺 Xaritadan tanlash» (RouteMapPage.jsx).
// profile — hozirgi (tanlangan joy belgilanadi); onSaved(me) — saqlangach; onCancel — yo'nalish bor bo'lsa «Bekor qilish»;
// onMap(from) — xaritani ochish («Qayerga?» qadamida — tanlangan «Qayerdan» bilan)
export function RoutePicker({ profile, hours, onSaved, onCancel, onMap, onAuthLost }) {
  const [from, setFrom] = useState(null); // null — «Qayerdan?» qadami; { id, label } — «Qayerga?»
  const [state, setState] = useState({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const fromId = from?.id ?? null;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, error: null }));
    getRoute({ from: fromId, hours }).then(
      (data) => alive && setState({ data, error: null }),
      (error) => {
        if (!alive) return;
        if (error.code === "auth") onAuthLost();
        setState({ data: null, error });
      },
    );
    return () => {
      alive = false;
    };
  }, [fromId, hours, attempt, onAuthLost]);

  async function pickTo(to) {
    setSaving(true);
    setSaveError(null);
    try {
      const me = await saveRoute(fromId, to);
      haptic.success();
      onSaved(me);
    } catch (error) {
      haptic.error();
      if (error.code === "auth") onAuthLost();
      setSaveError(error.message);
      setSaving(false);
    }
  }

  const step = from ? "to" : "from";
  // Hozirgi tanlov: «Qayerga?» da faqat o'sha «Qayerdan» qayta tanlanganda belgilanadi
  const current = step === "from" ? routeSide(profile, "from") : routeSide(profile, "from") === fromId ? routeSide(profile, "to") : null;
  const ready = state.data && state.data.from === fromId; // eski qadamning sonlari ko'rinmasin
  const areas = ready ? state.data.areas.map((a) => ({ id: a.id, label: a.label, sub: countText(a.count) })) : [];
  const anyOption = step === "to" ? [{ id: ROUTE_ANY, label: "🌐 Istalgan joyga", sub: ready ? countText(state.data.any) : null }] : [];
  const pick = (id) => {
    if (step === "to") return pickTo(id);
    setFrom({ id, label: areas.find((a) => a.id === id)?.label ?? id });
  };

  return (
    <section className="section route-picker" aria-busy={!ready || saving}>
      {step === "from" ? (
        <>
          <h2>📍 Qayerdan yuk olasiz?</h2>
          <p className="hint">Hozir turgan yoki yuk olmoqchi bo'lgan joyni tanlang. Yonidagi son — oxirgi {hoursText(hours)}dagi mos yuklar.</p>
        </>
      ) : (
        <>
          <p className="route-from">
            <span>
              📍 Qayerdan: <b>{from.label}</b>
            </span>
            <button type="button" className="link" disabled={saving} onClick={() => setFrom(null)}>
              ⬅️ Orqaga
            </button>
          </p>
          <h2>🏁 Qayerga borasiz?</h2>
          <p className="hint">Uyga qaytish yuki kerak bo'lsa — o'z viloyatingizni tanlang.</p>
        </>
      )}

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
      ) : !ready ? (
        <Spinner />
      ) : (
        <fieldset className="plain" disabled={saving}>
          <Chips layout="grid" options={areas} selected={(id) => id === current} onPick={pick} />
          {anyOption.length > 0 && (
            <div className="route-any">
              <Chips layout="list" options={anyOption} selected={(id) => id === current} onPick={pick} />
            </div>
          )}
          {onMap && (
            <button type="button" className="more route-map-open" onClick={() => onMap(fromId)}>
              🗺 Xaritadan tanlash
            </button>
          )}
        </fieldset>
      )}

      {saveError && <p className="error">{saveError}</p>}
      {saving && <p className="hint">Saqlanyapti...</p>}
      <p className="hint route-foot">
        Bot ham yangi yuklarni shu yo'nalish bo'yicha yuboradi.
        {onCancel && (
          <>
            {" "}
            <button type="button" className="link" disabled={saving} onClick={onCancel}>
              Bekor qilish
            </button>
          </>
        )}
      </p>
    </section>
  );
}
