// Yuk beruvchi sozlamalari: yuk qayerda va qayerga, qanday mashina va kuzov kerak.
// Bot va «Mashinalar» bo'limi shu bo'yicha bo'sh mashinalarni tanlaydi (@yuk/shared match.js matchTruck).
// Hech narsa tanlanmasa — hammasi: istalgan joy, istalgan mashina.
//   Birinchi marta — 3 qadam: Yo'nalish → Mashina → Tasdiqlash (Steps.jsx); keyin — bitta sahifa.
import { useCallback, useEffect, useRef, useState } from "react";
import { BODY_TYPES, TRUCK_CLASSES, capacityRangeText, profileRows } from "@yuk/shared";
import { shipperFormFromProfile, shipperProfileFromForm, toggle } from "./form.js";
import { Areas, OPEN_FROM_MENU, submitProfile, useScopeChoices } from "./settingsParts.jsx";
import { ProfileSummary, StepHeader, StepNav, useFormButtons, useSteps } from "./Steps.jsx";
import { canSendData, haptic, inTelegram, setUnsaved, showAlert } from "./telegram.js";
import { Chips, Section } from "./ui.jsx";

// Haydovchi formasidagi ro'yxatlar (SettingsPage.jsx): nomi, ostida — qancha ko'taradi / kuzov izohi
const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: capacityRangeText(t.capacityT), note: t.note }));
// "Boshqa" kuzov tanlovda ma'nosiz: e'londa kuzov aytilmasa, mashina baribir mos keladi
const BODY_OPTIONS = BODY_TYPES.filter((b) => b.form !== false).map((b) => ({ id: b.id, label: b.name, note: b.sub }));

export const SHIPPER_STEPS = [
  { id: "yonalish", title: "Yo'nalish", sections: ["intl", "from", "to"] },
  { id: "mashina", title: "Transport", sections: ["classes", "bodies"] },
  { id: "tasdiq", title: "Tasdiqlash", sections: ["summary"] },
];
const ROW_STEP = { intl: 0, from: 0, to: 0, classes: 1, bodies: 1 };
const STEP_LEAD = {
  mashina: "Qanday transport kerak? Hech narsa tanlamasangiz — hammasi keladi.",
  tasdiq: "Oxirgi qadam: tekshiring va «Saqlash» ni bosing. Keyin mos bo'sh mashinalar botga shaxsiy xabar bo'lib keladi.",
};

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
// roleLine — «Siz: yuk beruvchi · Rolni almashtirish» qatori (ro'yxatdan o'tishning birinchi qadamida)
export function ShipperSettings({ me, initialProfile, scope, onSaved, roleLine = null }) {
  const online = Boolean(me);
  const profile = me?.profile ?? initialProfile ?? null;
  const [registering] = useState(() => !profile);
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

  // Yuk beruvchida majburiy joy yo'q (hech narsa tanlanmasa — hammasi), shuning uchun «Keyingi» doim o'tadi
  const wizard = useSteps(SHIPPER_STEPS, { onFinish: save });
  useFormButtons({ registering, wizard, save, busy });

  const show = (id) => !registering || wizard.step.sections.includes(id);
  const international = Boolean(intl?.options[form.intl]?.international);
  const draft = registering && wizard.last ? shipperProfileFromForm(form, scope).profile : null;
  const firstName = me?.name?.split(/\s+/)[0];

  let lead = "Sozlamalarni o'zgartiring va «Saqlash» ni bosing.";
  if (registering) {
    lead =
      STEP_LEAD[wizard.step.id] ??
      `${firstName ? `Xush kelibsiz, ${firstName}!` : "Xush kelibsiz!"} Yukingiz qayerdan qayerga borishini belgilang — mos bo'sh mashinalarni katta guruhlardan saralab, botga shaxsiy xabar qilib yuboramiz.`;
  }

  return (
    <>
      {registering && <StepHeader steps={SHIPPER_STEPS} index={wizard.index} onJump={wizard.edit} />}
      <p className="lead">{lead}</p>

      {!online && inTelegram && !canSendData && <div className="notice">{OPEN_FROM_MENU}</div>}

      {/* Haydovchi formasidagidek tepada: xalqaro tanlansa, pastda davlatlar ham chiqadi */}
      {intl && show("intl") && (
        <Section id="intl" title="🌍 Qayerga yuk jo'natasiz?" hint={intl.question}>
          <Chips layout="list" options={intlOptions} selected={(id) => form.intl === id} onPick={(id) => update({ intl: id })} />
        </Section>
      )}

      {show("from") && (
        <Section id="from" title="📍 Yuk qayerda yuklanadi?" hint="Shu yerdagi bo'sh mashinalarni yuboramiz. Bir nechtasini tanlash mumkin.">
          <Areas values={form.fromAreas} allLabel="Hamma joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(fromAreas) => update({ fromAreas })} />
        </Section>
      )}

      {show("to") && (
        <Section id="to" title="🏁 Yuk qayerga boradi?" hint="Qayerga borishi yozilmagan mashinalar ham keladi — ular istalgan joyga boradi.">
          <Areas values={form.toAreas} allLabel="Istalgan joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(toAreas) => update({ toAreas })} />
        </Section>
      )}

      {show("classes") && (
        <Section id="classes" title="🚚 Qanday transport kerak?" hint="Bir nechtasini tanlash mumkin.">
          <MultiPick layout="list" options={CLASS_OPTIONS} values={form.truckClasses} anyLabel="Istalgan transport" onChange={(truckClasses) => update({ truckClasses })} />
        </Section>
      )}

      {show("bodies") && (
        <Section id="bodies" title="📦 Qanday kuzov kerak?">
          <MultiPick layout="grid" options={BODY_OPTIONS} values={form.bodyTypes} anyLabel="Istalgan kuzov" onChange={(bodyTypes) => update({ bodyTypes })} />
        </Section>
      )}

      {draft && <ProfileSummary rows={profileRows(draft, scope, "yuk_beruvchi", { web: true })} stepOf={(id) => ROW_STEP[id]} onEdit={wizard.edit} />}

      {registering && wizard.index === 0 && roleLine}

      {registering ? (
        <StepNav {...wizard} busy={busy} />
      ) : (
        !inTelegram && (
          <div className="footer">
            <button type="button" className="save" onClick={save} disabled={busy}>
              {busy ? "Saqlanyapti..." : "Saqlash"}
            </button>
          </div>
        )
      )}
      {preview && <pre className="preview">{JSON.stringify(preview, null, 2)}</pre>}
    </>
  );
}
