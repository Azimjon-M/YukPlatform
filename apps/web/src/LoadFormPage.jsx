// «📦 Yuk berish» — yuk beruvchi o'z yukini mos haydovchilarga yuboradi (2026-11-10, Azimjon: «Forma va oddiy yozish
// bo'lsin … raqam ulashish emas balki raqam yozish kerak»). Botdagi «📦 Yuk berish» tugmasi shu sahifani ochadi (?v=yuk);
// botga yozilgan yukni «✏️ Formada tuzatish» bilan ochsa — ?d=1: forma o'sha qoralama bilan to'ldiriladi.
// Majburiy: qayerdan, qayerga, og'irligi, telefon (1–2 ta, YOZILADI; oxirgi yukdagisi yoki o'zi ulashgani tayyor turadi).
// Qolgani ixtiyoriy. Tekshiruv @yuk/shared sanitizeShipperLoad da — server ham, bot ham xuddi shu bilan tekshiradi.
// Yuborish: serverga (POST /pub/loads) → navbat → bot mos haydovchilarga yuboradi va natijani chatga yozadi.
// Server bilan aloqa yo'q, lekin botning pastki menyusidan ochilgan — botga sendData bilan (bot o'zi tekshiradi).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BODY_TYPES,
  COUNTRIES,
  CURRENCIES,
  PAYMENT_TYPES,
  PRICE_UNITS,
  REGIONS,
  SHIPPER_LOAD_LIMITS,
  SHIPPER_LOAD_PHONES,
  TRUCK_CLASSES,
  capacityRangeText,
  formatContactPhone,
  needsBodyType,
  sanitizeShipperLoad,
  shipperLoadAreas,
  shipperLoadText,
} from "@yuk/shared";
import { getLoadForm, postLoad } from "./api.js";
import { canSendData, closeApp, haptic, inTelegram, sendToBot, setUnsaved, showAlert, useMainButton } from "./telegram.js";
import { Chips, Notice, Section, Segmented, Spinner } from "./ui.jsx";

const EMPTY = {
  from: "",
  fromCity: "",
  to: "",
  toCity: "",
  cargo: "",
  weight: "",
  weightUnit: "tonna",
  truckClass: null,
  bodyType: null,
  vehicleCount: "",
  price: "",
  currency: "UZS",
  priceUnit: "reys",
  negotiable: false,
  payment: null,
  when: "",
  note: "",
  phones: [""],
};

const ANY = "*";
const CLASS_OPTIONS = [{ id: ANY, label: "Farqi yo'q" }, ...TRUCK_CLASSES.map((t) => ({ id: t.id, label: t.name, sub: capacityRangeText(t.capacityT) }))];
const BODY_OPTIONS = [{ id: ANY, label: "Farqi yo'q" }, ...BODY_TYPES.filter((b) => b.form !== false).map((b) => ({ id: b.id, label: b.name }))];
const CURRENCY_LABEL = { UZS: "so'm", USD: "$", RUB: "₽", KZT: "₸" };
const CURRENCY_OPTIONS = CURRENCIES.map((id) => ({ id, label: CURRENCY_LABEL[id] ?? id }));
const UNIT_OPTIONS = PRICE_UNITS.map((u) => ({ id: u.id, label: u.name }));
const PAYMENT_OPTIONS = PAYMENT_TYPES.map((p) => ({ id: p.id, label: p.name }));
const WHEN_OPTIONS = [
  { id: "Bugun", label: "Bugun" },
  { id: "Ertaga", label: "Ertaga" },
  { id: "Yuk tayyor", label: "Yuk tayyor" },
];
// Xato maydoni → qaysi bo'limni ko'rsatamiz
const SECTION_OF = { from: "lf-from", to: "lf-to", weight: "lf-cargo", vehicleCount: "lf-vehicle", price: "lf-price", phones: "lf-phones" };

// Shahar maslahatlari: viloyat — ro'yxatimizdagi shaharlar, davlat — uning shaharlari
function citiesOf(area) {
  return REGIONS.find((r) => r.id === area)?.cities ?? COUNTRIES.find((c) => c.name === area)?.cities ?? [];
}

