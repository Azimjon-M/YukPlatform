// Yuk beruvchi sozlamalari: yuk qayerda va qayerga, qanday mashina va kuzov kerak.
// Bot va «Mashinalar» bo'limi shu bo'yicha bo'sh mashinalarni tanlaydi (@yuk/shared match.js matchTruck).
// Hech narsa tanlanmasa — hammasi: istalgan joy, istalgan mashina.
import { useCallback, useEffect, useRef, useState } from "react";
import { BODY_TYPES, TRUCK_CLASSES } from "@yuk/shared";
import { shipperFormFromProfile, shipperProfileFromForm, toggle } from "./form.js";
import { Areas, OPEN_FROM_MENU, submitProfile, useScopeChoices } from "./settingsParts.jsx";
import { canSendData, haptic, inTelegram, setUnsaved, showAlert, useMainButton } from "./telegram.js";
import { Chips, Section } from "./ui.jsx";

const fmt = (n) => String(n).replace(".", ",");
const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: `${fmt(t.capacityT[0])}–${fmt(t.capacityT[1])} t` }));
// "Boshqa" kuzov tanlovda ma'nosiz: e'londa kuzov aytilmasa, mashina baribir mos keladi
const BODY_OPTIONS = BODY_TYPES.filter((b) => b.id !== "boshqa").map((b) => ({ id: b.id, label: b.name }));

// Bir nechtasini tanlash: «Istalgan» — ro'yxat bo'sh
function MultiPick({ options, values, anyLabel, layout, onChange }) {
  return (
    <Chips
      layout={layout}
      options={[{ id: "*", label: anyLabel }, ...options]}
      selected={(id) => (id === "*" ? values.length === 0 : values.includes(id))}
      onPick={(id) => onChange(id === "*" ? [] : toggle(values, id))}
    />
  );
}

// me — serverdagi foydalanuvchi (null — server bilan aloqa yo'q); initialProfile — bot manzilda bergan (?p=)
export function ShipperSettings({ me, initialProfile, scope, onSaved }) {
  const online = Boolean(me);
  const profile = me?.profile ?? initialProfile ?? null;
  const [form, setForm] = useState(() => shipperFormFromProfile(profile));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const initial = useRef(JSON.stringify(form));
  const { intl, intlOptions, countries, abroadTitle } = useScopeChoices(scope);

  useEffect(() => setUnsaved(JSON.stringify(form) !== initial.current), [form]);
  useEffect(() => () => setUnsaved(false), []);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = useCallback(async () => {
    if (busy) return;
    const result = shipperProfileFromForm(form, scope);
    if (result.error) {
      haptic.error();
      showAlert(result.error);
      return;
    }
    setBusy(true);
    try {
      const done = await submitProfile({ online, role: "yuk_beruvchi", profile: result.profile });
      if (done.me || done.sent) {
        haptic.success();
        initial.current = JSON.stringify(form);
        setUnsaved(false);
      }
      if (done.me) onSaved(done.me);
      if (done.preview) setPreview(done.preview);
    } catch (error) {
      haptic.error();
      showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }, [form, scope, online, busy, onSaved]);

  useMainButton(busy ? "Saqlanyapti..." : "Saqlash", save);

  const international = Boolean(intl?.options[form.intl]?.international);

  return (
    <>
      <p className="lead">
        {profile
          ? "Sozlamalarni o'zgartiring va «Saqlash» ni bosing."
          : "Yukingiz qayerdan qayerga borishini va qanday mashina kerakligini belgilang — mos bo'sh mashinalarni shaxsiy xabarda yuboramiz."}
      </p>

      {!online && inTelegram && !canSendData && <div className="notice">{OPEN_FROM_MENU}</div>}

      {/* Haydovchi formasidagidek tepada: xalqaro tanlansa, pastda davlatlar ham chiqadi */}
      {intl && (
        <Section id="intl" title="🌍 Qayerga yuk jo'natasiz?" hint={intl.question}>
          <Chips layout="list" options={intlOptions} selected={(id) => form.intl === id} onPick={(id) => update({ intl: id })} />
        </Section>
      )}

      <Section id="from" title="📍 Yuk qayerda yuklanadi?" hint="Shu yerdagi bo'sh mashinalarni yuboramiz. Bir nechtasini tanlash mumkin.">
        <Areas values={form.fromAreas} allLabel="Hamma joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(fromAreas) => update({ fromAreas })} />
      </Section>

      <Section id="to" title="🏁 Yuk qayerga boradi?" hint="Qayerga borishi yozilmagan mashinalar ham keladi — ular istalgan joyga boradi.">
        <Areas values={form.toAreas} allLabel="Istalgan joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(toAreas) => update({ toAreas })} />
      </Section>

      <Section id="classes" title="🚚 Qanday mashina kerak?" hint="Bir nechtasini tanlash mumkin.">
        <MultiPick layout="list" options={CLASS_OPTIONS} values={form.truckClasses} anyLabel="Istalgan mashina" onChange={(truckClasses) => update({ truckClasses })} />
      </Section>

      <Section id="bodies" title="📦 Qanday kuzov kerak?">
        <MultiPick layout="grid" options={BODY_OPTIONS} values={form.bodyTypes} anyLabel="Istalgan kuzov" onChange={(bodyTypes) => update({ bodyTypes })} />
      </Section>

      {!inTelegram && (
        <div className="footer">
          <button type="button" className="save" onClick={save} disabled={busy}>
            {busy ? "Saqlanyapti..." : "Saqlash"}
          </button>
          {preview && <pre className="preview">{JSON.stringify(preview, null, 2)}</pre>}
        </div>
      )}
    </>
  );
}
