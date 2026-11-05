import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROUTE_SCOPE, loadCountry, routeInScope, routeScopeFrom, routeText } from "../src/index.js";

const uz = (region) => ({ region, country: "O'zbekiston" });
const abroad = (country) => ({ region: "xorij", country });
const load = (from, to) => ({
  fromRegion: from?.region ?? null,
  fromCountry: from?.country ?? null,
  toRegion: to?.region ?? null,
  toCountry: to?.country ?? null,
});

test("qo'shni doirasi: O'zbekiston ichi va chegaradosh davlatlar bilan", () => {
  assert.equal(DEFAULT_ROUTE_SCOPE, "qoshni");
  assert.equal(routeInScope(load(uz("toshkent_sh"), uz("samarqand"))), true);
  assert.equal(routeInScope(load(abroad("Qozog'iston"), uz("namangan"))), true);
  assert.equal(routeInScope(load(uz("buxoro"), abroad("Turkmaniston"))), true);
  assert.equal(routeInScope(load(uz("surxondaryo"), abroad("Afg'oniston"))), true);
  assert.equal(routeInScope(load(abroad("Tojikiston"), uz("fargona"))), true);
  assert.equal(routeInScope(load(abroad("Qirg'iziston"), uz("andijon"))), true);
});

test("qo'shni doirasi: uzoq davlatlar va O'zbekistonga tegmaydigan yo'l — yo'q", () => {
  assert.equal(routeInScope(load(abroad("Rossiya"), uz("toshkent_sh"))), false);
  assert.equal(routeInScope(load(uz("samarqand"), abroad("Belarus"))), false);
  assert.equal(routeInScope(load(abroad("Xitoy"), uz("toshkent_sh"))), false, "Xitoy chegaradosh emas");
  assert.equal(routeInScope(load(abroad("Xitoy"), abroad("Qozog'iston"))), false);
  assert.equal(routeInScope(load(abroad("Qozog'iston"), abroad("Qirg'iziston"))), false, "O'zbekistondan o'tmaydi");
  // ro'yxatda yo'q xorijiy joy, davlati noma'lum
  assert.equal(routeInScope(load({ region: "xorij" }, uz("toshkent_sh"))), false);
});

test("bir uchi noma'lum — ma'lum uchi bo'yicha; davlat yozilmasa viloyatdan", () => {
  assert.equal(routeInScope(load(uz("toshkent_sh"), null)), true);
  assert.equal(routeInScope(load(abroad("Qozog'iston"), null)), true);
  assert.equal(routeInScope(load(abroad("Rossiya"), null)), false);
  assert.equal(routeInScope(load(null, null)), true);
  assert.equal(routeInScope({ fromRegion: "toshkent", toRegion: "xorazm" }), true);
  assert.equal(loadCountry({ fromRegion: "toshkent" }, "from"), "O'zbekiston");
  assert.equal(loadCountry({ toRegion: "xorij" }, "to"), "xorij");
  assert.equal(routeText(load(abroad("Rossiya"), uz("toshkent_sh"))), "Rossiya → O'zbekiston");
  assert.equal(routeText(load(uz("buxoro"), null)), "O'zbekiston → ?");
});

test("boshqa doiralar va .env dagi ROUTE_SCOPE", () => {
  const kz = load(abroad("Qozog'iston"), uz("toshkent_sh"));
  const ru = load(abroad("Rossiya"), uz("toshkent_sh"));
  assert.equal(routeInScope(kz, "ichki"), false);
  assert.equal(routeInScope(load(uz("toshkent_sh"), uz("xorazm")), "ichki"), true);
  assert.equal(routeInScope(ru, "hammasi"), true);
  assert.equal(routeScopeFrom({}), "qoshni");
  assert.equal(routeScopeFrom({ ROUTE_SCOPE: " Hammasi " }), "hammasi");
  assert.throws(() => routeScopeFrom({ ROUTE_SCOPE: "rossiya" }), /ROUTE_SCOPE noto'g'ri/);
});
