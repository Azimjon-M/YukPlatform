// Android ilova (YukApp) — eng so'nggi APK. Serverda yig'iladi (/data/ops/yukapp-release.sh) va shu papkaga qo'yiladi:
//   data/apk/latest.json        { version, versionCode, file, size, sha256, builtAt }
//   data/apk/<file>             yuk-ekspert-<versiya>.apk
// Botdagi /ilovalar va Mini App «⚙️ Sozlamalar → 📱 Ilova» shu yerdan yuklab oladi (Telegram botga 25 MB dan katta fayl
// sig'maydi — Azimjon, 2026-11-25). Fayl har so'rovda o'qiladi: yangi versiya qo'yilsa, server qayta yoqilmaydi.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const APK_PATH = "/pub/app/android"; // yuklab olish manzili (kirishsiz)

export function readRelease(dir) {
  try {
    const info = JSON.parse(readFileSync(path.join(dir, "latest.json"), "utf8"));
    const file = path.basename(String(info.file ?? "")); // faqat shu papkadagi fayl
    if (!/\.apk$/i.test(file) || !existsSync(path.join(dir, file))) return null;
    return {
      version: String(info.version ?? ""),
      versionCode: Number(info.versionCode) || 0,
      file,
      size: Number(info.size) || 0,
      sha256: typeof info.sha256 === "string" ? info.sha256 : null,
      builtAt: info.builtAt ?? null,
    };
  } catch {
    return null;
  }
}

// «24.6 MB»
export const sizeText = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
