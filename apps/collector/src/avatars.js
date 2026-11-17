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

// sources() — shu akkaunt o'qiydigan manbalar (normalizeSource); reader.photo(source) → Buffer | null
export function createAvatarRefresher({ reader, sources, dir = AVATAR_DIR, log = console.log, now = Date.now, gapMs = 20_000 }) {
  let nextAt = -Infinity;
  let busy = false;
  return async function tick() {
    if (busy || !reader.photo || now() < nextAt) return;
    busy = true;
    try {
      for (const source of sources()) {
        if (source.kind !== "id") continue; // ochiq guruh — bot oladi
        const file = path.join(dir, "sources", avatarFileName(source.value));
        if ((await age(file, now())) < AVATAR_TTL_MS || (await age(`${file}.none`, now())) < DAY) continue;
        nextAt = now() + gapMs;
        try {
          const data = await reader.photo(source);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(data ? file : `${file}.none`, data ?? "");
        } catch (error) {
          log(`${source.value}: guruh rasmini olib bo'lmadi — ${error?.errorMessage ?? error?.message}`);
        }
        return; // har safar bittadan
      }
      nextAt = now() + 10 * 60_000; // hammasi yangi — 10 daqiqadan keyin qaraladi
    } finally {
      busy = false;
    }
  };
}
