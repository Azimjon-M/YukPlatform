// Haydovchi: transporti va qayerda ishlashi.
//   Birinchi marta (profil yo'q) — ro'yxatdan o'tish: Transport → O'lcham → Tasdiqlash (Steps.jsx). Tyagach, sisterna va
//   yengil mashinada «O'lcham» qadami yo'q (o'lcham va yuklash tomoni kerak emas).
//   Keyin — hamma bo'lim bitta sahifada (bitta joyni tez o'zgartirish uchun).
// Yo'nalish (qayerdan → qayerga) bu yerda so'ralmaydi (Azimjon, 2026-11-07: haydovchi har kuni boshqa joyda bo'ladi) —
// botda «📋 Mos yuklar» bosilganda tanlanadi; viloyatlar va davlatlar shu yerdagi «Qayerda ishlaysiz?» ga qarab chiqadi.
// Saqlash: server orqali; botning pastki menyu tugmasidan ochilgan bo'lsa — botga ham (settingsParts.jsx submitProfile).
// Yuk beruvchi sozlamalari — ShipperSettings.jsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BODY_TYPES,
  CAPACITY_OPTIONS,
  FORM_SIDES,
  SIDE_LABELS,
  TRUCK_CLASSES,
  capacityRangeText,
  needsBodyType,
  profileRows,
  routeChosen,
  routeLabel,
  weightText,
} from "@yuk/shared";
import {
  capacityChoice,
  capacityKgOf,
  capacityUnit,
  classBody,
  formFromProfile,
  profileFromForm,
  selectClass,
  showSides,
  showSize,
  sizeSummary,
  toggle,
} from "./form.js";
import { OPEN_FROM_MENU, submitProfile, useScopeChoices } from "./settingsParts.jsx";
import { ProfileSummary, StepHeader, StepNav, useFormButtons, useSteps } from "./Steps.jsx";
import { canSendData, haptic, inTelegram, setUnsaved, showAlert } from "./telegram.js";
import { Chips, Section } from "./ui.jsx";

const fmt = (n) => String(n).replace(".", ",");

const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: capacityRangeText(t.capacityT), note: t.note }));
const BODY_OPTIONS = BODY_TYPES.filter((b) => b.form !== false).map((b) => ({ id: b.id, label: b.name, note: b.sub }));
const SIDE_OPTIONS = FORM_SIDES.map((id) => ({ id, label: SIDE_LABELS[id] }));
const className = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.name ?? "";
const dims = (b) => `${fmt(b.lengthM)} × ${fmt(b.widthM)} × ${fmt(b.heightM)} m`;

// Ro'yxatdan o'tish qadamlari: sections — shu qadamda ko'rinadigan bo'limlar (Section id)
const ALL_STEPS = [
  { id: "transport", title: "Transport", sections: ["class", "body", "capacity"] },
  { id: "olcham", title: "O'lcham", sections: ["size", "sides"] },
  { id: "tasdiq", title: "Tasdiqlash", sections: ["intl", "summary"] },
];
// O'lcham ham, yuklash tomoni ham kerak bo'lmasa (tyagach, sisterna, yengil mashina) — «O'lcham» qadami yo'q
export const driverSteps = (form) => (showSize(form) || showSides(form) ? ALL_STEPS : ALL_STEPS.filter((s) => s.id !== "olcham"));
// «Tekshiring» ro'yxatidagi qator → qaysi qadamga qaytadi
const ROW_STEP = { vehicle: "transport", size: "olcham", sides: "olcham" };

const STEP_LEAD = {
  olcham: "Kuzov o'lchami va yuklash tomoni: kub va palet bilan berilgan yuklarni aniqroq tanlash uchun.",
  tasdiq: "Oxirgi qadam: qayerda ishlashingizni belgilang, tekshiring va «Saqlash» ni bosing.",
};

function SizeInput({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" placeholder="0,0" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="unit">m</span>
    </label>
  );
}

