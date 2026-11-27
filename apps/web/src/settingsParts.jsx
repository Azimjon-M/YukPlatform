// Haydovchi va yuk beruvchi sozlamalari uchun umumiy bo'laklar: joy tanlash, doiraga qarab davlatlar, saqlash.
import { useMemo } from "react";
import { REGIONS, intlChoices, regionLabel, scopeCountries } from "@yuk/shared";
import { saveProfile } from "./api.js";
import { toggle } from "./form.js";
import { canSendData, inTelegram, sendToBot, showAlert } from "./telegram.js";
import { Chips } from "./ui.jsx";

const REGION_OPTIONS = REGIONS.filter((r) => r.id !== "xorij").map((r) => ({ id: r.id, label: regionLabel(r.id) }));

// Viloyatlar (va xalqaro bo'lsa — doiradagi davlatlar). Hech biri tanlanmasa — hammasi.
export function Areas({ values, allLabel, international, countries, abroadTitle, onChange }) {
  const pick = (id) => onChange(id === "*" ? [] : toggle(values, id));
  const selected = (id) => (id === "*" ? values.length === 0 : values.includes(id));
  return (
    <>
      <Chips options={[{ id: "*", label: allLabel }, ...REGION_OPTIONS]} selected={selected} onPick={pick} />
      {international && (
        <>
          <p className="group">{abroadTitle}</p>
          <Chips options={countries} selected={selected} onPick={pick} />
        </>
      )}
    </>
  );
}

// Yo'nalish doirasi: qaysi davlatlarni tanlash mumkin ("ichki" doirada xalqaro savoli yo'q — intl null)
export function useScopeChoices(scope) {
  return useMemo(() => {
    const intl = intlChoices(scope);
    return {
      intl,
      intlOptions: intl ? Object.entries(intl.options).map(([id, o]) => ({ id, label: o.label })) : [],
      countries: [
        { id: "xorij", label: scope === "hammasi" ? "Istalgan davlat" : "Istalgan qo'shni davlat" },
        ...scopeCountries(scope).map((name) => ({ id: name, label: name })),
      ],
      abroadTitle: scope === "hammasi" ? "Xorij" : "Qo'shni davlatlar",
    };
  }, [scope]);
}

export const OPEN_FROM_MENU = "Saqlash uchun formani botdagi pastki menyudan — «🎛 Filtr» yoki «⚙️ Sozlamalar» tugmasi bilan oching.";

// Saqlash: server bilan aloqa bo'lsa — server orqali (istalgan joydan ochilganda ham ishlaydi).
// Botning pastki menyu tugmasidan ochilgan bo'lsa (canSendData) — keyin botga ham sendData bilan yuboriladi:
// bot chatda «✅ Saqlandi» deb javob beradi, menyuni yangilaydi («🚚 Ro'yxatdan o'tish» → «⚙️ Sozlamalar»), birinchi
// marta bo'lsa raqam so'raydi; Mini App o'zi yopiladi. Server bilan aloqa yo'q bo'lsa — faqat botga.
// → { me?, sent? } (me — server saqladi, sent — botga ketdi) | { preview } (oddiy brauzer, server yo'q) | {}
export async function submitProfile({ online, role, profile }) {
  const payload = { type: "profile", role, profile };
  if (online) {
    try {
      const me = await saveProfile(profile, role);
      if (canSendData) sendToBot(payload);
      return { me, sent: canSendData };
    } catch (error) {
      // Server javob bermadi, lekin bot bor — sozlamalar baribir saqlanadi (bot o'zi tekshiradi)
      if (error.code !== "offline" || !canSendData) throw error;
    }
  }
  if (canSendData) {
    sendToBot(payload);
    return { sent: true };
  }
  if (inTelegram) {
    showAlert(OPEN_FROM_MENU);
    return {};
  }
  return { preview: profile };
}
