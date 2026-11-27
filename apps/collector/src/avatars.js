// Yopiq guruh/kanal rasmi → data/avatars/sources/<id>.jpg (2026-11-16). Boshqaruv markazi (apps/api avatars.js) ochiq
// guruh rasmini bot orqali o'zi oladi, yopig'ini bot ko'ra olmaydi — shuning uchun uni o'qiydigan akkaunt yuklaydi.
// Sekin: gapMs da ko'pi bilan bitta guruh, har guruh AVATAR_TTL_MS da bir marta (rasmi yo'q bo'lsa — «.none», 1 kun).
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AVATAR_DIR, avatarFileName } from "@yuk/store";

const DAY = 24 * 60 * 60 * 1000;
export const AVATAR_TTL_MS = 7 * DAY;

const age = async (file, now) => {
  try {
    return now - (await stat(file)).mtimeMs;
  } catch {
    return Infinity;
  }
};

// sources() — shu akkaunt o'qiydigan manbalar (normalizeSource); reader.photo(source) → Buffer | null.
// Hech tekshirilmagan (yangi — «🔎 Auto scan» yoki «➕ Guruh qo'shish» bilan qo'shilgan) guruh — birinchi navbatda va
// tezroq (newGapMs; 2026-11-27, Azimjon: «Auto scan qilinganida rasminiham check qilib olish kerak» — rasm «🎛 Filtr» da
// chiqadi), eskirgani (7 kun) — sekin (gapMs). Hammasi yangi bo'lsa — idleMs dan keyin yana qaraladi
export function createAvatarRefresher({ reader, sources, dir = AVATAR_DIR, log = console.log, now = Date.now, gapMs = 20_000, newGapMs = 3_000, idleMs = 60_000 }) {
  let nextAt = -Infinity;
  let busy = false;
  return async function tick() {
    if (busy || !reader.photo || now() < nextAt) return;
    busy = true;
    try {
      let stale = null;
      let fresh = null; // hech tekshirilmagan
      for (const source of sources()) {
        if (source.kind !== "id") continue; // ochiq guruh — bot oladi
        const file = path.join(dir, "sources", avatarFileName(source.value));
        const [photoAge, noneAge] = [await age(file, now()), await age(`${file}.none`, now())];
        if (photoAge === Infinity && noneAge === Infinity) {
          fresh = { source, file };
          break;
        }
        if (!stale && photoAge >= AVATAR_TTL_MS && noneAge >= DAY) stale = { source, file };
      }
      const pick = fresh ?? stale;
      if (!pick) {
        nextAt = now() + idleMs;
        return;
      }
      nextAt = now() + (fresh ? newGapMs : gapMs);
      try {
        const data = await reader.photo(pick.source);
        await mkdir(path.dirname(pick.file), { recursive: true });
        await writeFile(data ? pick.file : `${pick.file}.none`, data ?? "");
      } catch (error) {
        log(`${pick.source.value}: guruh rasmini olib bo'lmadi — ${error?.errorMessage ?? error?.message}`);
      }
    } finally {
      busy = false;
    }
  };
}
