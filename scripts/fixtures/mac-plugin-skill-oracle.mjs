/** Supplier witness for one original Native Skill call; never implements or invokes Skill. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
const RUN = "UWORK_NATIVE_PLUGIN_SKILL_RUN_20261021";
const BODY = "UWORK_NATIVE_PLUGIN_SKILL_BODY_20261021";
const CALL = "native-installed-skill-call-20261021";
const QUALIFIED = "uwork-native-bridge-plugin:bridge";
const TITLE_SHA =
  "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : Array.isArray(m?.content)
      ? m.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
      : "";
const need = (value) => {
  if (!value) throw Error("MAC_PLUGIN_SKILL_ORACLE_REJECTED");
};
async function attest(caseRoot, baseDirectory, expected) {
  need(
    typeof baseDirectory === "string" &&
      resolve(baseDirectory) === baseDirectory &&
      !/[\x00\r\n]/.test(baseDirectory),
  );
  need(baseDirectory.startsWith(caseRoot + sep));
  need((await realpath(caseRoot)) === caseRoot);
  const rootStat = await lstat(caseRoot);
  need(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  let current = caseRoot;
  for (const part of relative(caseRoot, baseDirectory).split(sep)) {
    need(part && part !== "." && part !== "..");
    current = join(current, part);
    const stat = await lstat(current);
    need(stat.isDirectory() && !stat.isSymbolicLink());
    need((await realpath(current)) === current);
  }
  const pluginRoot = dirname(dirname(baseDirectory));
  need(baseDirectory === join(pluginRoot, "skills", "bridge"));
  async function readOwned(path, expectedHash, expectedBytes) {
    need(path.startsWith(caseRoot + sep));
    const stat = await lstat(path);
    need(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size === expectedBytes &&
        (stat.mode & 0o111) === 0,
    );
    need((await realpath(path)) === path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      need(
        opened.isFile() &&
          opened.ino === stat.ino &&
          opened.dev === stat.dev &&
          opened.size === expectedBytes,
      );
      const bytes = await handle.readFile();
      need(bytes.length === expectedBytes && hash(bytes) === expectedHash);
      return bytes;
    } finally {
      await handle.close();
    }
  }
  const manifestDirectory = join(pluginRoot, ".zcode-plugin");
  const md = await lstat(manifestDirectory);
  need(md.isDirectory() && !md.isSymbolicLink());
  need((await realpath(manifestDirectory)) === manifestDirectory);
  const manifestBytes = await readOwned(
    join(pluginRoot, ".zcode-plugin/plugin.json"),
    expected.manifestSha256,
    expected.manifestBytes,
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.deepEqual(manifest, expected.manifest);
  await readOwned(
    join(baseDirectory, "SKILL.md"),
    expected.skillSha256,
    expected.skillBytes,
  );
  return {
    manifestSha256: expected.manifestSha256,
    skillSha256: expected.skillSha256,
    manifestBytes: expected.manifestBytes,
    skillBytes: expected.skillBytes,
    caseRelativePluginRoot: relative(caseRoot, pluginRoot),
    caseRelativeBaseDirectory: relative(caseRoot, baseDirectory),
    realpathWithinCase: true,
    installationCacheMembershipVerified: false,
    noSymlinks: true,
  };
}
export function createMacPluginSkillOracle({
  caseRoot,
  workspacePath,
  artifact,
}) {
  need(typeof caseRoot === "string" && caseRoot === resolve(caseRoot));
  need(
    typeof workspacePath === "string" &&
      workspacePath === resolve(workspacePath) &&
      workspacePath.startsWith(caseRoot + sep),
  );
  need(
    artifact?.qualifiedSkill === QUALIFIED &&
      artifact.paths?.manifest === ".zcode-plugin/plugin.json" &&
      artifact.paths?.skill === "skills/bridge/SKILL.md",
  );
  const manifest = structuredClone(artifact.manifest),
    manifestText = JSON.stringify(manifest);
  need(
    manifest.name === "uwork-native-bridge-plugin" &&
      manifest.version === "1.0.0" &&
      JSON.stringify(manifest.skills) === '["./skills"]' &&
      !manifestText.includes(BODY),
  );
  need(
    typeof artifact.skillText === "string" && artifact.skillText.includes(BODY),
  );
  need(
    hash(artifact.skillText) === artifact.skillSha256 &&
      hash(manifestText) === artifact.manifestSha256,
  );
  // Match the original NodeSkillAdapter stripFrontmatter(...).trim() contract.
  const skillLines = artifact.skillText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const frontmatterEnd = skillLines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  need(skillLines[0].trim() === "---" && frontmatterEnd > 0);
  const bodyFragment = skillLines
    .slice(frontmatterEnd + 1)
    .join("\n")
    .trim();
  need(bodyFragment.includes(BODY));
  const expected = {
    bodyFragment,
    manifest,
    manifestSha256: artifact.manifestSha256,
    manifestBytes: Buffer.byteLength(manifestText),
    skillSha256: artifact.skillSha256,
    skillBytes: Buffer.byteLength(artifact.skillText),
  };
  let stage = "waiting",
    mainRequests = 0,
    followupRequests = 0,
    titleRequests = 0,
    failed = false;
  const receipts = [];
  return {
    async reply(body) {
      try {
        need(!failed && body && Array.isArray(body.messages));
        const serialized = JSON.stringify(body);
        need(serialized.length <= 2 * 1024 * 1024);
        const users = body.messages.filter((m) => m.role === "user");
        const selected = users.some((m) => text(m).includes(RUN));
        if (!selected) {
          need(!serialized.includes(BODY));
          return null;
        }
        need(body.model === "controlled");
        const systems = body.messages.filter((m) => m.role === "system");
        need(systems.length === 1);
        const system = text(systems[0]),
          systemSha256 = hash(system);
        const common = {
          requestDigest: hash(serialized),
          systemSha256,
          stream: body.stream,
        };
        if (systemSha256 === TITLE_SHA) {
          need(
            body.stream === false &&
              body.messages.length === 2 &&
              body.messages[1].role === "user" &&
              !Object.hasOwn(body, "tools") &&
              !Object.hasOwn(body, "tool_choice") &&
              !serialized.includes(BODY) &&
              titleRequests === 0,
          );
          titleRequests++;
          receipts.push({ ...common, kind: "title" });
          return { text: "Native installed plugin Skill bridge" };
        }
        need(body.stream === true);
        const cwd = [
          ...system.matchAll(/^- Primary working directory: ([^\r\n]+)$/gm),
        ].map((m) => m[1]);
        assert.deepEqual(cwd, [workspacePath]);
        need(
          Array.isArray(body.tools) &&
            body.tools.filter((t) => t.function?.name === "Skill").length === 1,
        );
        const lastUser = body.messages.findLastIndex(
          (m) => m.role === "user" && text(m).includes(RUN),
        );
        need(lastUser >= 0);
        const tools = body.messages
          .slice(lastUser + 1)
          .filter((m) => m.role === "tool");
        if (tools.length === 0) {
          need(stage === "waiting" && !serialized.includes(BODY));
          mainRequests++;
          stage = "tool-issued";
          receipts.push({
            ...common,
            kind: "main-tool-call",
            toolCallId: CALL,
            toolCount: body.tools.length,
          });
          return {
            toolCall: {
              id: CALL,
              name: "Skill",
              arguments: JSON.stringify({ skill: QUALIFIED }),
            },
          };
        }
        need(
          stage === "tool-issued" &&
            tools.length === 1 &&
            tools[0].tool_call_id === CALL,
        );
        const calls = body.messages
          .slice(lastUser + 1)
          .flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []) : []))
          .filter((c) => c.id === CALL);
        need(calls.length === 1 && calls[0].function?.name === "Skill");
        assert.deepEqual(JSON.parse(calls[0].function.arguments), {
          skill: QUALIFIED,
        });
        const result = text(tools[0]);
        need(result.includes(BODY) && result.includes(expected.bodyFragment));
        const directories = [
          ...result.matchAll(/^Base directory for this skill: ([^\r\n]+)$/gm),
        ].map((m) => m[1]);
        need(directories.length === 1);
        const attestation = await attest(caseRoot, directories[0], expected);
        need(stage === "tool-issued");
        followupRequests++;
        stage = "completed";
        receipts.push({
          ...common,
          kind: "main-followup",
          toolCallId: CALL,
          bodyMarkerMatched: true,
          fullSkillBodyMatched: true,
          skillBodyFragmentSha256: hash(expected.bodyFragment),
          baseDirectoryMatched: true,
          attestation,
        });
        return { text: "原生企业资产联动完成。" };
      } catch {
        failed = true;
        stage = "failed";
        throw Error("MAC_PLUGIN_SKILL_ORACLE_REJECTED");
      }
    },
    safeStatus() {
      return {
        schema: "mac-plugin-skill-oracle-v1",
        stage,
        mainRequests,
        followupRequests,
        titleRequests,
        qualifiedSkill: QUALIFIED,
        toolCallId: CALL,
        receipts: structuredClone(receipts),
      };
    },
  };
}
