// Sozlamalar: haydovchining mashinasi va yo'nalishi — bitta sahifali forma.
// Saqlash: server orqali, aloqa bo'lmasa — Telegram ichida botga sendData bilan (settingsParts.jsx submitProfile).
// Yuk beruvchi sozlamalari — ShipperSettings.jsx.
import { useCallback, useEffect, useRef, useState } from "react";
import { BODY_TYPES, CAPACITY_OPTIONS, LOADING_SIDES, MODE_OPTIONS, SIDE_LABELS, TRUCK_CLASSES } from "@yuk/shared";
import { classBody, formFromProfile, profileFromForm, selectClass, sizeSummary, toggle } from "./form.js";
import { Areas, OPEN_FROM_MENU, submitProfile, useScopeChoices } from "./settingsParts.jsx";
import { canSendData, haptic, inTelegram, setUnsaved, showAlert, useMainButton } from "./telegram.js";
import { Chips, Section } from "./ui.jsx";

const fmt = (n) => String(n).replace(".", ",");
const number = (text) => Number(String(text).trim().replace(",", "."));

const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: `${fmt(t.capacityT[0])}–${fmt(t.capacityT[1])} t` }));
const BODY_OPTIONS = BODY_TYPES.map((b) => ({ id: b.id, label: b.name }));
const SIDE_OPTIONS = LOADING_SIDES.map((s) => ({ id: s.id, label: SIDE_LABELS[s.id] }));
const MODE_CHOICES = Object.entries(MODE_OPTIONS).map(([id, label]) => ({ id, label }));

function SizeInput({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" placeholder="0,0" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="unit">m</span>
    </label>
  );
}

