// Haydovchi: «🎛 Filtr» bo'limi (App.jsx; 2026-11-27 dan botda emas, faqat shu yerda) — yuklarni qanday olishi (rejim),
// mashina turi, qayerdan, guruhlar (🌍 Global / 👤 Akkauntimdagi — FeedGroups.jsx), transporti va qayerda ishlashi.
//   Birinchi marta (profil yo'q) — ro'yxatdan o'tish: Rejim → (Guruhlar) → Transport → O'lcham → Tasdiqlash (Steps.jsx).
//   Rejim (@yuk/shared feed.js, 2026-11-14): «🎯 Saralangan» — hozirgidek; «⚡ Tezkor» va «📌 Mening guruhlarim» da mashina
//   so'ralmaydi (Rejim → (Guruhlar) → Tasdiqlash); «Guruhlarim + saralangan» — guruhlar ham, mashina ham.
//   Tyagach, sisterna va yengil mashinada «O'lcham» qadami yo'q (o'lcham va yuklash tomoni kerak emas).
//   Keyin — hamma bo'lim bitta sahifada (bitta joyni tez o'zgartirish uchun).
// Yo'nalish (qayerdan → qayerga) bu yerda so'ralmaydi (Azimjon, 2026-11-07: haydovchi har kuni boshqa joyda bo'ladi) —
// botda «📋 Mos yuklar» bosilganda tanlanadi; viloyatlar va davlatlar shu yerdagi «Qayerda ishlaysiz?» ga qarab chiqadi.
// Saqlash: server orqali; botning pastki menyu tugmasidan ochilgan bo'lsa — botga ham (settingsParts.jsx submitProfile).
// Yuk beruvchida sozlamalar (bo'sh mashinalar uchun) yo'q — 2026-11-27.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BODY_TYPES,
  CAPACITY_OPTIONS,
  FEED_MODES,
  REGIONS,
  FEED_MODE_CHOICES,
  FORM_SIDES,
  SIDE_LABELS,
  TRUCK_CLASSES,
  TRUCK_FILTERS,
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
  formNeedsVehicle,
  formUsesGroups,
  formUsesFilters,
  toggleFeedRegion,
  toggleFeedTruck,
  manyClassesPicked,
  profileFromForm,
  selectFeed,
  toggleFeedSource,
  toggleClass,
  showSides,
  showSize,
  sizeSummary,
  toggle,
} from "./form.js";
import { FeedGroups, sourceNamer } from "./FeedGroups.jsx";
import { OPEN_FROM_MENU, submitProfile, useScopeChoices } from "./settingsParts.jsx";
import { ProfileSummary, StepHeader, StepNav, useFormButtons, useSteps } from "./Steps.jsx";
import { canSendData, haptic, inTelegram, setUnsaved, showAlert } from "./telegram.js";
import { Chips, Section } from "./ui.jsx";

const fmt = (n) => String(n).replace(".", ",");

const CLASS_OPTIONS = TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: capacityRangeText(t.capacityT), note: t.note }));
const BODY_OPTIONS = BODY_TYPES.filter((b) => b.form !== false).map((b) => ({ id: b.id, label: b.name, note: b.sub }));
const SIDE_OPTIONS = FORM_SIDES.map((id) => ({ id, label: SIDE_LABELS[id] }));
// 2026-11-19: saralash olib tashlandi — faqat ⚡ Tezkor va 📌 Mening guruhlarim
const REGION_OPTIONS = REGIONS.map((r) => ({ id: r.id, label: r.name }));
const TRUCK_OPTIONS = TRUCK_FILTERS.map((t) => ({ id: t.id, label: `${t.icon} ${t.name}` }));
const FEED_OPTIONS = FEED_MODE_CHOICES.map((id) => ({ id, label: `${FEED_MODES[id].icon} ${FEED_MODES[id].name}`, note: FEED_MODES[id].about }));
const className = (id) => TRUCK_CLASSES.find((t) => t.id === id)?.name ?? "";
const dims = (b) => `${fmt(b.lengthM)} × ${fmt(b.widthM)} × ${fmt(b.heightM)} m`;

