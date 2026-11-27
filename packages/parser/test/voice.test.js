import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSCRIBE_MODELS, createVoiceTranscriber } from "../src/index.js";

test("createVoiceTranscriber: avval o'girish modellari, xato bergani dam oladi, hammasi band — null", async () => {
  const tried = [];
  let fail = new Set([TRANSCRIBE_MODELS[0]]);
  const voice = createVoiceTranscriber({
    connections: () => [{ provider: "gemini", apiKey: "k1", model: "gemini-x", enabled: true }, { provider: "claude", apiKey: "c", model: "m" }],
    transcribe: async ({ model }) => {
      tried.push(model);
      if (fail.has(model)) throw Object.assign(new Error("limit"), { status: 429 });
      return { text: `matn:${model}` };
    },
  });
  assert.equal(await voice(Buffer.from("a"), "audio/ogg"), `matn:${TRANSCRIBE_MODELS[1]}`);
  tried.length = 0;
  assert.equal(await voice(Buffer.from("a"), "audio/ogg"), `matn:${TRANSCRIBE_MODELS[1]}`);
  assert.deepEqual(tried, [TRANSCRIBE_MODELS[1]], "dam olayotgan model sinalmaydi");
  fail = new Set([...TRANSCRIBE_MODELS, "gemini-x"]);
  assert.equal(await voice(Buffer.from("a"), "audio/ogg"), null);
});
