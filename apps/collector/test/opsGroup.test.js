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
  assert.match(p, /befarosat/);
  assert.match(p, /<<JIM>>/);
});

// To'liq oqim: soxta Telegram client + soxta `claude` (OPS_CLAUDE_BIN) — haqiqiy Claude/Telegram'ga ulanmaydi
test("createGroupResponder: murojaatga javob, murojaatsiz — bufer, <<JIM>> — hech narsa", async () => {
  const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "opsgroup-"));
  const bin = path.join(dir, "claude");
  // Promptda «murojaat qilindi» bo'lsa — javob, aks holda <<JIM>>; oxirgi promptni faylga yozadi
  await writeFile(bin, `#!/bin/sh\nprintf '%s' "$2" > "${dir}/last-prompt"\ncase "$2" in *"murojaat qilindi"*) echo '{"result":"Salom do'"'"'stim","session_id":"s1"}';; *) echo '{"result":"<<JIM>>","session_id":"s1"}';; esac\n`);
  await chmod(bin, 0o755);
  process.env.OPS_CLAUDE_BIN = bin;
  process.env.OPS_GROUP_WORKDIR = path.join(dir, "work");
  process.env.OPS_GROUP_CHIME = "4";
  await writeFile(path.join(dir, "t.groups.json"), JSON.stringify([{ chat: "@g", about: "test" }]));
  const sent = [];
  const client = {
    getMe: async () => ({ firstName: "Yuk Agenti", username: "agent_x" }),
    getEntity: async () => ({ title: "G" }),
    getPeerId: async () => "-1001",
    getInputEntity: async () => ({ peer: 1 }),
    sendMessage: async (_p, o) => sent.push(o),
  };
  const { createGroupResponder: make } = await import(`../src/opsGroup.js?x=${Date.now()}`);
  const g = make({ client, name: "t", ownerId: "7", opsDir: dir, audit: async () => {} });
  assert.deepEqual(await g.load(), ["G"]);
  const msg = (id, text, extra = {}) => ({ id, chatId: "-1001", senderId: "5", message: text, getSender: async () => ({ firstName: "Ali", username: "ali" }), ...extra });
  await g.handle(msg(1, "salom hammaga"));
  assert.equal(sent.length, 0);
  await g.handle(msg(2, "Claude, M416 qanday?"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyTo, 2);
  assert.match(await (await import("node:fs/promises")).readFile(path.join(dir, "last-prompt"), "utf8"), /salom hammaga[\s\S]*M416/);
  await g.handle(msg(3, "javobga reply", { mentioned: true }));
  assert.equal(sent.length, 2);
  for (let i = 4; i < 20; i++) await g.handle(msg(i, "oddiy gap " + i));
  assert.equal(sent.length, 2); // o'zi qo'shilishga urindi, lekin <<JIM>> — yuborilmadi (cooldown ham bor)
  await g.handle(msg(30, "bot o'ynayapti")); // «bot» — murojaat emas
  await g.handle(msg(31, "x", { out: true }));
  assert.equal(sent.length, 2);
  g.enabled = false;
  await g.handle(msg(32, "Claude?"));
  assert.equal(sent.length, 2);
});