// Ro'yxatdan o'tish qadamlari: sections — shu qadamda ko'rinadigan bo'limlar (Section id)
const ALL_STEPS = [
  { id: "rejim", title: "Rejim", sections: ["feed"] },
  { id: "guruhlar", title: "Guruhlar", sections: ["groups"] },
  { id: "filtr", title: "Filtr", sections: ["trucks", "regions"] },
  { id: "transport", title: "Transport", sections: ["class", "body", "capacity"] },
  { id: "olcham", title: "O'lcham", sections: ["size", "sides"] },
  { id: "tasdiq", title: "Tasdiqlash", sections: ["intl", "summary"] },
];
// Qadamlar rejimga va transportga qarab: guruhsiz rejimda «Guruhlar» yo'q, mashinasiz rejimda «Transport» va «O'lcham» yo'q;
// o'lcham ham, yuklash tomoni ham kerak bo'lmasa (tyagach, sisterna, yengil mashina) — «O'lcham» qadami yo'q
export function driverSteps(form) {
  const vehicle = formNeedsVehicle(form);
  return ALL_STEPS.filter((s) => {
    if (s.id === "guruhlar") return formUsesGroups(form);
    if (s.id === "filtr") return formUsesFilters(form);
    if (s.id === "transport") return vehicle;
    if (s.id === "olcham") return vehicle && (showSize(form) || showSides(form));
    return true;
  });
}
// «Tekshiring» ro'yxatidagi qator → qaysi qadamga qaytadi
const ROW_STEP = { feed: "rejim", groups: "guruhlar", regions: "filtr", trucks: "filtr", vehicle: "transport", size: "olcham", sides: "olcham" };

