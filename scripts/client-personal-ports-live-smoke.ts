import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { eventually, liveFixture } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type Stage = {
  id: string;
  tool: string;
  input: Row;
  issued: boolean;
  results: string[];
  requests: Row[];
};
const evidenceDirectory = "evidence/client-personal-ports-20261017";
const serverName = "owned_personal";
const mcpTool = `mcp__${serverName}__mark`;
const userMarker = "G06_OWNED_USER_BODY";
const projectMarker = "G06_OWNED_PROJECT_BODY";
const skillDocument = (name: string, marker: string) =>
  `---\nname: ${name}\ndescription: Owned controlled personal skill\n---\n\n${marker}\n`;

async function fixture(t: TestContext, name: string) {
  let stage: Stage | undefined;
  let configFile = "",
    userSkill = "",
    projectSkill = "";
  const calls: Row[] = [],
    methods: string[] = [],
    observations: Row[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      methods.push(`HTTP:${req.method}`);
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const frame = JSON.parse(raw) as Row;
    methods.push(String(frame.method));
    if (frame.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: Row = {};
    if (frame.method === "initialize")
      result = {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: "1" },
      };
    if (frame.method === "tools/list")
      result = {
        tools: [
          {
            name: "mark",
            description: "Record an owned harmless controlled marker",
            inputSchema: {
              type: "object",
              properties: { marker: { type: "string" } },
              required: ["marker"],
              additionalProperties: false,
            },
          },
        ],
      };
    if (frame.method === "tools/call") {
      const params = frame.params as Row;
      assert.equal(params.name, "mark");
      calls.push(structuredClone(params.arguments as Row));
      result = {
        content: [
          { type: "text", text: `G06_MCP_EXECUTED:${calls.at(-1)!.marker}` },
        ],
      };
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    assert.equal(server.listening, false);
    await writeFile(
      join(resolve(evidenceDirectory), `${name}-mcp-cleanup.json`),
      JSON.stringify({ ownedLoopbackPortClosed: true, port }) + "\n",
      { mode: 0o600 },
    );
  });
  const f = await liveFixture(t, name, true, {
    evidenceDirectory,
    prepareCliWorkspace: async ({ storageDirectory, workspacePath }) => {
      configFile = join(storageDirectory, "cli", "config.json");
      userSkill = join(storageDirectory, "skills", "owned-user", "SKILL.md");
      projectSkill = join(
        workspacePath,
        ".agents",
        "skills",
        "owned-project",
        "SKILL.md",
      );
      for (const file of [configFile, userSkill, projectSkill])
        await mkdir(dirname(file), { recursive: true });
      await writeFile(userSkill, skillDocument("owned-user", userMarker));
      await writeFile(
        projectSkill,
        skillDocument("owned-project", projectMarker),
      );
      await writeFile(
        configFile,
        JSON.stringify({
          mcp: {
            servers: {
              [serverName]: {
                type: "http",
                url: `http://127.0.0.1:${port}/mcp`,
                protocolVersion: "legacy",
              },
            },
          },
        }),
      );
    },
    reply(body) {
      if (!body.stream) return { text: "Controlled personal ports title" };
      assert.ok(stage, "a stage must be installed before a real model request");
      stage.requests.push(structuredClone(body));
      const result = (body.messages as Row[]).findLast(
        (message) =>
          message.role === "tool" && message.tool_call_id === stage!.id,
      );
      if (result)
        stage.results.push(
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content),
        );
      if (!stage.issued) {
        stage.issued = true;
        return {
          toolCall: {
            id: stage.id,
            name: stage.tool,
            arguments: JSON.stringify(stage.input),
          },
        };
      }
      return { text: "G06_CONTROL_COMPLETE" };
    },
  });
  async function publish(kind: "personal" | "security", patch: Row) {
    const path = `${f.p}/configurations/${kind}`;
    const current = await f.api<Row>(path, "GET", undefined, f.login.token);
    const saved = await f.api<Row>(
      path,
      "PUT",
      {
        revision: current.revision,
        data: { ...(current.published as Row), ...patch },
      },
      f.login.token,
    );
    await f.api(
      `${path}/publish`,
      "POST",
      { revision: saved.revision },
      f.login.token,
    );
  }
  await publish("personal", { skills: true, connectors: true });
  await publish("security", {
    allowShell: true,
    allowFilesystem: true,
    allowNetwork: true,
    dangerousSkills: true,
    allowedDomains: [],
  });
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged(true);
  await eventually(async () => methods.includes("tools/list"), Boolean, 10000);
  assert.equal((await cli.setMode("yolo")).status, "accepted");
  const originalConfig = await readFile(configFile);
  async function run(
    label: string,
    tool: string,
    input: Row,
    modelExpected = true,
  ) {
    stage = {
      id: `g06-${randomUUID()}`,
      tool,
      input,
      issued: false,
      results: [],
      requests: [],
    };
    const current = stage,
      offset = cli.notifications.length,
      modelBefore = f.calls(),
      mcpBefore = calls.length,
      methodsBefore = methods.length;
    const ack = await cli.send(`CONTROL_G06 ${label}: use ${tool} once`);
    assert.equal(ack.status, "accepted");
    const terminal = await eventually(
      async () =>
        cli.notifications
          .slice(offset)
          .find(
            (notice) =>
              notice.method === "v4/telemetry/event" &&
              notice.params.kind === "turn.terminal" &&
              typeof notice.params.sourceCommandId === "string",
          ),
      Boolean,
      20000,
    );
    assert.equal(
      current.issued,
      modelExpected,
      `${label}: actual supplier issue count`,
    );
    assert.equal(current.results.length, modelExpected ? 1 : 0);
    const text =
      JSON.stringify(cli.notifications.slice(offset)) +
      current.results.join("\n");
    observations.push({
      label,
      tool,
      terminalStatus: terminal!.params.status,
      modelRequests: f.calls() - modelBefore,
      mcpCalls: calls.length - mcpBefore,
      mcpFrames: methods.length - methodsBefore,
      ownToolResult: current.results,
    });
    return {
      text,
      result: current.results.join("\n"),
      requests: current.requests,
      modelRequests: f.calls() - modelBefore,
      mcpFrames: methods.length - methodsBefore,
    };
  }
  async function preserve() {
    assert.deepEqual(await readFile(configFile), originalConfig);
    assert.equal(
      await readFile(userSkill, "utf8"),
      skillDocument("owned-user", userMarker),
    );
    assert.equal(
      await readFile(projectSkill, "utf8"),
      skillDocument("owned-project", projectMarker),
    );
  }
  async function report(check: string) {
    await preserve();
    f.check(check);
    await writeFile(
      join(resolve(evidenceDirectory), `${name}-side-effects.json`),
      JSON.stringify(
        {
          status: "passed",
          observations,
          actualMcpFrames: methods,
          actualMcpCalls: calls,
          personalFilesAndConfigUnchanged: true,
          externalMcpUsed: false,
          seededConfigNotUiCreation: true,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  return { ...f, cli, publish, run, report, calls, methods, preserve };
}

test(
  "packaged personal user/project Skill bodies obey both current switches",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "personal-skills");
    for (const [skill, marker] of [
      ["owned-user", userMarker],
      ["owned-project", projectMarker],
    ]) {
      const allowed = await f.run(`load ${skill}`, "Skill", { skill });
      assert.ok(allowed.result.includes(marker!));
      assert.ok(
        allowed.requests.some((request) =>
          JSON.stringify(request).includes(marker!),
        ),
      );
    }
    const forged = await f.run(
      "personal name cannot obtain enterprise namespace",
      "Skill",
      { skill: "enterprise:owned-user" },
    );
    assert.match(forged.result, /enterprise_skill_not_found/);
    assert.ok(!forged.result.includes(userMarker));
    await f.publish("personal", { skills: false });
    const denied = await f.run(
      "personal.skills revoked in existing runtime",
      "Skill",
      { skill: "owned-user" },
    );
    assert.match(denied.result, /enterprise_skill_not_found/);
    assert.ok(!denied.result.includes(userMarker));
    await f.publish("personal", { skills: true });
    await f.publish("security", { dangerousSkills: false });
    const dangerous = await f.run(
      "dangerousSkills revoked in existing runtime",
      "Skill",
      { skill: "owned-project" },
    );
    assert.match(dangerous.result, /enterprise_skill_not_found/);
    assert.ok(!dangerous.result.includes(projectMarker));
    const assetLoads = f.privateFrames.filter((frame) => {
      const value = frame as { params?: Row };
      return value.params?.phase === "asset_load";
    }) as { params: Row }[];
    assert.ok(assetLoads.length > 0);
    assert.ok(
      assetLoads.every((frame) => frame.params.asset === undefined),
      "personal skills never gain enterprise asset provenance",
    );
    await f.report(
      "actual-user-project-Skill-bodies-switch-revocation-and-enterprise-namespace-isolation",
    );
  },
);

test(
  "packaged already connected personal MCP obeys publication without deleting config",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "personal-mcp");
    const allowed = await f.run("personal MCP allowed", mcpTool, {
      marker: "G06_ALLOWED",
    });
    assert.match(allowed.result, /G06_MCP_EXECUTED:G06_ALLOWED/);
    assert.deepEqual(f.calls, [{ marker: "G06_ALLOWED" }]);
    const before = f.methods.length;
    await f.publish("personal", { connectors: false });
    const denied = await f.run(
      "personal MCP revoked in existing connection",
      mcpTool,
      { marker: "G06_MUST_NOT_EXECUTE" },
    );
    assert.match(denied.result, /enterprise_personal_connectors_denied/);
    assert.equal(f.methods.length, before);
    assert.equal(denied.mcpFrames, 0);
    assert.deepEqual(f.calls, [{ marker: "G06_ALLOWED" }]);
    await f.report(
      "actual-personal-MCP-positive-marker-current-revocation-zero-server-dispatch-config-preserved",
    );
  },
);

test(
  "real identity logout fences the existing personal runtime before a new model or MCP effect",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "personal-logout");
    assert.match(
      (
        await f.run("personal Skill before logout", "Skill", {
          skill: "owned-user",
        })
      ).result,
      /G06_OWNED_USER_BODY/,
    );
    assert.match(
      (
        await f.run("personal MCP before logout", mcpTool, {
          marker: "G06_BEFORE_LOGOUT",
        })
      ).result,
      /G06_MCP_EXECUTED:G06_BEFORE_LOGOUT/,
    );
    await f.logoutIdentity();
    const before = f.methods.length;
    const denied = await f.run(
      "same runtime after real identity logout",
      mcpTool,
      { marker: "G06_AFTER_LOGOUT_MUST_NOT_EXECUTE" },
      false,
    );
    assert.equal(denied.modelRequests, 0);
    assert.equal(f.methods.length, before);
    assert.match(
      denied.text,
      /enterprise_(?:session_missing|identity_changed|policy_unavailable)/,
    );
    assert.deepEqual(f.calls, [{ marker: "G06_BEFORE_LOGOUT" }]);
    await f.report(
      "real-identity-owner-logout-existing-runtime-zero-model-MCP-dispatch-personal-config-preserved",
    );
  },
);