const withPhones = (form, phones) => ({ ...form, phones: phones.length ? phones.map(formatContactPhone).slice(0, SHIPPER_LOAD_PHONES) : [""] });

function Place({ side, form, areas, error, onChange }) {
  const area = form[side];
  const cities = citiesOf(area);
  const listId = `lf-${side}-cities`;
  const title = side === "from" ? "📍 Yuk qayerdan olinadi?" : "🏁 Yuk qayerga boradi?";
  return (
    <Section id={`lf-${side}`} title={title} error={error}>
      <label className="select">
        <span className="sr-only">{side === "from" ? "Qayerdan" : "Qayerga"}</span>
        <select value={area} onChange={(e) => onChange({ [side]: e.target.value })}>
          <option value="">Viloyat yoki davlatni tanlang</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Shahar, tuman</span>
        <input
          list={cities.length ? listId : undefined}
          maxLength={SHIPPER_LOAD_LIMITS.city}
          placeholder="ixtiyoriy"
          value={form[`${side}City`]}
          onChange={(e) => onChange({ [`${side}City`]: e.target.value })}
        />
      </label>
      {cities.length > 0 && (
        <datalist id={listId}>
          {cities.map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>
      )}
    </Section>
  );
}

// me — serverdagi foydalanuvchi (null — server bilan aloqa yo'q); draft — botdagi qoralamani ochish (?d=1)
export function LoadFormPage({ me, scope, draft: wantDraft = false, onAuthLost }) {
  const online = Boolean(me);
  const areas = useMemo(() => shipperLoadAreas(scope), [scope]);
  const [form, setForm] = useState(() => withPhones(EMPTY, me?.loadPhones?.length ? me.loadPhones : me?.phone ? [me.phone] : []));
  const [info, setInfo] = useState(null); // { used, limit, phones }
  const [loading, setLoading] = useState(online);
  const [fromDraft, setFromDraft] = useState(false);
  const [error, setError] = useState(null); // { field, error }
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // yuborilgan yuk (muvaffaqiyat ekrani)
  const [outdated, setOutdated] = useState(false); // ilova yangi, server hali eski (qayta ishga tushirilmagan)
  const initial = useRef(JSON.stringify(form));

  // Serverdan: oxirgi raqamlar, 24 soatdagi son, botdagi qoralama (?d=1)
  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    getLoadForm()
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        const next = wantDraft && data.draft ? { ...EMPTY, ...data.draft, phones: data.draft.phones?.length ? data.draft.phones : data.phones } : { ...EMPTY, phones: data.phones };
        const filled = withPhones(next, next.phones);
        setForm(filled);
        setFromDraft(Boolean(wantDraft && data.draft));
        initial.current = JSON.stringify(filled);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.code === "auth") onAuthLost?.();
        else if (e.code === "outdated") setOutdated(true);
        else showAlert(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [online, wantDraft, onAuthLost]);

  useEffect(() => setUnsaved(!sent && JSON.stringify(form) !== initial.current), [form, sent]);
  useEffect(() => () => setUnsaved(false), []);

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setError((e) => (e && Object.keys(patch).some((k) => k === e.field || (e.field === "weight" && k === "weightUnit")) ? null : e));
  };

  const fail = useCallback((problem) => {
    haptic.error();
    setError(problem);
    const id = SECTION_OF[problem.field];
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    else showAlert(problem.error);
  }, []);

  const submit = useCallback(async () => {
    if (busy || sent) return;
    // Avval shu yerda (xato maydonni darhol ko'rsatish uchun); server baribir o'zi ham tekshiradi
    const local = sanitizeShipperLoad(form, { scope });
    if (local.error) return fail(local);
    const viaBot = () => {
      setUnsaved(false);
      sendToBot({ type: "load", load: form, fromDraft }); // bot chatda «qabul qilindi» deydi, Mini App yopiladi
    };
    if (!online) {
      if (canSendData) viaBot();
      else showAlert("Yuborish uchun formani botdagi pastki menyudan — «📦 Yuk berish» tugmasi bilan oching.");
      return;
    }
    setBusy(true);
    try {
      const { load } = await postLoad(form, { fromDraft });
      haptic.success();
      setUnsaved(false);
      setSent(load);
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.code === "auth") onAuthLost?.();
      else if (e.field) fail({ field: e.field, error: e.message });
      else if (e.code === "offline" && canSendData) viaBot();
      else {
        haptic.error();
        showAlert(e.message);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, sent, form, scope, fromDraft, online, fail, onAuthLost]);

  const again = () => {
    const fresh = withPhones(EMPTY, sent?.phones ?? []);
    setForm(fresh);
    initial.current = JSON.stringify(fresh);
    setSent(null);
    setFromDraft(false);
    setInfo((i) => (i ? { ...i, used: i.used + 1 } : i));
    window.scrollTo(0, 0);
  };

  useMainButton(busy ? "Yuborilyapti..." : "📤 Haydovchilarga yuborish", submit, inTelegram && !sent && !loading && (online || canSendData));

  if (loading) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }

  if (sent) {
    return (
      <Notice
        title="📤 Yuborildi"
        action={
          <div className="notice-actions">
            <button type="button" className="primary" onClick={again}>
              📦 Yana yuk berish
            </button>
            {inTelegram && (
              <button type="button" className="secondary" onClick={closeApp}>
                Yopish
              </button>
            )}
          </div>
        }
      >
        Yukingiz mos haydovchilarga ketyapti — nechtasiga yetganini bot chatda yozadi. Haydovchilar sizga o'zlari qo'ng'iroq
        qilishadi.
        <span className="sent-load">{shipperLoadText(sent)}</span>
      </Notice>
    );
  }

  const errorFor = (field) => (error?.field === field ? error.error : null);
  const phones = form.phones;
  const setPhone = (i, value) => update({ phones: phones.map((p, j) => (j === i ? value : p)) });
  const left = info ? info.limit - info.used : null;

  return (
    <>
      <p className="lead">
        Yukingizni yozing — mos haydovchilarga darhol boradi, ular sizga o'zlari qo'ng'iroq qilishadi.
        {left != null && left <= 5 && ` 24 soatda yana ${Math.max(left, 0)} ta yuk yubora olasiz.`}
      </p>
      {outdated && <div className="notice">⚠️ Yuk berish server qayta ishga tushirilgach ishlaydi. Hozircha yukingizni botga oddiy xabar qilib yozing.</div>}
      {fromDraft && <div className="notice">✏️ Botga yozganingizdan to'ldirildi — tekshiring, kerak bo'lsa tuzating.</div>}
      {!online && !canSendData && (
        <div className="notice">Server bilan aloqa yo'q. Formani botdagi pastki menyudan — «📦 Yuk berish» tugmasi bilan oching.</div>
      )}

      <Place side="from" form={form} areas={areas} error={errorFor("from")} onChange={update} />
      <Place side="to" form={form} areas={areas} error={errorFor("to")} onChange={update} />

      <Section id="lf-cargo" title="📦 Qanday yuk?" error={errorFor("weight")}>
        <label className="field">
          <span>Nima yuk</span>
          <input maxLength={SHIPPER_LOAD_LIMITS.cargo} placeholder="masalan: un, sement, mebel" value={form.cargo} onChange={(e) => update({ cargo: e.target.value })} />
        </label>
        <label className="field">
          <span>Og'irligi</span>
          <input
            inputMode="decimal"
            placeholder={form.weightUnit === "kg" ? "masalan: 500" : "masalan: 20"}
            value={form.weight}
            onChange={(e) => update({ weight: e.target.value })}
          />
          <span className="unit">{form.weightUnit === "kg" ? "kg" : "tonna"}</span>
        </label>
        <div className="field-under">
          <Segmented
            label="Og'irlik birligi"
            options={[
              { id: "tonna", label: "tonna" },
              { id: "kg", label: "kg" },
            ]}
            value={form.weightUnit}
            onChange={(weightUnit) => update({ weightUnit })}
          />
        </div>
      </Section>

      <Section id="lf-vehicle" title="🚚 Qanday transport kerak?" hint="Ixtiyoriy. Tanlansa — faqat shunday transport haydovchilariga boradi." error={errorFor("vehicleCount")}>
        <Chips
          options={CLASS_OPTIONS}
          selected={(id) => (id === ANY ? !form.truckClass : form.truckClass === id)}
          onPick={(id) => update({ truckClass: id === ANY ? null : id, ...(id !== ANY && !needsBodyType(id) ? { bodyType: null } : {}) })}
        />
        {(!form.truckClass || needsBodyType(form.truckClass)) && (
          <>
            <p className="group">Kuzov</p>
            <Chips options={BODY_OPTIONS} selected={(id) => (id === ANY ? !form.bodyType : form.bodyType === id)} onPick={(id) => update({ bodyType: id === ANY ? null : id })} />
          </>
        )}
        <label className="field">
          <span>Mashina soni</span>
          <input inputMode="numeric" placeholder="1" value={form.vehicleCount} onChange={(e) => update({ vehicleCount: e.target.value })} />
        </label>
      </Section>

      <Section id="lf-price" title="💰 Narxi" hint="Ixtiyoriy. Yozilmasa — «narx kelishiladi»." error={errorFor("price")}>
        <label className="field">
          <span>Narx</span>
          <input inputMode="numeric" placeholder="masalan: 3 000 000" value={form.price} onChange={(e) => update({ price: e.target.value })} />
          <span className="unit">{CURRENCY_LABEL[form.currency]}</span>
        </label>
        <div className="field-under">
          <Segmented label="Valyuta" options={CURRENCY_OPTIONS} value={form.currency} onChange={(currency) => update({ currency })} />
        </div>
        <Chips options={UNIT_OPTIONS} selected={(id) => form.priceUnit === id} onPick={(priceUnit) => update({ priceUnit })} />
        <p className="group">To'lov</p>
        <Chips
          options={[{ id: "kel", label: "🤝 Kelishiladi" }, ...PAYMENT_OPTIONS]}
          selected={(id) => (id === "kel" ? form.negotiable : form.payment === id)}
          onPick={(id) => (id === "kel" ? update({ negotiable: !form.negotiable }) : update({ payment: form.payment === id ? null : id }))}
        />
      </Section>

      <Section id="lf-when" title="📅 Qachon yuklanadi?" hint="Ixtiyoriy.">
        <Chips options={WHEN_OPTIONS} selected={(id) => form.when === id} onPick={(when) => update({ when: form.when === when ? "" : when })} />
        <label className="field">
          <span>Yoki yozing</span>
          <input maxLength={SHIPPER_LOAD_LIMITS.when} placeholder="masalan: 12-noyabr ertalab" value={form.when} onChange={(e) => update({ when: e.target.value })} />
        </label>
      </Section>

      <Section id="lf-phones" title="📞 Haydovchilar qaysi raqamga qo'ng'iroq qilsin?" hint="Raqamni yozing — o'zingizniki yoki dispetcheringizniki." error={errorFor("phones")}>
        {phones.map((phone, i) => (
          <label key={i} className="field">
            <span>{phones.length > 1 ? `${i + 1}-raqam` : "Raqam"}</span>
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(i, e.target.value)} />
            {phones.length > 1 && (
              <button type="button" className="link" aria-label={`${i + 1}-raqamni olib tashlash`} onClick={() => update({ phones: phones.filter((_, j) => j !== i) })}>
                ✕
              </button>
            )}
          </label>
        ))}
        {phones.length < SHIPPER_LOAD_PHONES && (
          <button type="button" className="link add-phone" onClick={() => update({ phones: [...phones, ""] })}>
            + Yana bitta raqam
          </button>
        )}
      </Section>

      <Section id="lf-note" title="📝 Izoh" hint="Ixtiyoriy: yuklash sharti, manzil, boshqa narsa.">
        <label className="field area">
          <span className="sr-only">Izoh</span>
          <textarea rows={3} maxLength={SHIPPER_LOAD_LIMITS.note} value={form.note} onChange={(e) => update({ note: e.target.value })} />
        </label>
      </Section>

      {/* Sahifa oxirida (yopishqoq emas): pastdagi bo'limlar qatori uni yopib qo'ymasin */}
      {!inTelegram && (
        <div className="footer static">
          <button type="button" className="save" onClick={submit} disabled={busy || !online}>
            {busy ? "Yuborilyapti..." : "📤 Haydovchilarga yuborish"}
          </button>
        </div>
      )}
    </>
  );
}