const STEP_LEAD = {
  guruhlar: "Qaysi guruh va kanallardagi yuk e'lonlari sizga darhol kelsin — belgilang.",
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
  const [groupList, setGroupList] = useState([]); // «Tekshiring» da guruh nomlari (sarlavha) uchun
  const initial = useRef(JSON.stringify(form));

  const { intl, intlOptions } = useScopeChoices(scope);
  const hasSize = showSize(form);
  const hasSides = showSides(form);
  const many = manyClassesPicked(form);
  const needVehicle = formNeedsVehicle(form);
  const usesGroups = formUsesGroups(form);
  const sorted = FEED_MODES[form.feed]?.sorted ?? true;
  const steps = useMemo(
    () => driverSteps({ truckClass: form.truckClass, bodyType: form.bodyType, feed: form.feed }),
    [form.truckClass, form.bodyType, form.feed],
  );
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

  // Mashinasiz rejimda transport va «Qayerda ishlaysiz?» bo'limlari yashiriladi (ular saralashda ishlatiladi) — eski mashina
  // formada qoladi va saqlanadi (saralanganga qaytsa qayta so'ralmaydi)
  const VEHICLE_SECTIONS = ["class", "body", "capacity", "size", "sides", "intl"];
  const show = (id) => {
    if (id === "groups" && !usesGroups) return false;
    if ((id === "regions" || id === "trucks") && !formUsesFilters(form)) return false;
    if (VEHICLE_SECTIONS.includes(id) && !needVehicle) return false;
    return !registering || wizard.step.sections.includes(id);
  };
  const scrollToGroups = () =>
    setTimeout(() => {
      const el = document.getElementById("groups");
      if (!el) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
    }, 80);
  const pickGroup = (name) => {
    const result = toggleFeedSource(form, name, me?.plan ?? null); // obuna limiti: Free 30, Pro 100, Max 300
    if (result.error) {
      haptic.error();
      showAlert(result.error);
      return;
    }
    setProblem(null);
    setForm(result.form);
  };
  const standard = classBody(form.truckClass);
  const summary = sizeSummary(form);
  const unit = capacityUnit(form.truckClass);
  const capacityKg = capacityKgOf(form.capacity, unit);
  const draft = registering && wizard.last ? profileFromForm(form, scope).profile : null;
  const firstName = me?.name?.split(/\s+/)[0];

  let lead = "Qaysi yuklar kelsin — tanlang va «Saqlash» ni bosing.";
  if (registering) {
    const hello = firstName ? `Xush kelibsiz, ${firstName}!` : "Xush kelibsiz!";
    lead =
      (wizard.step.id === "tasdiq" && !needVehicle ? "Oxirgi qadam: tekshiring va «Saqlash» ni bosing." : null) ??
      STEP_LEAD[wizard.step.id] ??
      (wizard.step.id === "rejim"
        ? `${hello} Avval yuklarni qanday olishni tanlang — keyin istalgan payt o'zgartirasiz.`
        : "Transportingizni belgilang — shunga mos yuklarni katta guruhlardan saralab, botga shaxsiy xabar qilib yuboramiz.");
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

      {show("feed") && (
        <Section id="feed" title="🎛 Qaysi e'lonlar kelsin?" hint="Yuk e'lonlari guruhda chiqishi bilan keladi, quruq gap tashlanadi." error={errorFor("feed")}>
          <Chips
            layout="list"
            options={FEED_OPTIONS}
            selected={(id) => form.feed === id}
            onPick={(id) => {
              setProblem(null);
              setForm((f) => selectFeed(f, id));
              // Bir sahifali filtrda: guruh rejimi tanlansa — ro'yxat chizilgach unga silliq suriladi
              if (!registering && FEED_MODES[id]?.groups) scrollToGroups();
            }}
          />
        </Section>
      )}

      {/* Guruhlar — rejim ostida (2026-11-27, Azimjon: «Faqat mening guruhlarimdan» tanlansa guruh tanlash pastda qolib
          topilmasdi); rejim tanlanganda shu bo'limga silliq suriladi */}
      {show("groups") && (
        <FeedGroups online={online} chosen={form.feedSources} onToggle={pickGroup} error={errorFor("groups")} onList={setGroupList} />
      )}

      {show("trucks") && (
        <Section id="trucks" title="🚚 Qaysi transport uchun?" hint="Belgilamasangiz — hammasi keladi. E'londa mashina turi yozilmagan bo'lsa ham — baribir keladi." error={errorFor("trucks")}>
          <Chips
            layout="list"
            check
            options={TRUCK_OPTIONS}
            selected={(id) => (form.feedTrucks ?? []).includes(id)}
            onPick={(id) => {
              setProblem(null);
              setForm((f) => toggleFeedTruck(f, id));
            }}
          />
        </Section>
      )}

      {show("regions") && (
        <Section id="regions" title="📍 Qaysi viloyat(lar)dan?" hint="Belgilamasangiz — hamma joydan. E'londa joy aniqlanmasa ham — baribir keladi." error={errorFor("regions")}>
          <Chips
            layout="list"
            check
            options={REGION_OPTIONS}
            selected={(id) => (form.feedRegions ?? []).includes(id)}
            onPick={(id) => {
              setProblem(null);
              setForm((f) => toggleFeedRegion(f, id));
            }}
          />
        </Section>
      )}

      {show("class") && (
        <Section
          id="class"
          title="🚚 Transport turi"
          hint={
            many
              ? "Bir nechta transport belgilandi — kuzov turi va sig'im so'ralmaydi, hammasiga mos yuklar keladi."
              : "Bir nechtasini belgilash mumkin — masalan: Isuzu, Kichik yuk mashinasi va Labo."
          }
          error={errorFor("class")}
        >
          <Chips
            layout="list"
            check
            options={CLASS_OPTIONS}
            selected={(id) => form.truckClasses.includes(id)}
            onPick={(id) => {
              setProblem(null);
              setForm((f) => toggleClass(f, id));
            }}
          />
        </Section>
      )}

      {show("body") && form.truckClass && needsBodyType(form.truckClass) && (
        <Section id="body" title="📦 Kuzov turi" error={errorFor("body")}>
          <Chips layout="list" options={BODY_OPTIONS} selected={(id) => form.bodyType === id} onPick={(id) => update({ bodyType: id })} />
        </Section>
      )}

      {show("capacity") && !many && (
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
          rows={profileRows(draft, scope, "haydovchi", { web: true, sourceName: sourceNamer(groupList) }).filter((r) => r.id !== "intl")}
          stepOf={(id) => {
            const at = steps.findIndex((s) => s.id === ROW_STEP[id]);
            return at >= 0 ? at : null;
          }}
          onEdit={wizard.edit}
        />
      )}

      {/* Yo'nalish formada emas — botdagi «📋 Mos yuklar» da yoki web «📋 Yuklar» da (RoutePicker.jsx) */}
      {sorted && (registering ? wizard.last : true) && (
        <p className="hint route-note">
          📍 {!registering && routeChosen(profile) ? `Yo'nalish: ${routeLabel(profile)}. ` : ""}
          Qayerdan qayerga yuk kerakligini botdagi «📋 Mos yuklar» da yoki shu yerdagi «📋 Yuklar» bo'limida tanlaysiz — har
          safar o'zgartirsa bo'ladi.
        </p>
      )}

      {/* Bu qator «⚙️ Sozlamalar» da (App.jsx, telefon raqamidan keyin), ro'yxatdan o'tishda — shu yerda, birinchi qadamda */}
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
