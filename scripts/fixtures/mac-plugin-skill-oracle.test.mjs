import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createMacPluginSkillOracle } from "./mac-plugin-skill-oracle.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const marker = "UWORK_NATIVE_PLUGIN_SKILL_RUN_20261021",
  bodyMarker = "UWORK_NATIVE_PLUGIN_SKILL_BODY_20261021",
  id = "native-installed-skill-call-20261021";
const manifest = {
  name: "uwork-native-bridge-plugin",
  version: "1.0.0",
  skills: ["./skills"],
};
const skillText =
  "---\nname: bridge\ndescription: Owned text only\n---\nRead-only local acceptance note.\n" +
  bodyMarker +
  "\n";
const artifact = {
  manifest,
  manifestSha256: hash(JSON.stringify(manifest)),
  skillText,
  skillSha256: hash(skillText),
  paths: {
    manifest: ".zcode-plugin/plugin.json",
    skill: "skills/bridge/SKILL.md",
  },
  qualifiedSkill: "uwork-native-bridge-plugin:bridge",
};
const title = readFileSync(
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts",
  "utf8",
).match(/const SESSION_TITLE_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
async function setup(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-native-plugin-oracle-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, "arbitrary-private-cache/owned/1.0.0"),
    base = join(plugin, "skills/bridge");
  await mkdir(base, { recursive: true });
  await mkdir(join(plugin, ".zcode-plugin"));
  await writeFile(
    join(plugin, ".zcode-plugin/plugin.json"),
    JSON.stringify(manifest),
  );
  await writeFile(join(base, "SKILL.md"), skillText);
  const workspace = join(root, "workspace");
  const oracle = createMacPluginSkillOracle({
    caseRoot: root,
    workspacePath: workspace,
    artifact,
  });
  return { root, base, plugin, workspace, oracle };
}
function main(f) {
  return {
    model: "controlled",
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "Original system\n- Primary working directory: " + f.workspace + "\n",
      },
      { role: "user", content: marker + " 请运行技能" },
    ],
    tools: [{ type: "function", function: { name: "Skill" } }],
  };
}
function followup(f, overrides = {}) {
  const r = main(f);
  r.messages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: {
            name: "Skill",
            arguments: JSON.stringify({ skill: artifact.qualifiedSkill }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: id,
      content:
        "Base directory for this skill: " +
        f.base +
        "\n\nRead-only local acceptance note.\n" +
        bodyMarker,
      ...overrides,
    },
  );
  return r;
}
test("actual roletool same call id and owned two file bytes attest before supplier completion", async (t) => {
  const f = await setup(t);
  assert.equal(
    await f.oracle.reply({
      messages: [{ role: "user", content: "other seed" }],
    }),
    null,
  );
  const call = await f.oracle.reply(main(f));
  assert.equal(call.toolCall.id, id);
  assert.equal(call.toolCall.name, "Skill");
  const reply = await f.oracle.reply(followup(f));
  assert.equal(reply.text, "原生企业资产联动完成。");
  await f.oracle.reply({
    model: "controlled",
    stream: false,
    messages: [
      { role: "system", content: title },
      { role: "user", content: marker },
    ],
  });
  const status = f.oracle.safeStatus();
  assert.equal(status.stage, "completed");
  assert.deepEqual(
    [status.mainRequests, status.followupRequests, status.titleRequests],
    [1, 1, 1],
  );
  assert.equal(
    status.receipts[1].attestation.skillSha256,
    artifact.skillSha256,
  );
  assert.ok(!JSON.stringify(status).includes(bodyMarker));
  assert.ok(!JSON.stringify(status).includes("请运行"));
});
test("title with same user marker remains a separate non tool request", async (t) => {
  const f = await setup(t);
  const reply = await f.oracle.reply({
    model: "controlled",
    stream: false,
    messages: [
      { role: "system", content: title },
      { role: "user", content: marker },
    ],
  });
  assert.ok(reply.text);
  assert.equal(f.oracle.safeStatus().mainRequests, 0);
  assert.equal(f.oracle.safeStatus().titleRequests, 1);
});
for (const [name, change] of [
  [
    "wrong id",
    (r) => {
      r.messages.at(-1).tool_call_id = "foreign";
    },
  ],
  [
    "missing body",
    (r) => {
      r.messages.at(-1).content = "Base directory for this skill: x";
    },
  ],
  [
    "foreign directory",
    (r) => {
      r.messages.at(-1).content =
        "Base directory for this skill: /foreign/skills/bridge\n" + bodyMarker;
    },
  ],
])
  test("rejects " + name, async (t) => {
    const f = await setup(t);
    await f.oracle.reply(main(f));
    const r = followup(f);
    change(r);
    await assert.rejects(f.oracle.reply(r), /MAC_PLUGIN_SKILL_ORACLE_REJECTED/);
  });
test("changed installed Skill bytes are rejected", async (t) => {
  const f = await setup(t);
  await f.oracle.reply(main(f));
  await writeFile(join(f.base, "SKILL.md"), "tampered");
  await assert.rejects(f.oracle.reply(followup(f)));
});
test("symlink Skill cannot attest even matching outside bytes", async (t) => {
  const f = await setup(t);
  await f.oracle.reply(main(f));
  await rm(join(f.base, "SKILL.md"));
  await writeFile(join(f.root, "outside.md"), skillText);
  await symlink(join(f.root, "outside.md"), join(f.base, "SKILL.md"));
  await assert.rejects(f.oracle.reply(followup(f)));
});
test("duplicate main, wrong cwd and marker leakage do not create successful receipts", async (t) => {
  for (const kind of ["duplicate", "cwd", "leak"]) {
    const f = await setup(t);
    const r = main(f);
    if (kind === "duplicate") await f.oracle.reply(r);
    if (kind === "cwd")
      r.messages[0].content = "- Primary working directory: /foreign";
    if (kind === "leak") r.messages[1].content += " " + bodyMarker;
    await assert.rejects(f.oracle.reply(r));
    assert.notEqual(f.oracle.safeStatus().stage, "completed");
  }
});

test("marker-only tool result cannot claim the complete Skill body", async (t) => {
  const f = await setup(t);
  await f.oracle.reply(main(f));
  const r = followup(f);
  r.messages.at(-1).content = r.messages
    .at(-1)
    .content.replace("Read-only local acceptance note.\n", "");
  await assert.rejects(f.oracle.reply(r));
});
