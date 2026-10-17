import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { eventually } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type Client = {
  isDisposed: boolean;
  onRequest(listener: (request: Row) => void): unknown;
  respond(id: string | number, value: unknown): Promise<void>;
};
type Manager = {
  getClient(workspace: Row): Promise<Client>;
  disposeWorkspace(workspace: Row): Promise<void>;
};
type Entry = {
  manager: Manager;
  client: Client;
  workspace: Row;
  listener?: (request: Row) => void;
  replies: { id: string | number; value: unknown }[];
};
const clientRoot = resolve("clients/uwork");
const evidence = resolve("evidence/client-control-lanes-20261017/source");
const load = (path: string) =>
  import(pathToFileURL(join(clientRoot, path)).href);

test(
  "source composition trusts only actual current chat/plugin/MCP lane owners and rejects replaced/disposed callbacks",
  { timeout: 60000 },
  async (t) => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(
      join(tmpdir(), "uwork-control-lane-owners-"),
    );
    const [paths, module, managers] = await Promise.all([
      load("packages/services/src/paths.ts"),
      load("packages/services/src/zcode-agent/zcodeAgentService.ts"),
      load("packages/services/src/zcode-agent/zcodeAgentProcessManager.ts"),
    ]);
    paths.setDataBaseDir(directory);
    const entries: Entry[] = [];
    const decisions: Row[] = [];
    const facts: Row = {
      status: "running",
      boundary:
        "actual source service composition + real process manager/CLI owners; delayed reverse-handler observation probes, no fabricated current-owner result",
    };
    const prototype = managers.ZCodeAgentProcessManager.prototype as Manager;
    const getClient = prototype.getClient;
    const observer = t.mock.method(
      prototype,
      "getClient",
      async function (this: Manager, workspace: Row) {
        const client = await getClient.call(this, workspace);
        if (!entries.some((entry) => entry.client === client)) {
          const entry: Entry = {
            manager: this,
            client,
            workspace: structuredClone(workspace),
            replies: [],
          };
          entries.push(entry);
          const onRequest = client.onRequest.bind(client);
          client.onRequest = (listener) => {
            entry.listener = listener;
            return onRequest(listener);
          };
          const respond = client.respond.bind(client);
          client.respond = async (id, value) => {
            if (String(id).startsWith("ownership-probe:"))
              entry.replies.push({ id, value });
            return respond(id, value);
          };
        }
        return client;
      },
    );
    const bundle = join(
      clientRoot,
      "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
    );
    const bytes = await readFile(bundle);
    assert.ok(
      bytes.equals(
        await readFile(
          join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
        ),
      ),
    );
    facts.cliSha256 = createHash("sha256").update(bytes).digest("hex");
    const service = module.createZCodeAgentService({
      commandResolver: () => ({
        command: process.execPath,
        args: [bundle, "app-server", "--stdio"],
        env: {
          HOME: directory,
          USERPROFILE: directory,
          UWORK_DATA_BASE_DIR: directory,
          ZCODE_STORAGE_DIR: join(directory, ".uwork"),
          ZCODE_ENV: "production",
          ZCODE_ENTERPRISE_POLICY_REQUIRED: "1",
          ZCODE_MODEL_TELEMETRY_ENABLED: "false",
        },
      }),
      enterpriseToolAuthorization: {
        authorize: async (request: Row) => {
          decisions.push({
            workspace: request.workspace,
            toolName: request.toolName,
          });
          return {
            allowed: true,
            code: "allowed",
            ownerKey: "a".repeat(64),
          };
        },
      },
    });
    const workspace = {
      workspacePath: join(directory, "chat"),
      workspaceIdentity: "owned-chat",
    };
    await mkdir(workspace.workspacePath);
    t.after(async () => {
      await service.disposeAllAndWait();
      observer.mock.restore();
      paths.setDataBaseDir(null);
      await rm(directory, { recursive: true, force: true });
    });
    const probe = async (entry: Entry, override?: Row) => {
      assert.ok(
        entry.listener,
        "production service must register its actual reverse handler",
      );
      const id = `ownership-probe:${randomUUID()}`;
      const bound = {
        ...entry.workspace,
        workspaceKey: String(
          entry.workspace.workspaceIdentity ?? entry.workspace.workspacePath,
        ),
      };
      entry.listener({
        id,
        method: "interaction/authorizeEnterpriseTool",
        params: {
          workspace: override ?? bound,
          requestId: randomUUID(),
          sessionId: "owned-source-probe",
          toolCallId: randomUUID(),
          toolName: "Read",
          workingDirectory: entry.workspace.workspacePath,
          input: {
            file_path: join(String(entry.workspace.workspacePath), "owned.txt"),
          },
          phase: "before_dispatch",
          capability: {
            permission: "read",
            sideEffectScope: "none",
            readOnly: true,
            destructive: false,
          },
        },
      });
      return (await eventually(
        async () => entry.replies.find((reply) => reply.id === id),
        Boolean,
        5000,
      ))!.value;
    };
    try {
      await service.prepareStorage(workspace);
      const chat = entries[0]!;
      assert.deepEqual(await probe(chat), {
        allowed: true,
        code: "allowed",
        ownerKey: "a".repeat(64),
      });
      await service.listPlugins({ workspacePath: workspace.workspacePath });
      const plugin = entries.find((entry) => entry !== chat)!;
      assert.ok(plugin);
      assert.deepEqual(await probe(plugin), {
        allowed: true,
        code: "allowed",
        ownerKey: "a".repeat(64),
      });
      await service.listMcpServerStatuses({
        workspacePath: workspace.workspacePath,
        mcpServers: [],
        mode: "connect",
      });
      const mcp = entries.find((entry) => entry !== chat && entry !== plugin)!;
      assert.ok(mcp);
      assert.deepEqual(await probe(mcp), {
        allowed: true,
        code: "allowed",
        ownerKey: "a".repeat(64),
      });
      const beforeMismatch = decisions.length;
      assert.deepEqual(
        await probe(mcp, {
          ...mcp.workspace,
          workspaceKey: "other",
          workspaceIdentity: "other",
        }),
        { allowed: false, code: "enterprise_workspace_mismatch" },
      );
      assert.equal(decisions.length, beforeMismatch);
      await mcp.manager.disposeWorkspace(mcp.workspace);
      const beforeStale = decisions.length;
      assert.deepEqual(await probe(mcp), {
        allowed: false,
        code: "enterprise_runtime_obsolete",
      });
      assert.equal(decisions.length, beforeStale);
      await service.listMcpServerStatuses({
        workspacePath: workspace.workspacePath,
        mcpServers: [],
        mode: "connect",
      });
      const replacement = entries.at(-1)!;
      assert.notEqual(replacement.client, mcp.client);
      assert.deepEqual(await probe(replacement), {
        allowed: true,
        code: "allowed",
        ownerKey: "a".repeat(64),
      });
      await service.disposeAllAndWait();
      const beforeDispose = decisions.length;
      for (const entry of [chat, plugin, replacement])
        assert.deepEqual(await probe(entry), {
          allowed: false,
          code: "enterprise_runtime_obsolete",
        });
      assert.equal(decisions.length, beforeDispose);
      facts.status = "passed";
    } catch (error) {
      facts.status = "failed";
      facts.error = error instanceof Error ? error.message : "unknown";
      throw error;
    } finally {
      await service.disposeAllAndWait();
      facts.decisions = decisions;
      facts.clients = entries.map((entry) => ({
        workspace: entry.workspace,
        isDisposed: entry.client.isDisposed,
        replies: entry.replies,
      }));
      await writeFile(
        join(evidence, "summary.json"),
        JSON.stringify(facts, null, 2),
        { mode: 0o600 },
      );
    }
  },
);