// me — serverdagi haydovchi (null — server bilan aloqa yo'q); initialProfile — bot manzilda bergan (?p=)
// scope — yo'nalish doirasi; onSaved(me) — server saqlagach
export function SettingsPage({ me, initialProfile, scope, onSaved }) {
  const online = Boolean(me);
  const profile = me?.profile ?? initialProfile ?? null;
  const [form, setForm] = useState(() => formFromProfile(profile));
  const [problem, setProblem] = useState(null); // { field, error }
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const initial = useRef(JSON.stringify(form));

  const { intl, intlOptions, countries, abroadTitle } = useScopeChoices(scope);

  useEffect(() => setUnsaved(JSON.stringify(form) !== initial.current), [form]);
  useEffect(() => () => setUnsaved(false), []);

  const update = (patch) => {
    setProblem(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const errorFor = (field) => (problem?.field === field ? problem.error : null);

  const save = useCallback(async () => {
    if (busy) return;
    const result = profileFromForm(form, scope);
    if (result.error) {
      haptic.error();
      setProblem(result);
      document.getElementById(result.field)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (inTelegram) showAlert(result.error);
      return;
    }
    setBusy(true);
    try {
      const done = await submitProfile({ online, role: "haydovchi", profile: result.profile });
      if (done.me || done.sent) {
        haptic.success();
        initial.current = JSON.stringify(form);
        setUnsaved(false);
      }
      if (done.me) onSaved(done.me);
      // Oddiy brauzer, server yo'q (sinov): botga ketadigan ma'lumotni ko'rsatamiz
      if (done.preview) setPreview(done.preview);
    } catch (error) {
      haptic.error();
      setProblem({ field: "class", error: error.message });
      showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }, [form, scope, online, busy, onSaved]);

  useMainButton(busy ? "Saqlanyapti..." : "Saqlash", save);

  const standard = classBody(form.truckClass);
  const summary = sizeSummary(form);
  const international = Boolean(intl?.options[form.intl]?.international);

  return (
    <>
      <p className="lead">
        {profile
          ? "Sozlamalarni o'zgartiring va «Saqlash» ni bosing."
          : "Mashinangiz va yo'nalishingizni belgilang — mos yuklarni shaxsiy xabarda yuboramiz."}
      </p>

      {!online && inTelegram && !canSendData && <div className="notice">{OPEN_FROM_MENU}</div>}

      <Section id="class" title="🚚 Mashina turi" error={errorFor("class")}>
        <Chips
          layout="list"
          options={CLASS_OPTIONS}
          selected={(id) => form.truckClass === id}
          onPick={(id) => {
            setProblem(null);
            setForm((f) => selectClass(f, id));
          }}
        />
      </Section>

      <Section id="body" title="📦 Kuzov turi" error={errorFor("body")}>
        <Chips layout="grid" options={BODY_OPTIONS} selected={(id) => form.bodyType === id} onPick={(id) => update({ bodyType: id })} />
      </Section>

      <Section id="capacity" title="⚖️ Necha tonna ko'taradi?" error={errorFor("capacity")}>
        {form.truckClass ? (
          <>
            <Chips
              options={(CAPACITY_OPTIONS[form.truckClass] ?? []).map((t) => ({ id: String(t), label: `${fmt(t)} t` }))}
              selected={(id) => number(form.capacity) === Number(id)}
              onPick={(id) => update({ capacity: id })}
            />
            <label className="field">
              <span>Boshqa son</span>
              <input inputMode="decimal" placeholder="masalan: 7,5" value={fmt(form.capacity)} onChange={(e) => update({ capacity: e.target.value })} />
              <span className="unit">t</span>
            </label>
          </>
        ) : (
          <p className="hint">Avval mashina turini tanlang.</p>
        )}
      </Section>

      <Section id="size" title="📏 Kuzov ichki o'lchami" hint="Kub va paletni hisoblash uchun. Bilmasangiz — o'tkazib yuboring." error={errorFor("size")}>
        <Chips
          options={[
            ...(standard ? [{ id: "std", label: "Standart", sub: `${fmt(standard.lengthM)} × ${fmt(standard.widthM)} × ${fmt(standard.heightM)} m` }] : []),
            { id: "custom", label: "O'zim yozaman" },
            { id: "none", label: "Bilmayman" },
          ]}
          selected={(id) => form.sizeMode === id}
          onPick={(id) => update({ sizeMode: id })}
        />
        {form.sizeMode === "custom" && (
          <div className="sizes">
            <SizeInput label="Uzunligi" value={form.size.lengthM} onChange={(v) => update({ size: { ...form.size, lengthM: v } })} />
            <SizeInput label="Eni" value={form.size.widthM} onChange={(v) => update({ size: { ...form.size, widthM: v } })} />
            <SizeInput label="Balandligi" value={form.size.heightM} onChange={(v) => update({ size: { ...form.size, heightM: v } })} />
          </div>
        )}
        {summary && (
          <p className="summary">
            ≈ {fmt(summary.volumeM3)} kub · {summary.pallets} palet
          </p>
        )}
      </Section>

      <Section id="sides" title="↕️ Qaysi tomondan yuklanadi?" hint="Bir nechtasini tanlang. Chap va o'ng — mashinaga orqasidan qaraganda.">
        <Chips options={SIDE_OPTIONS} selected={(id) => form.loadingSides.includes(id)} onPick={(id) => update({ loadingSides: toggle(form.loadingSides, id) })} />
      </Section>

      {intl && (
        <Section id="intl" title="🌍 Qayerda ishlaysiz?" hint={intl.question}>
          <Chips layout="list" options={intlOptions} selected={(id) => form.intl === id} onPick={(id) => update({ intl: id })} />
        </Section>
      )}

      <Section id="from" title="📍 Qayerdan yuk olasiz?" hint="Bir nechtasini tanlash mumkin.">
        <Areas values={form.fromAreas} allLabel="Hamma joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(fromAreas) => update({ fromAreas })} />
      </Section>

      <Section id="to" title="🏁 Qayerga borasiz?" hint="Masalan, uyga qaytish yuki uchun o'z viloyatingiz.">
        <Areas values={form.toAreas} allLabel="Istalgan joy" international={international} countries={countries} abroadTitle={abroadTitle} onChange={(toAreas) => update({ toAreas })} />
      </Section>

      <Section id="mode" title="👁 Qaysi yuklarni yuboraylik?">
        <Chips layout="list" options={MODE_CHOICES} selected={(id) => form.mode === id} onPick={(id) => update({ mode: id })} />
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
