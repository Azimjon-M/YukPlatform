// Holatlar: jarayon (bot, collector) va e'lon (navbat). Har birining nomi, rangi (tone) va belgisi —
// rang hech qachon yolg'iz ishlatilmaydi, yonida doim belgi va so'z bor.
import { POST_TYPES } from "@yuk/shared";

// --- Jarayonlar ---
// external — terminalda qo'lda ishga tushirilgan: bu yerdan boshqarib bo'lmaydi
export const PROCESS_STATUS = {
  running: { label: "Ishlayapti", tone: "good", icon: "●" },
  stopping: { label: "To'xtatilyapti", tone: "warning", icon: "◐" },
  stopped: { label: "To'xtagan", tone: "neutral", icon: "■" },
  crashed: { label: "Kutilmaganda to'xtadi", tone: "critical", icon: "✖" },
  external: { label: "Terminalda ishlayapti", tone: "info", icon: "▣" },
};

export const processStatus = (status) => PROCESS_STATUS[status] ?? { label: status ?? "Noma'lum", tone: "neutral", icon: "?" };

// Qaysi tugmalar bosiladi. Qulagan jarayonni "O'chirish" — o'zi qayta yonishini bekor qiladi.
export function processActions(status) {
  return {
    start: status === "stopped" || status === "crashed",
    stop: status === "running" || status === "crashed",
    restart: status === "running" || status === "crashed",
  };
}

export const ACTION_LABELS = { start: "Yoqish", stop: "O'chirish", restart: "Qayta ishga tushirish" };

// --- E'lonlar ---
// API statuslari: new | done | failed | duplicate. "mashina_bor" kabi yuk bo'lmagan e'lonlar — done + error=turi
export const POST_STATUS = {
  new: { label: "Navbatda", tone: "info", icon: "◷" },
  done: { label: "Tayyor", tone: "good", icon: "✓" },
  failed: { label: "Xato", tone: "critical", icon: "✖" },
  skipped: { label: "O'tkazib yuborildi", tone: "neutral", icon: "↷" },
  duplicate: { label: "Takror", tone: "neutral", icon: "⧉" },
};

export const postStatus = (status) => POST_STATUS[status] ?? { label: status ?? "—", tone: "neutral", icon: "?" };

export const POST_TABS = [
  { id: "", label: "Hammasi" },
  { id: "new", label: "Navbatda" },
  { id: "done", label: "Tayyor" },
  { id: "failed", label: "Xato" },
  { id: "duplicate", label: "Takror" },
];

// metrics.posts ({ new: 12, done: 300, ... }) → har bir tab uchun son; "" — hammasi
export function tabCounts(posts = {}) {
  const counts = { "": 0 };
  for (const [status, n] of Object.entries(posts ?? {})) {
    counts[status] = n;
    counts[""] += n;
  }
  for (const tab of POST_TABS) counts[tab.id] ??= 0;
  return counts;
}

const POST_TYPE_NAMES = Object.fromEntries(POST_TYPES.map((p) => [p.id, p.name]));

// E'lon ostidagi izoh. Bot "yuk bor" bo'lmagan e'lonni done + error=postType deb yozadi — bu xato emas.
// → { tone: "critical" | "neutral", text } yoki null
export function postNote(post) {
  if (!post?.error) return null;
  const typeName = POST_TYPE_NAMES[post.error];
  if (typeName && (post.status === "done" || post.status === "skipped")) {
    return { tone: "neutral", text: `O'tkazib yuborildi: ${typeName}` };
  }
  if (post.status === "failed") return { tone: "critical", text: post.error };
  return { tone: "neutral", text: post.error };
}
