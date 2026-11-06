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

export const OPEN_FROM_MENU = "Saqlash uchun formani botdagi pastki menyudan — «⚙️ Sozlamalar» tugmasi bilan oching.";

// Saqlash: server bilan aloqa bo'lsa — server orqali (istalgan joydan ochilganda ham ishlaydi);
// bo'lmasa, Telegram ichida — botga sendData bilan (faqat pastki menyudagi tugmadan ochilganda).
// → { me } (server saqladi) | { sent: true } (botga ketdi, Mini App yopiladi) | { preview } (oddiy brauzer, server yo'q) | {}
export async function submitProfile({ online, role, profile }) {
  if (online) return { me: await saveProfile(profile, role) };
  if (canSendData) {
    sendToBot({ type: "profile", role, profile });
    return { sent: true };
  }
  if (inTelegram) {
    showAlert(OPEN_FROM_MENU);
    return {};
  }
  return { preview: profile };
}
