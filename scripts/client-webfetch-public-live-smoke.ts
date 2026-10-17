import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { eventually, liveFixture } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type ProcessingObservation = {
  characters: number;
  sha256: string;
  exampleTitleObserved: boolean;
  documentationPurposeObserved: boolean;
};
type Stage = {
  name: string;
  id: string;
  issued: boolean;
  results: string[];
  processing: ProcessingObservation[];
};
const evidenceDirectory = resolve("evidence/client-webfetch-public-20261017");
const target = "https://example.com/";
const processingMarker =
  "G07_PUBLIC_BODY_CONFIRMED: Example Domain documentation";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const asRow = (value: unknown): Row | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
const messageText = (message: Row) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content
          .map((part: unknown) => asRow(part)?.text)
          .filter((text): text is string => typeof text === "string")
          .join("\n")
      : "";

test(
  "packaged WebFetch reads one real public HTTPS page and same runtime obeys network revocation",
  { timeout: 120000 },
  async (t) => {
    const cliPath = resolve(
      "clients/uwork/packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
    );
    const sourceCliPath = resolve(
      "clients/uwork/apps/zcode-cli/packages/cli/dist/zcode.cjs",
    );
    const cliSha = hash(await readFile(cliPath));
    // 验当前候选产物一致且运行中不变；历史 SHA 是证据，不是下一次修复的行为合同。
    assert.equal(
      hash(await readFile(sourceCliPath)),
      cliSha,
      "source and staged CLI must match",
    );
    let stage: Stage | undefined;
    const observations: Row[] = [];
    const f = await liveFixture(t, "webfetch-public", true, {
      evidenceDirectory,
      reply(body) {
        const messages = (body.messages as Row[]) ?? [];
        const prompt = messages
          .map(messageText)
          .find((text) => text.includes("Web page content:\n---\n"));
        if (prompt) {
          assert.ok(
            stage,
            "WebFetch processing must belong to an active stage",
          );
          const content =
            prompt.split("Web page content:\n---\n")[1]?.split("\n---\n")[0] ??
            "";
          const observed = {
            characters: content.length,
            sha256: hash(content),
            exampleTitleObserved: /Example Domain/i.test(content),
            documentationPurposeObserved:
              /documentation|illustrative examples/i.test(content),
          };
          stage.processing.push(observed);
          return {
            text:
              observed.exampleTitleObserved &&
              observed.documentationPurposeObserved
                ? processingMarker
                : "G07_PUBLIC_BODY_UNEXPECTED",
          };
        }
        if (!body.stream) return { text: "Controlled public WebFetch title" };
        assert.ok(stage, "install the real supplier stage before a command");
        const result = messages.findLast(
          (message) =>
            message.role === "tool" && message.tool_call_id === stage!.id,
        );
        if (result) stage.results.push(messageText(result));
        if (!stage.issued) {
          stage.issued = true;
          return {
            toolCall: {
              id: stage.id,
              name: "WebFetch",
              arguments: JSON.stringify({
                url: target,
                prompt:
                  "State the public page title and whether it is for documentation examples, in one short sentence.",
              }),
            },
          };
        }
        return { text: "G07_PUBLIC_FETCH_TURN_COMPLETE" };
      },
    });
    async function security(allowPublicTarget: boolean) {
      const path = `${f.p}/configurations/security`;
      const current = await f.api<Row>(path, "GET", undefined, f.login.token);
      const saved = await f.api<Row>(
        path,
        "PUT",
        {
          revision: current.revision,
          data: {
            ...(current.published as Row),
            allowShell: false,
            allowFilesystem: false,
            allowNetwork: true,
            // 后台同样约束模型上游；保留本机受控供应商，撤销只针对实际公网目标。
            allowedDomains: allowPublicTarget
              ? ["example.com", "127.0.0.1"]
              : ["127.0.0.1"],
          },
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
    const actualFrames = (offset: number) =>
      f.privateFrames
        .slice(offset)
        .map(asRow)
        .map((frame) => asRow(frame?.params))
        .filter((params): params is Row => !!params);
    await security(true);
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    assert.equal((await cli.setMode("yolo")).status, "accepted");
    const sessionId = cli.sessionId;
    async function run(name: string) {
      stage = {
        name,
        id: `g07-public-${randomUUID()}`,
        issued: false,
        results: [],
        processing: [],
      };
      const current = stage;
      const noticesBefore = cli.notifications.length;
      const framesBefore = f.privateFrames.length;
      const modelCallsBefore = f.calls();
      const ack = await cli.send(
        `CONTROL_G07_PUBLIC ${name}: call WebFetch once`,
      );
      assert.equal(ack.status, "accepted");
      const terminal = await eventually(
        async () =>
          cli.notifications
            .slice(noticesBefore)
            .find(
              (notice) =>
                notice.method === "v4/telemetry/event" &&
                notice.params.kind === "turn.terminal" &&
                typeof notice.params.sourceCommandId === "string",
            ),
        Boolean,
        85000,
      );
      assert.equal(cli.sessionId, sessionId);
      assert.ok(current.issued, "real supplier must return the WebFetch call");
      assert.equal(
        current.results.length,
        1,
        "its own tool result must reach the next real main model once",
      );
      const frames = actualFrames(framesBefore);
      const networkFrames = frames.filter(
        (params) =>
          params.phase === "network_request" &&
          asRow(params.input)?.url === target,
      );
      const toolFrames = frames.filter(
        (params) =>
          params.toolName === "WebFetch" && params.toolCallId === current.id,
      );
      const result = current.results[0]!;
      const observation = {
        name,
        sessionId,
        toolCallId: current.id,
        terminalStatus: terminal!.params.status,
        ownToolResultCount: current.results.length,
        ownToolResultCharacters: result.length,
        ownToolResultSha256: hash(result),
        ownToolResultExcerpt: result.slice(0, 768),
        actualModelCalls: f.calls() - modelCallsBefore,
        processing: current.processing,
        targetNetworkRequestFrames: networkFrames.map((params) => ({
          toolName: params.toolName,
          phase: params.phase,
          url: asRow(params.input)?.url,
        })),
        actualToolAuthorizationFrames: toolFrames.map((params) => ({
          phase: params.phase,
          toolName: params.toolName,
          toolCallId: params.toolCallId,
        })),
      };
      observations.push(observation);
      return { current, result, networkFrames, toolFrames };
    }
    const allowed = await run("public HTTPS permitted");
    const positivePassed =
      allowed.current.processing.length === 1 &&
      allowed.current.processing[0]!.exampleTitleObserved &&
      allowed.current.processing[0]!.documentationPurposeObserved &&
      allowed.result.includes(processingMarker) &&
      allowed.networkFrames.length >= 1;
    // 即使真实公网前提失败，也完成同 runtime 撤权观察，再以失败结果保留缺口。
    await security(false);
    const revoked = await run("same runtime public HTTPS revoked");
    assert.match(revoked.result, /enterprise_domain_denied/);
    assert.ok(revoked.toolFrames.length >= 1);
    assert.equal(revoked.networkFrames.length, 0);
    assert.equal(revoked.current.processing.length, 0);
    assert.ok(!revoked.result.includes(processingMarker));
    f.check(
      "same-runtime-WebFetch-current-network-policy-denied-before-public-network-port",
    );
    if (positivePassed)
      f.check(
        "real-public-HTTPS-WebFetch-body-reaches-processing-and-own-next-main-tool-result",
      );
    for (const path of [sourceCliPath, cliPath])
      assert.equal(
        hash(await readFile(path)),
        cliSha,
        "CLI must remain frozen during the test",
      );
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, "public-webfetch-observations.json"),
      JSON.stringify(
        {
          target,
          cliSha256: cliSha,
          status: positivePassed ? "passed" : "public-success-unverified",
          oneCliAndSession: true,
          publicTargetAttempts: 1,
          dnsTlsSsrfUnchanged: true,
          paidVendorCalls: 0,
          originalResponseNotSeparatelyPersisted: true,
          revokedTargetNetworkRequestFrames: 0,
          revokedBodyProcessingRequests: 0,
          noRemoteAccessLogClaim: true,
          observations,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    assert.equal(
      positivePassed,
      true,
      "real public HTTPS/body success remains unverified; inspect the retained exact tool error, without changing DNS/TLS/SSRF or retrying other targets",
    );
  },
);
