import assert from "node:assert/strict";
import { test } from "node:test";
import { groupPrompt, namesPattern } from "../src/opsGroup.js";

test("namesPattern: ism/username bilan murojaatni taniydi, so'z ichidagini emas", () => {
  const re = namesPattern({ firstName: "Operator", username: "op_acc" });
  assert.ok(re.test("Claude, M416 yaxshimi?"));
  assert.ok(re.test("klod qayerdasan"));
  assert.ok(re.test("salom @op_acc"));
  assert.ok(re.test("operator nima deysan"));
  assert.ok(!re.test("bu bot o'ynayapti")); // «bot» — o'yinda noob degani, murojaat emas
  assert.ok(!re.test("claudeless"));
});

test("groupPrompt: faqat internet qidiruv, jim belgisi", () => {
  const p = groupPrompt({ title: "Test", about: "PUBG", ownerId: "1" });
  assert.match(p, /faqat internet qidiruv/);
  assert.match(p, /<<JIM>>/);
});
