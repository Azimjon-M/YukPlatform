// Telegram'ga kirishdagi xatolar: qaysi birida qayta so'rash mumkin, qaysi birida to'xtash kerak.
// GramJS onError'dan true qaytsa kirishni to'xtatadi, false qaytsa savolni qayta beradi.

export const MAX_RETRIES = 3;

// Qayta so'rasa bo'ladigan xatolar (foydalanuvchi noto'g'ri yozgan)
const RETRYABLE = {
  PHONE_NUMBER_INVALID: "Telefon raqam noto'g'ri. +998XXXXXXXXX ko'rinishida qayta kiriting.",
  PHONE_CODE_INVALID: "Kod noto'g'ri. Qayta kiriting.",
  PHONE_CODE_EMPTY: "Kod bo'sh. Qayta kiriting.",
  PASSWORD_HASH_INVALID: "2FA parol noto'g'ri. Qayta kiriting.",
};

// Qayta so'rashdan foyda yo'q
const FATAL = {
  PHONE_CODE_EXPIRED: "Kod eskirdi. Qaytadan boshlang: npm run tg:login",
  PHONE_NUMBER_BANNED: "Bu raqam Telegram'da bloklangan.",
  PHONE_NUMBER_FLOOD: "Bu raqamga kod juda ko'p so'raldi. Birozdan keyin qayta urinib ko'ring.",
  API_ID_INVALID: "TG_API_ID yoki TG_API_HASH noto'g'ri. .env faylni tekshiring.",
  API_ID_PUBLISHED_FLOOD: "Bu API kaliti bloklangan. my.telegram.org da yangi ilova yarating.",
};

// GramJS'ning o'z (Telegram'dan kelmagan) xabarlari
const LOCAL = {
  "Code is empty": "Kod kiritilmadi. Kirish to'xtatildi.",
  "Password is empty": "Parol kiritilmadi. Kirish to'xtatildi.",
};

// error — GramJS xatosi (Telegram xatolarida errorMessage bo'ladi), retries — shu paytgacha nechta qayta so'raldi.
// Natija: { retry: true|false, message }
export function authErrorAction(error, retries = 0) {
  const code = error?.errorMessage;
  if (RETRYABLE[code]) {
    if (retries < MAX_RETRIES) return { retry: true, message: RETRYABLE[code] };
    return { retry: false, message: `${RETRYABLE[code].split(".")[0]}. Urinishlar tugadi, qaytadan: npm run tg:login` };
  }
  if (code === "FLOOD" || /^FLOOD_WAIT/.test(code ?? "")) {
    const minutes = Math.max(1, Math.ceil((error.seconds ?? 60) / 60));
    return { retry: false, message: `Telegram ko'p urinish sababli kirishni vaqtincha to'xtatdi. ${minutes} daqiqadan keyin qayta urinib ko'ring.` };
  }
  if (FATAL[code]) return { retry: false, message: FATAL[code] };
  if (code) return { retry: false, message: `Telegram xatosi: ${code}` };
  const local = LOCAL[error?.message];
  return { retry: false, message: local ?? error?.message ?? String(error) };
}
