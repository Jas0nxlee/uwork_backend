import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import {
  liveFixture,
  eventually,
  type ControlledSessionHooks,
} from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type Stage = {
  name: string;
  tool: string;
  input: Row;
  id: string;
  issued: boolean;
  results: string[];
};
const evidenceDirectory = "evidence/client-builtin-policy-live-20261017";
const shellQuote = (value: string) =>
  "'" + value.replaceAll("'", "'\\''") + "'";
const exists = (path: string) =>
  stat(path).then(
    () => true,
    (error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return false;
      throw error;
    },
  );
async function fixture(
  t: TestContext,
  name: string,
  additions: Pick<
    ControlledSessionHooks,
    "prepareCliWorkspace" | "onPermissionRequest"
  > = {},
) {
  let stage: Stage | undefined;
  const observations: Row[] = [];
  const hooks: ControlledSessionHooks = {
    evidenceDirectory,
    ...additions,
    reply(body) {
      if (!body.stream) return { text: "Controlled builtin policy title" };
      assert.ok(stage, "test stage must be installed before sending");
      const messages = body.messages as Row[];
      const result = messages.findLast(
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
      return { text: "CONTROL_BUILTIN_COMPLETE" };
    },
  };
  const f = await liveFixture(t, name, true, hooks);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged(true);
  async function security(patch: Row) {
    const current = await f.api<Row>(
      `${f.p}/configurations/security`,
      "GET",
      undefined,
      f.login.token,
    );
    const saved = await f.api<Row>(
      `${f.p}/configurations/security`,
      "PUT",
      {
        revision: current.revision,
        data: { ...(current.published as Row), ...patch },
      },
      f.login.token,
    );
    await f.api(
      `${f.p}/configurations/security/publish`,
      "POST",
      { revision: saved.revision },
      f.login.token,
    );
  }
  async function run(name: string, tool: string, input: Row) {
    stage = {
      name,
      tool,
      input,
      id: `g07-${randomUUID()}`,
      issued: false,
      results: [],
    };
    const current = stage,
      offset = cli.notifications.length;
    const ack = await cli.send(
      `CONTROL_G07 ${name}: call the specified tool once`,
    );
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
      (value) => !!value,
      20000,
    );
    assert.ok(
      current.issued,
      "actual supplier must have returned the builtin tool call",
    );
    assert.equal(
      current.results.length,
      1,
      "the real supplier must receive this builtin call's own result exactly once",
    );
    const text =
      JSON.stringify(cli.notifications.slice(offset)) +
      current.results.join("\n");
    observations.push({
      name,
      tool,
      terminalStatus: terminal!.params.status,
      toolResultCount: current.results.length,
      toolResult: current.results.join("\n"),
    });
    return { results: current.results, text };
  }
  async function report(values: Row) {
    await mkdir(resolve(evidenceDirectory), { recursive: true });
    await writeFile(
      join(resolve(evidenceDirectory), `${name}-side-effects.json`),
      JSON.stringify(
        { status: "passed", actualToolObservations: observations, ...values },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  return { ...f, cli, security, run, report };
}

test(
  "packaged Read and Write use current filesystem policy despite yolo",
  { timeout: 60000 },
  async (t) => {
    const marker = "G07_OWNED_READ_MARKER";
    const f = await fixture(t, "builtin-files", {
      prepareCliWorkspace: async ({ workspacePath }) => {
        await writeFile(join(workspacePath, "owned-read.txt"), marker);
      },
    });
    assert.equal((await f.cli.setMode("yolo")).status, "accepted");
    const seed = join(f.cli.workspacePath, "owned-read.txt"),
      allowWrite = join(f.cli.workspacePath, "allowed-write.txt"),
      denyWrite = join(f.cli.workspacePath, "denied-write.txt");
    await f.security({
      allowShell: false,
      allowFilesystem: false,
      allowNetwork: true,
      allowedDomains: [],
    });
    const deniedRead = await f.run("Read denied in yolo", "Read", {
      file_path: seed,
    });
    assert.match(deniedRead.text, /enterprise_filesystem_denied/);
    assert.ok(
      !deniedRead.results.join("\n").includes(marker),
      "denied Read never returns the owned file marker to the model",
    );
    const deniedWrite = await f.run("Write denied in yolo", "Write", {
      file_path: denyWrite,
      content: "MUST_NOT_BE_WRITTEN",
    });
    assert.match(deniedWrite.text, /enterprise_filesystem_denied/);
    assert.equal(await exists(denyWrite), false);
    await f.security({ allowFilesystem: true });
    const read = await f.run("Read allowed", "Read", { file_path: seed });
    assert.ok(
      read.results.some((text) => text.includes(marker)),
      "actual Read bytes must reach the real supplier as the selected tool result",
    );
    const write = await f.run("Write allowed", "Write", {
      file_path: allowWrite,
      content: "G07_ALLOWED_WRITE",
    });
    assert.equal(await readFile(allowWrite, "utf8"), "G07_ALLOWED_WRITE");
    assert.ok(
      write.results.some((text) =>
        /created successfully|written successfully|updated successfully/i.test(
          text,
        ),
      ),
    );
    await f.security({ allowFilesystem: false });
    const revokedPath = join(f.cli.workspacePath, "revoked-write.txt");
    const revoked = await f.run("Write revoked in same session", "Write", {
      file_path: revokedPath,
      content: "MUST_NOT_BE_WRITTEN",
    });
    assert.match(revoked.text, /enterprise_filesystem_denied/);
    assert.equal(await exists(revokedPath), false);
    assert.equal(await readFile(seed, "utf8"), marker);
    f.check(
      "actual-builtin-Read-Write-allow-real-bytes-and-file-deny-revoked-yolo-no-file",
    );
    await f.report({
      yoloCommandAccepted: true,
      readAllowedMarkerObserved: true,
      allowedWriteContentMatched: true,
      deniedWriteAbsent: true,
      revokedWriteAbsent: true,
      readSeedUnchanged: true,
    });
  },
);

test(
  "packaged Bash runs an owned harmless Node process only under full native capability permission",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "builtin-bash");
    assert.equal((await f.cli.setMode("yolo")).status, "accepted");
    const allowed = join(f.cli.workspacePath, "allowed-node.json"),
      denied = join(f.cli.workspacePath, "denied-node.json");
    const input = (path: string) => ({
      command: `${shellQuote(process.execPath)} -e ${shellQuote(`require("node:fs").writeFileSync(${JSON.stringify(path)},JSON.stringify({marker:"G07_NATIVE_NODE",pid:process.pid}));process.stdout.write("G07_NODE_PROCESS_OK")`)}`,
      description: "Write the owned builtin test marker",
      timeout: 5000,
      run_in_background: false,
    });
    await f.security({
      allowShell: false,
      allowFilesystem: true,
      allowNetwork: true,
      allowedDomains: [],
    });
    const blocked = await f.run("Bash denied in yolo", "Bash", input(denied));
    assert.match(blocked.text, /enterprise_shell_denied/);
    assert.equal(await exists(denied), false);
    await f.security({ allowShell: true });
    const run = await f.run("Bash allowed native Node", "Bash", input(allowed));
    const output = JSON.parse(await readFile(allowed, "utf8")) as Row;
    assert.equal(output.marker, "G07_NATIVE_NODE");
    assert.equal(typeof output.pid, "number");
    assert.ok(run.results.some((text) => text.includes("G07_NODE_PROCESS_OK")));
    const native = f.privateFrames.some(
      (frame) =>
        !!frame &&
        typeof frame === "object" &&
        "params" in frame &&
        !!frame.params &&
        typeof frame.params === "object" &&
        "phase" in frame.params &&
        frame.params.phase === "native_execution",
    );
    assert.equal(
      native,
      true,
      "actual native ExecutionPort performs a second private Host authorization",
    );
    f.check(
      "actual-builtin-Bash-native-Node-file-and-stdout-shell-denied-yolo-zero-file",
    );
    await f.report({
      deniedNativeMarkerAbsent: true,
      allowedNativeMarkerMatched: true,
      actualNodePid: output.pid,
      stdoutMarkerObserved: true,
      privateNativeAuthorizationObserved: true,
    });
  },
);

test(
  "packaged user approval cannot override a later backend filesystem denial",
  { timeout: 60000 },
  async (t) => {
    let revoke = false,
      permissions = 0;
    const f = await fixture(t, "builtin-approval", {
      onPermissionRequest: async (params) => {
        assert.equal(params.toolName, "Write");
        permissions++;
        if (revoke) await changePolicy();
        return { decision: "allow" };
      },
    });
    async function changePolicy(): Promise<void> {
      await f.security({ allowFilesystem: false });
    }
    await f.security({
      allowShell: false,
      allowFilesystem: true,
      allowNetwork: true,
      allowedDomains: [],
    });
    const accepted = join(f.cli.workspacePath, "approved-write.txt");
    await f.run("Write allowed after real approval", "Write", {
      file_path: accepted,
      content: "G07_APPROVED_WRITE",
    });
    assert.equal(await readFile(accepted, "utf8"), "G07_APPROVED_WRITE");
    assert.equal(
      permissions,
      1,
      "positive control must traverse the real reverse permission RPC",
    );
    revoke = true;
    const denied = join(f.cli.workspacePath, "late-approved-write.txt");
    const result = await f.run(
      "Write approval arrives after revocation",
      "Write",
      { file_path: denied, content: "MUST_NOT_BE_WRITTEN" },
    );
    assert.equal(permissions, 2);
    assert.match(result.text, /enterprise_filesystem_denied/);
    assert.equal(await exists(denied), false);
    f.check(
      "actual-user-approval-positive-file-post-approval-current-backend-revocation-zero-file",
    );
    await f.report({
      realPermissionResponsesAllowed: permissions,
      positiveApprovalFileMatched: true,
      backendRevokedBeforeSecondAllowedResponse: true,
      staleApprovedFileAbsent: true,
    });
  },
);

test(
  "packaged trusted PreToolUse allow is followed by current backend admission",
  { timeout: 60000 },
  async (t) => {
    let hookMarker = "",
      hookRelease = "";
    const f = await fixture(t, "builtin-hook", {
      prepareCliWorkspace: async ({ workspacePath, storageDirectory }) => {
        hookMarker = join(workspacePath, "hook-entered.marker");
        hookRelease = join(workspacePath, "hook-release.marker");
        const script = join(workspacePath, "controlled-pretool-hook.cjs");
        await writeFile(
          script,
          `const fs=require("node:fs");process.stdin.resume();process.stdin.on("end",()=>{fs.writeFileSync(${JSON.stringify(hookMarker)},"G07_HOOK_ENTERED");let attempts=0;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(hookRelease)})){clearInterval(timer);process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow"}}));}else if(++attempts>400){clearInterval(timer);process.exitCode=2;}},10);});`,
        );
        const config = join(storageDirectory, "cli", "config.json");
        await mkdir(dirname(config), { recursive: true });
        await writeFile(
          config,
          JSON.stringify({
            hooks: {
              enabled: true,
              events: {
                PreToolUse: [
                  {
                    matcher: "Write",
                    hooks: [
                      {
                        type: "process",
                        command: process.execPath,
                        args: [script],
                        timeoutMs: 6000,
                      },
                    ],
                  },
                ],
              },
            },
          }),
        );
      },
    });
    assert.equal((await f.cli.setMode("yolo")).status, "accepted");
    await f.security({
      allowShell: true,
      allowFilesystem: true,
      allowNetwork: true,
      allowedDomains: [],
    });
    const denied = join(f.cli.workspacePath, "hook-allowed-but-revoked.txt");
    const pending = f.run("Hook allow after backend revocation", "Write", {
      file_path: denied,
      content: "MUST_NOT_BE_WRITTEN",
    });
    await eventually(() => exists(hookMarker), Boolean, 10000);
    try {
      await f.security({ allowFilesystem: false });
    } finally {
      await writeFile(hookRelease, "release-owned-hook");
    }
    const result = await pending;
    assert.match(result.text, /enterprise_filesystem_denied/);
    assert.equal(await exists(denied), false);
    assert.equal(await readFile(hookMarker, "utf8"), "G07_HOOK_ENTERED");
    f.check(
      "actual-user-config-PreToolUse-process-allow-cannot-override-post-hook-backend-denial",
    );
    await f.report({
      trustedUserHookActuallyRan: true,
      alreadyAdmittedHookMarkerExists: true,
      hookReturnedAllowAfterPolicyRevocation: true,
      targetFileAbsent: true,
      noRollbackClaimForHookMarker: true,
    });
  },
);

test(
  "packaged WebFetch preserves both enterprise domain denial and its local SSRF safety boundary",
  { timeout: 60000 },
  async (t) => {
    let networkRequests = 0;
    const server = createServer((_req, res) => {
      networkRequests++;
      res.end("G07_NETWORK_MARKER");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    });
    const f = await fixture(t, "builtin-webfetch");
    assert.equal((await f.cli.setMode("yolo")).status, "accepted");
    const url = `https://localhost:${(server.address() as { port: number }).port}/owned-network-target`;
    await f.security({
      allowShell: false,
      allowFilesystem: false,
      allowNetwork: true,
      allowedDomains: ["127.0.0.1"],
    });
    const denied = await f.run(
      "WebFetch enterprise domain denied",
      "WebFetch",
      { url, prompt: "Read the owned marker" },
    );
    assert.match(denied.text, /enterprise_domain_denied/);
    assert.equal(networkRequests, 0);
    await f.security({ allowedDomains: ["127.0.0.1"] });
    const local = await f.run(
      "WebFetch enterprise allowed but local SSRF blocked",
      "WebFetch",
      {
        url: url.replace("localhost", "127.0.0.1"),
        prompt: "Read the owned marker",
      },
    );
    assert.match(
      local.results.join("\n"),
      /EgressBlocked|private or local|EGRESS_BLOCKED/,
    );
    assert.ok(
      !local.results.join("\n").includes("enterprise_domain_denied"),
      "the second operation must get past the enterprise domain check",
    );
    assert.equal(networkRequests, 0);
    f.check(
      "actual-WebFetch-backend-domain-deny-and-policy-allow-Core-local-SSRF-refusal-zero-target-requests",
    );
    await f.report({
      realTargetRequests: networkRequests,
      enterpriseDomainDeniedBeforeDispatch: true,
      allowedEnterpriseDomainReachedCoreLiteralEgressGuard: true,
      ssrfAndTlsUnchanged: true,
      publicNetworkPositiveNotClaimed: true,
    });
  },
);
