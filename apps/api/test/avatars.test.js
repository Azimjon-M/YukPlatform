// Ro'yxatlardagi kichik rasmlar (avatars.js): Telegram soxta, fayllar vaqtinchalik papkada
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAvatars } from "../src/avatars.js";

function fakeTelegram({ userPhoto = true, chatPhoto = true } = {}) {
  const calls = [];
  const json = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });
  const fetchImpl = async (url, options = {}) => {
    const method = url.split("/").pop();
    calls.push(method);
    if (url.includes("/file/bot")) return { ok: true, arrayBuffer: async () => new TextEncoder().encode("JPEG").buffer };
    const body = JSON.parse(options.body ?? "{}");
    if (method === "getUserProfilePhotos") return json({ total_count: userPhoto ? 1 : 0, photos: userPhoto ? [[{ file_id: "small" }, { file_id: "big" }]] : [] });
    if (method === "getChat") return json(chatPhoto ? { id: 1, photo: { small_file_id: `chat-${body.chat_id}` } } : { id: 1 });
    if (method === "getFile") return json({ file_path: `photos/${body.file_id}.jpg` });
    return json(null);
  };
  return { calls, fetchImpl };
}

test("haydovchi rasmi: Telegram'dan bir marta (eng kichigi), keyin diskdan; rasm yo'q — null va qayta so'ralmaydi", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-avatars-"));
  const tg = fakeTelegram();
  const avatars = createAvatars({ token: "T", dir, fetchImpl: tg.fetchImpl });
  const [a, b] = await Promise.all([avatars.user(555), avatars.user(555)]);
  assert.equal(String(a), "JPEG");
  assert.equal(String(b), "JPEG");
  assert.deepEqual(tg.calls.filter((c) => c === "getUserProfilePhotos").length, 1, "parallel so'rov — bitta");
  assert.ok(tg.calls.includes("small.jpg"), "eng kichik o'lcham (160×160) yuklandi");
  await avatars.user(555);
  assert.equal(tg.calls.filter((c) => c === "getUserProfilePhotos").length, 1, "keyingisi — diskdan");

  const none = fakeTelegram({ userPhoto: false });
  const noPhoto = createAvatars({ token: "T", dir, fetchImpl: none.fetchImpl });
  assert.equal(await noPhoto.user(777), null);
  assert.equal(await noPhoto.user(777), null);
  assert.equal(none.calls.filter((c) => c === "getUserProfilePhotos").length, 1, "«.none» — 1 kun qayta so'ralmaydi");
  assert.equal(avatars.user("abc"), null);
});

test("guruh rasmi: ochig'i — bot getChat; yopig'i — faqat collector yuklab qo'ygani", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yuk-avatars-"));
  const tg = fakeTelegram();
  const avatars = createAvatars({ token: "T", dir, fetchImpl: tg.fetchImpl });
  assert.equal(String(await avatars.source("@TutGruz")), "JPEG");
  assert.ok(existsSync(path.join(dir, "sources", "@tutgruz.jpg")));
  assert.equal(await avatars.source("-1001234567"), null, "yopiq — bot ko'ra olmaydi");
  assert.equal(tg.calls.filter((c) => c === "getChat").length, 1, "yopiq guruh uchun bot so'ralmadi");
  mkdirSync(path.join(dir, "sources"), { recursive: true });
  writeFileSync(path.join(dir, "sources", "-1001234567.jpg"), "CLOSED");
  assert.equal(String(await avatars.source("-1001234567")), "CLOSED");
  assert.equal(avatars.source("../../etc"), null);
});