// me — serverdagi foydalanuvchi (null — server bilan aloqa yo'q); initialProfile — bot manzilda bergan (?p=)
// scope — yo'nalish doirasi; onSaved(me) — server saqlagach; roleLine — «Siz: haydovchi · Rolni almashtirish» qatori
export function SettingsPage({ me, initialProfile, scope, onSaved, roleLine = null }) {
  const online = Boolean(me);
  const profile = me?.profile ?? initialProfile ?? null;
  const [registering] = useState(() => !profile); // ochilganda profil yo'q edi — qadamlar
  const [form, setForm] = useState(() => formFromProfile(profile));
  const [problem, setProblem] = useState(null); // { field, error }
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const initial = useRef(JSON.stringify(form));

  const { intl, intlOptions } = useScopeChoices(scope);
  const hasSize = showSize(form);
  const hasSides = showSides(form);
  const steps = useMemo(() => driverSteps({ truckClass: form.truckClass, bodyType: form.bodyType }), [form.truckClass, form.bodyType]);
  const stepOfField = useCallback((field) => Math.max(0, steps.findIndex((s) => s.sections.includes(field))), [steps]);

  useEffect(() => setUnsaved(JSON.stringify(form) !== initial.current), [form]);
  useEffect(() => () => setUnsaved(false), []);

  const update = (patch) => {
    setProblem(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const errorFor = (field) => (problem?.field === field ? problem.error : null);

  const showProblem = useCallback((result) => {
    haptic.error();
    setProblem(result);
    // Qadam almashgan bo'lsa, bo'lim hali chizilmagan — biroz kutib, o'shanga o'tamiz
    setTimeout(() => document.getElementById(result.field)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    if (inTelegram) showAlert(result.error);
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    const result = profileFromForm(form, scope);
    if (result.error) {
      showProblem(result);
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
  }, [form, scope, online, busy, onSaved, showProblem]);

  // «Keyingi» / «✅ Tayyor»: upTo-qadamgacha bo'lgan majburiy joylar to'ldirilganmi (keyingi qadamdagi xato — u yerga yetganda)
  const validate = useCallback(
    (upTo, go, index) => {
      const result = profileFromForm(form, scope);
      if (!result.error) return true;
      const at = stepOfField(result.field);
      if (at > upTo) return true;
      if (at !== index) go(at);
      showProblem(result);
      return false;
    },
    [form, scope, showProblem, stepOfField],
  );

  const wizard = useSteps(steps, { validate, onFinish: save });
  useFormButtons({ registering, wizard, save, busy });

  const show = (id) => !registering || wizard.step.sections.includes(id);
  const standard = classBody(form.truckClass);
  const summary = sizeSummary(form);
  const unit = capacityUnit(form.truckClass);
  const capacityKg = capacityKgOf(form.capacity, unit);
  const draft = registering && wizard.last ? profileFromForm(form, scope).profile : null;
  const firstName = me?.name?.split(/\s+/)[0];

  let lead = "Sozlamalarni o'zgartiring va «Saqlash» ni bosing.";
  if (registering) {
    lead =
      STEP_LEAD[wizard.step.id] ??
      `${firstName ? `Xush kelibsiz, ${firstName}!` : "Xush kelibsiz!"} Transportingizni belgilang — shunga mos yuklarni katta guruhlardan saralab, botga shaxsiy xabar qilib yuboramiz.`;
  }

  // «Bilmayman» va «Standart» — ikkalasida ham odatdagi o'lcham olinadi; farqi — haydovchi bilmasligini yozib qo'yamiz
  let sizeHint = "Yuk kubi va paleti kuzovga sig'adimi — shunga qarab tekshiramiz.";
  if (standard && form.sizeMode === "none") sizeHint = `Mayli — ${className(form.truckClass)} uchun odatdagi o'lcham olinadi: ${dims(standard)}.`;
  if (standard && form.sizeMode === "std") sizeHint = `${className(form.truckClass)} kuzovining odatdagi o'lchami: ${dims(standard)}.`;

  return (
    <>
      {registering && <StepHeader steps={steps} index={wizard.index} onJump={wizard.edit} />}
      <p className="lead">{lead}</p>

      {!online && inTelegram && !canSendData && <div className="notice">{OPEN_FROM_MENU}</div>}

      {show("class") && (
        <Section id="class" title="🚚 Transport turi" error={errorFor("class")}>
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
      )}

      {show("body") && needsBodyType(form.truckClass) && (
        <Section id="body" title="📦 Kuzov turi" error={errorFor("body")}>
          <Chips layout="list" options={BODY_OPTIONS} selected={(id) => form.bodyType === id} onPick={(id) => update({ bodyType: id })} />
        </Section>
      )}

      {show("capacity") && (
        <Section id="capacity" title="⚖️ Qancha yuk ko'taradi?" error={errorFor("capacity")}>
          {form.truckClass ? (
            <>
              <Chips
                options={(CAPACITY_OPTIONS[form.truckClass] ?? []).map((t) => ({ id: String(t), label: weightText(t) }))}
                selected={(id) => capacityKg === Math.round(Number(id) * 1000)}
                onPick={(id) => update({ capacity: capacityChoice(Number(id), unit) })}
              />
              <label className="field">
                <span>Boshqa son</span>
                <input inputMode="decimal" placeholder={unit === "kg" ? "masalan: 400" : "masalan: 7,5"} value={form.capacity} onChange={(e) => update({ capacity: e.target.value })} />
                <span className="unit">{unit}</span>
              </label>
            </>
          ) : (
            <p className="hint">Avval transport turini tanlang.</p>
          )}
        </Section>
      )}

      {show("size") && hasSize && (
        <Section id="size" title="📏 Kuzov ichki o'lchami" hint={sizeHint} error={errorFor("size")}>
          <Chips
            options={[
              ...(standard ? [{ id: "std", label: "Standart", sub: dims(standard) }] : []),
              { id: "custom", label: "O'zim yozaman" },
              ...(standard ? [{ id: "none", label: "Bilmayman", sub: "odatdagi o'lcham olinadi" }] : []),
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
              ≈ {fmt(summary.volumeM3)} kub{summary.pallets ? ` · ${summary.pallets} palet` : ""}
            </p>
          )}
        </Section>
      )}

      {show("sides") && hasSides && (
        <Section id="sides" title="↕️ Qaysi tomonidan yuklanadi?" hint="Bir nechtasini tanlang. O'ng va chap — mashinaga orqasidan qaraganda.">
          <Chips options={SIDE_OPTIONS} selected={(id) => form.loadingSides.includes(id)} onPick={(id) => update({ loadingSides: toggle(form.loadingSides, id) })} />
        </Section>
      )}

      {intl && show("intl") && (
        <Section id="intl" title="🌍 Qayerda ishlaysiz?" hint={`${intl.question} Botda «📋 Mos yuklar» ni bosganingizda shunga qarab viloyatlar va davlatlar chiqadi.`}>
          <Chips layout="list" options={intlOptions} selected={(id) => form.intl === id} onPick={(id) => update({ intl: id })} />
        </Section>
      )}

      {draft && (
        <ProfileSummary
          rows={profileRows(draft, scope, "haydovchi", { web: true }).filter((r) => r.id !== "intl")}
          stepOf={(id) => {
            const at = steps.findIndex((s) => s.id === ROW_STEP[id]);
            return at >= 0 ? at : null;
          }}
          onEdit={wizard.edit}
        />
      )}

      {/* Yo'nalish formada emas — botdagi «📋 Mos yuklar» da yoki web «📋 Yuklar» da (RoutePicker.jsx) */}
      {(registering ? wizard.last : true) && (
        <p className="hint route-note">
          📍 {!registering && routeChosen(profile) ? `Yo'nalish: ${routeLabel(profile)}. ` : ""}
          Qayerdan qayerga yuk kerakligini botdagi «📋 Mos yuklar» da yoki shu yerdagi «📋 Yuklar» bo'limida tanlaysiz — har
          safar o'zgartirsa bo'ladi.
        </p>
      )}

      {/* Sozlamalarda bu qator eng pastda (App.jsx, telefon raqamidan keyin), ro'yxatdan o'tishda — birinchi qadamda */}
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
