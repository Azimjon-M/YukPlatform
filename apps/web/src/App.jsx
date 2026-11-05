// Mini App: haydovchining mashinasi va yo'nalishi — bitta sahifali forma.
// Bot formani o'z menyusidagi tugma bilan ochadi (hozirgi sozlamalar ?p= ichida), "Saqlash" ma'lumotni botga qaytaradi.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BODY_TYPES,
  CAPACITY_OPTIONS,
  LOADING_SIDES,
  MODE_OPTIONS,
  REGIONS,
  SIDE_LABELS,
  TRUCK_CLASSES,
  decodeProfile,
  intlChoices,
  regionLabel,
  scopeCountries,
  validRouteScope,
} from "@yuk/shared";
import { classBody, formFromProfile, profileFromForm, selectClass, sizeSummary, toggle } from "./form.js";
import { canSave, haptic, inTelegram, sendToBot, setUnsaved, showAlert, useMainButton } from "./telegram.js";

const params = new URLSearchParams(window.location.search);
// Yo'nalish doirasi (bot .env dagi ROUTE_SCOPE ni ?s= bilan beradi): qaysi davlatlarni tanlash mumkin
const scope = validRouteScope(params.get("s"));
const initialProfile = decodeProfile(params.get("p"), { scope });
const fmt = (n) => String(n).replace(".", ",");
const number = (text) => Number(String(text).trim().replace(",", "."));

const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: `${fmt(t.capacityT[0])}–${fmt(t.capacityT[1])} t` }));
const BODY_OPTIONS = BODY_TYPES.map((b) => ({ id: b.id, label: b.name }));
const SIDE_OPTIONS = LOADING_SIDES.map((s) => ({ id: s.id, label: SIDE_LABELS[s.id] }));
const INTL = intlChoices(scope); // "ichki" doirada null — savol ko'rsatilmaydi
const INTL_CHOICES = INTL ? Object.entries(INTL.options).map(([id, o]) => ({ id, label: o.label })) : [];
const MODE_CHOICES = Object.entries(MODE_OPTIONS).map(([id, label]) => ({ id, label }));
const REGION_OPTIONS = REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) }));
const COUNTRY_OPTIONS = [
  { id: "xorij", label: scope === "hammasi" ? "Istalgan davlat" : "Istalgan qo'shni davlat" },
  ...scopeCountries(scope).map((name) => ({ id: name, label: name })),
];

function Section({ id, title, hint, error, children }) {
  return (
    <section id={id} className={`section${error ? " invalid" : ""}`}>
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Tanlov tugmalari: selected(id) — tanlanganmi, onPick(id) — bosilganda
function Chips({ options, selected, onPick, layout = "wrap" }) {
  return (
    <div className={`chips ${layout}`}>
      {options.map((o) => {
        const on = selected(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => {
              haptic.select();
              onPick(o.id);
            }}
          >
            <span>{o.label}</span>
            {o.sub && <small>{o.sub}</small>}
          </button>
        );
      })}
    </div>
  );
}

// Viloyatlar (va xalqaro bo'lsa — doiradagi davlatlar). Hech biri tanlanmasa — hammasi.
function Areas({ values, allLabel, international, onChange }) {
  const pick = (id) => onChange(id === "*" ? [] : toggle(values, id));
  const selected = (id) => (id === "*" ? values.length === 0 : values.includes(id));
  return (
    <>
      <Chips options={[{ id: "*", label: allLabel }, ...REGION_OPTIONS]} selected={selected} onPick={pick} />
      {international && (
        <>
          <p className="group">{scope === "hammasi" ? "Xorij" : "Qo'shni davlatlar"}</p>
          <Chips options={COUNTRY_OPTIONS} selected={selected} onPick={pick} />
        </>
      )}
    </>
  );
}

function SizeInput({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" placeholder="0,0" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="unit">m</span>
    </label>
  );
}

export function App() {
  const [form, setForm] = useState(() => formFromProfile(initialProfile));
  const [problem, setProblem] = useState(null); // { field, error }
  const [preview, setPreview] = useState(null);
  const initial = useRef(JSON.stringify(form));

  useEffect(() => setUnsaved(JSON.stringify(form) !== initial.current), [form]);

  const update = (patch) => {
    setProblem(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const errorFor = (field) => (problem?.field === field ? problem.error : null);

  const save = useCallback(() => {
    const result = profileFromForm(form, scope);
    if (result.error) {
      haptic.error();
      setProblem(result);
      document.getElementById(result.field)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (inTelegram) showAlert(result.error);
      return;
    }
    if (canSave) {
      haptic.success();
      sendToBot({ type: "profile", profile: result.profile });
    } else if (inTelegram) {
      showAlert("Saqlash uchun formani botdagi pastki menyudan — «⚙️ Sozlamalar» tugmasi bilan oching.");
    } else {
      // Oddiy brauzer (sinov): botga ketadigan ma'lumotni ko'rsatamiz
      setPreview(result.profile);
    }
  }, [form]);

  useMainButton("Saqlash", save);

  const standard = classBody(form.truckClass);
  const summary = sizeSummary(form);
  const international = Boolean(INTL?.options[form.intl]?.international);

  return (
    <main>
      <header className="top">
        <h1>🚛 Yuk Ekspert</h1>
        <p>
          {initialProfile
            ? "Sozlamalarni o'zgartiring va «Saqlash» ni bosing."
            : "Mashinangiz va yo'nalishingizni belgilang — mos yuklarni shaxsiy xabarda yuboramiz."}
        </p>
      </header>

      {!inTelegram && (
        <div className="notice">Bu forma Telegram ichida, botning pastki menyusidan ochiladi. Hozir sinov rejimi.</div>
      )}
      {inTelegram && !canSave && (
        <div className="notice">Saqlash uchun formani botdagi pastki menyudan — «⚙️ Sozlamalar» tugmasi bilan oching.</div>
      )}

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

      {INTL && (
        <Section id="intl" title="🌍 Qayerda ishlaysiz?" hint={INTL.question}>
          <Chips layout="list" options={INTL_CHOICES} selected={(id) => form.intl === id} onPick={(id) => update({ intl: id })} />
        </Section>
      )}

      <Section id="from" title="📍 Qayerdan yuk olasiz?" hint="Bir nechtasini tanlash mumkin.">
        <Areas values={form.fromAreas} allLabel="Hamma joy" international={international} onChange={(fromAreas) => update({ fromAreas })} />
      </Section>

      <Section id="to" title="🏁 Qayerga borasiz?" hint="Masalan, uyga qaytish yuki uchun o'z viloyatingiz.">
        <Areas values={form.toAreas} allLabel="Istalgan joy" international={international} onChange={(toAreas) => update({ toAreas })} />
      </Section>

      <Section id="mode" title="👁 Qaysi yuklarni yuboraylik?">
        <Chips layout="list" options={MODE_CHOICES} selected={(id) => form.mode === id} onPick={(id) => update({ mode: id })} />
      </Section>

      {!inTelegram && (
        <div className="footer">
          <button type="button" className="save" onClick={save}>
            Saqlash
          </button>
          {preview && <pre className="preview">{JSON.stringify(preview, null, 2)}</pre>}
        </div>
      )}
    </main>
  );
}
