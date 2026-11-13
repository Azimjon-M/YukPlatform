import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT_CONFIG, devAutostart, devBotProblem, devCollectorProblem, isDevMode, prodBots } from "../src/devMode.js";

test("isDevMode: faqat YUK_ENV=dev kabi qiymatlar; serverda (qator yo'q) — yo'q", () => {
  for (const value of ["dev", "DEV", " development ", "local", "lokal", "sinov", "test"]) assert.equal(isDevMode({ YUK_ENV: value }), true, value);
  for (const value of [undefined, "", "production", "prod", "server"]) assert.equal(isDevMode({ YUK_ENV: value }), false, String(value));
});

test("prodBots: standart @Yuk_Ekspert_agent, .env PROD_BOTS bilan almashtiriladi", () => {
  assert.deepEqual(prodBots({}), ["Yuk_Ekspert_agent"]);
  assert.deepEqual(prodBots({ PROD_BOTS: "@BirBot, ikkiBot" }), ["BirBot", "ikkiBot"]);
  assert.deepEqual(prodBots({ PROD_BOTS: " , " }), ["Yuk_Ekspert_agent"], "bo'sh — standart");
});

test("devBotProblem: dev'da prod bot — taqiq, test bot — ruxsat; serverda hech qachon taqiqlanmaydi", () => {
  const dev = { YUK_ENV: "dev" };
  const text = devBotProblem("Yuk_Ekspert_agent", dev);
  assert.match(text, /409 Conflict/);
  assert.match(text, /@BotFather/);
  assert.ok(devBotProblem("yuk_ekspert_AGENT", dev), "katta-kichik harf farqi yo'q");
  assert.ok(devBotProblem("@Yuk_Ekspert_agent", dev));
  assert.equal(devBotProblem("Yuk_Ekspert_test_bot", dev), null);
  assert.equal(devBotProblem("Yuk_Ekspert_agent", {}), null, "serverda (YUK_ENV yo'q) — o'zgarish yo'q");
  assert.equal(devBotProblem("Yuk_Ekspert_agent", { YUK_ENV: "production" }), null);
  assert.ok(devBotProblem("YangiProdBot", { YUK_ENV: "dev", PROD_BOTS: "YangiProdBot" }));
});

test("devCollectorProblem: dev'da sessiya kerak bo'lgan buyruqlar — DEV_COLLECTOR=1 siz yo'q, login — mumkin", () => {
  const dev = { YUK_ENV: "dev" };
  for (const command of ["live", "dialogs", "search", "export", "logout"]) assert.match(devCollectorProblem(command, dev), /ALOHIDA raqamdagi/, command);
  assert.equal(devCollectorProblem("login", dev), null);
  assert.equal(devCollectorProblem("live", { ...dev, DEV_COLLECTOR: "1" }), null);
  assert.equal(devCollectorProblem("live", { ...dev, DEV_COLLECTOR: "0" }) !== null, true);
  assert.equal(devCollectorProblem("live", {}), null, "serverda — o'zgarish yo'q");
});

test("devAutostart: dev'da collector olib tashlanadi, qolgani joyida; serverda ro'yxat o'zgarmaydi", () => {
  const all = ["nginx", "tunnel", "bot", "collector"];
  assert.deepEqual(devAutostart(all, { YUK_ENV: "dev" }), ["nginx", "tunnel", "bot"]);
  assert.deepEqual(devAutostart(all, { YUK_ENV: "dev", DEV_COLLECTOR: "ha" }), all);
  assert.deepEqual(devAutostart(all, {}), all);
});

test("EXIT_CONFIG = 78 (sysexits EX_CONFIG)", () => {
  assert.equal(EXIT_CONFIG, 78);
});
