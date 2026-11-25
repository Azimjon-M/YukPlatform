// Sozlamalar ostida: «📱 Ilova» — Android ilovani yuklab olish (Azimjon, 2026-11-25: «miniApp da sozlamalar ichida App
// section qo'sh va yuklab olish qil»). APK serverda yig'iladi (YukApp), versiyasi /pub/app dan. Telegram ichida havola
// tashqi brauzerda ochiladi (openLink) — Telegram oynasining o'zida fayl yuklanmaydi. Fayl bo'lmasa bo'lim ko'rinmaydi.
import { useEffect, useState } from "react";
import { API_URL, getAppRelease } from "./api.js";
import { openExternal } from "./telegram.js";
import { Section } from "./ui.jsx";

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function AppCard() {
  const [android, setAndroid] = useState(null);
  useEffect(() => {
    let alive = true;
    getAppRelease()
      .then((data) => alive && setAndroid(data?.android ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!android) return null;
  const url = new URL(`${API_URL}${android.url}`, window.location.href).href;
  return (
    <Section
      id="ilova"
      title="📱 Ilova"
      hint="Yuk Ekspert Android ilovasi: e'lonlar lentasi va telefonga bildirishnoma. Telefon «noma'lum manbadan o'rnatish» ga ruxsat so'rasa — ruxsat bering. Yangi versiya eskisining ustidan o'rnatiladi."
    >
      <p className="app-version">
        🤖 Android · versiya <b>{android.version}</b> · {mb(android.size)}
      </p>
      <button type="button" className="secondary" onClick={() => openExternal(url)}>
        ⬇️ Yuklab olish
      </button>
    </Section>
  );
}
