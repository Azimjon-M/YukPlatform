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

// Shahar selectidagi «Boshqa» tanlovi: ro'yxatda yo'q joy yoziladi (Azimjon, 2026-11-12: «selectda "Boshqa" tanlasa
// select input bo'lsin va yozsin»)
const OTHER = "__boshqa";

const withPhones = (form, phones) => ({ ...form, phones: phones.length ? phones.map(formatContactPhone).slice(0, SHIPPER_LOAD_PHONES) : [""] });

// Narx: holatda faqat raqam saqlanadi, ko'rinishda har 3 xonadan so'ng nuqta (Azimjon, 2026-11-12: «3000000 =>
// 3.000.000 — adashmaslik uchun»). Foydalanuvchi nuqta/bo'shlik yozsa yoki o'chirsa ham raqam buzilmaydi.
const groupPrice = (digits) => String(digits ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const groupDigitsOnly = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 11); // 11 xona = 10 mlrd chegarasi

// Joy: viloyat/davlat selecti + shahar/tuman selecti. Shahar ro'yxatda yo'q bo'lsa — «Boshqa»: tanlangach pastida
// yozish maydoni ochiladi. Ikkinchalasida ham ko'rinadigan label va izoh bor (Azimjon, 2026-11-12: «Label qo'sh va
// kiritish ixtiyoriy degan ma'noda desc yoz. placeholder yetarli emas!»).
// Ikki select qatorini chalkashtiradigan xatolardan himoya: «Shahar» selecti viloyat tanlanmaguncha o'chilgan holda
// turadi va unda nima tanlanayotgani yozib ko'rsatiladi (masalan «Toshkent viloyati: shahar, tuman»).
function Place({ side, form, areas, error, onChange }) {
  const area = form[side];
  const city = form[`${side}City`] ?? "";
  const cities = citiesOf(area);
  const title = side === "from" ? "📍 Yuk qayerdan olinadi?" : "🏁 Yuk qayerga boradi?";
  const areaLabel = side === "from" ? "Qayerdan" : "Qayerga";
  const areaTitle = side === "from" ? "Viloyat yoki davlat" : "Boradigan viloyat yoki davlat";
  // Ro'yxatda yo'q joy yozilgan bo'lsa (bot qoralamasi, eski yuk) — input darhol ochiq turadi
  const [manual, setManual] = useState(() => Boolean(city) && !cities.includes(city));
  // Viloyat almashtirilsa: eski shahar yangi viloyatga tegishli emas — tozalanadi, input yopiladi
  const pickArea = (value) => {
    setManual(false);
    onChange({ [side]: value, [`${side}City`]: "" });
  };
  const pickCity = (value) => {
    if (value === OTHER) {
      // Ro'yxatdan tanalgan shahar «Boshqa»ga o'tganda tozalanadi — foydalanuvchi yangi nomni yozadi
      if (city && cities.includes(city)) onChange({ [`${side}City`]: "" });
      setManual(true);
      return;
    }
    setManual(false);
    onChange({ [`${side}City`]: value });
  };
  // Ro'yxatdagi shahar tanlanganmi yoki «Boshqa» — select shuni ko'rsatadi. Bot qoralamasida yozilgan joy ro'yxatda
  // bo'lmasa ham input ochiq turadi (tanov holatiga asoslanmaymiz: holda bazadan kelgan qiymat yo'qolib qolardi)
  const otherTyped = Boolean(city) && cities.length > 0 && !cities.includes(city);
  const showInput = manual || otherTyped || Boolean(area && cities.length === 0);
  const showSelect = !showInput;
  const cityChoice = manual || otherTyped ? OTHER : city;

  return (
    <Section id={`lf-${side}`} title={title} error={error}>
      <label className="ctrl">
        <span className="ctrl-label">
          {areaTitle} <em className={area ? "ctrl-opt" : "ctrl-req"}>{area ? "tanlandi" : "majburiy"}</em>
        </span>
        <select value={area} onChange={(e) => pickArea(e.target.value)}>
          <option value="">— {areaLabel}ni tanlang —</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="ctrl-desc">Viloyat yoki davlatni tanlang — keyingi maydon shunga qarab to'ldiriladi.</span>
      </label>

      {/* Viloyat tanlanmaganda ham shahar maydoni ko'rinadi (o'chilgan holda) — «qayerga»ni «qayerdan»ga o'xshatib
          xato tanlash olmasligi uchun (Azimjon: «shahar/tuman tanlash selecti ba'zida aljirab ishlamoqda») */}
      {showSelect && (
        <label className="ctrl">
          <span className="ctrl-label">
            Shahar yoki tuman <em className="ctrl-opt">ixtiyoriy</em>
          </span>
          <select value={cityChoice} disabled={!area} onChange={(e) => pickCity(e.target.value)}>
            <option value="">{area ? `Aniqlasangiz — ${areaLabel} ichidan tanlang` : "Avval viloyatni tanlang"}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {area && <option value={OTHER}>➕ Boshqa shahar / tuman (yozaman)</option>}
          </select>
          <span className="ctrl-desc">Ixtiyoriy: tanlamasangiz butun viloyat bo'yicha izlanadi. Ro'yxatda bo'lmasa — «Boshqa» ni tanlab yozing.</span>
        </label>
      )}

      {showInput && (
        <label className="ctrl">
          <span className="ctrl-label">
            Shahar yoki tuman <em className="ctrl-opt">ixtiyoriy</em>
          </span>
          <input
            maxLength={SHIPPER_LOAD_LIMITS.city}
            placeholder="masalan: Chirchiq, Olmaliq yoki navoiy tumani"
            value={city}
            onChange={(e) => onChange({ [`${side}City`]: e.target.value })}
          />
          <span className="ctrl-desc">
            {cities.length
              ? "Ro'yxatda yo'q joy — nomini yozing (ixtiyoriy)."
              : area === "xorij"
                ? "Qaysi davlat va shahar bo'lsa, shuni yozing (ixtiyoriy)."
                : "Bu davlat uchun shahar yoki tumanni yozing (ixtiyoriy)."}
          </span>
          {/* Ro'yxatga qaytish — yozish maydoni ochilgan joylarda (qoralamadan kelgan nom ham tozalanadi) */}
          {showInput && cities.length > 0 && (
            <button type="button" className="link ctrl-back" onClick={() => { setManual(false); onChange({ [`${side}City`]: "" }); }}>
              ↩️ Ro'yxatdan tanlash
            </button>
          )}
        </label>
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
          {/* Har 3 xonadan so'ng nuqta (Azimjon, 2026-11-12: «3000000 => 3.000.000, adashmaslik uchun»).
              Holatda faqat raqam saqlanadi — nuqtalar faqat ko'rinishda, serverga toza son ketadi. */}
          <input
            inputMode="numeric"
            placeholder="masalan: 3.000.000"
            value={groupPrice(form.price)}
            onChange={(e) => update({ price: groupDigitsOnly(e.target.value) })}
          />
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
