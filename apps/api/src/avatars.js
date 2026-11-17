// Ro'yxatlardagi kichik rasmlar (2026-11-16, Azimjon: «Manbalar va haydovchilarga logo qo'yib profil/guruh/kanal rasmini
// olib kelib joylay olasanmi? list bo'yi bo'yicha kichik bo'lsin»).
//   GET /api/avatar/user/:chatId  — haydovchining profil rasmi: Bot API getUserProfilePhotos (eng kichigi, 160×160)
//   GET /api/avatar/source/:name  — guruh/kanal rasmi: ochig'i (@nomi) — Bot API getChat → photo.small (160×160);
//                                    yopig'ini (raqamli id) bot ko'ra olmaydi — collector avatars.js yuklab qo'yadi
// Fayllar AVATAR_DIR da (data/avatars/users|sources), 7 kun yangi hisoblanadi; rasmi yo'q bo'lsa «.none» belgisi 1 kun —
// shuncha vaqt Telegram'dan qayta so'ralmaydi. Javob yo'q (404) — ilova bosh harflarni ko'rsatadi.
// Bir vaqtda ko'pi bilan LIMIT ta Telegram so'rovi; bir xil rasm uchun parallel so'rov bitta bo'ladi.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AVATAR_DIR, avatarFileName } from "@yuk/store";

export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NONE_TTL_MS = 24 * 60 * 60 * 1000;
const LIMIT = 4;

// token — BOT_TOKEN; fetchImpl — testda soxtasi. → { user(chatId), source(name) } → Buffer | null
export function createAvatars({ token, dir = AVATAR_DIR, fetchImpl = fetch, now = Date.now } = {}) {
  const inflight = new Map();
  let running = 0;
  const waiting = [];
  const slot = async (fn) => {
    if (running >= LIMIT) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };

  async function api(method, body) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return json.ok ? json.result : null;
  }

  async function download(fileId) {
    const file = await api("getFile", { file_id: fileId });
    if (!file?.file_path) return null;
    const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }

  const fresh = async (file, ttl) => {
    try {
      return now() - (await stat(file)).mtimeMs < ttl;
    } catch {
      return false;
    }
  };

  // kind — users | sources; fetcher — Telegram'dan olish (null — rasm yo'q). canFetch false — faqat diskdagisi
  async function get(kind, key, fetcher) {
    const file = path.join(dir, kind, avatarFileName(key));
    const none = `${file}.none`;
    if (await fresh(file, AVATAR_TTL_MS)) return readFile(file);
    if (!fetcher || !token) return readFile(file).catch(() => null); // eski bo'lsa ham bori
    if (await fresh(none, NONE_TTL_MS)) return readFile(file).catch(() => null);
    const id = `${kind}/${file}`;
    if (!inflight.has(id)) {
      inflight.set(
        id,
        slot(async () => {
          let data = null;
          try {
            data = await fetcher();
          } catch {
            data = null; // tarmoq xatosi — keyingi safar qayta
            return readFile(file).catch(() => null);
          }
          await mkdir(path.dirname(file), { recursive: true });
          if (data?.length) await writeFile(file, data);
          else await writeFile(none, "");
          return data?.length ? data : readFile(file).catch(() => null);
        }).finally(() => inflight.delete(id)),
      );
    }
    return inflight.get(id);
  }

  return {
    user(chatId) {
      if (!/^\d+$/.test(String(chatId))) return null;
      return get("users", chatId, async () => {
        const photos = await api("getUserProfilePhotos", { user_id: Number(chatId), limit: 1 });
        const sizes = photos?.photos?.[0];
        return sizes?.length ? download(sizes[0].file_id) : null; // [0] — eng kichigi (160×160)
      });
    },
    source(name) {
      const value = String(name);
      // Yopiq guruh — bot ko'ra olmaydi: faqat collector yuklab qo'ygani
      if (/^-\d+$/.test(value)) return get("sources", value, null);
      if (!/^@\w{3,}$/.test(value)) return null;
      return get("sources", value, async () => {
        const chat = await api("getChat", { chat_id: value });
        return chat?.photo?.small_file_id ? download(chat.photo.small_file_id) : null;
      });
    },
  };
}
