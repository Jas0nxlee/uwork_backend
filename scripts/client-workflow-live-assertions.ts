import assert from "node:assert/strict";
import { eventually } from "./client-native-session-fixture.js";
import {
  actor,
  currentTools,
  harness,
  step,
  terminal,
} from "./client-workflow-assets-live-fixture.js";

export async function filesystemFailure(
  cli: Parameters<typeof terminal>[0],
  h: ReturnType<typeof harness>,
  runId: string,
) {
  await terminal(cli, "errored");
  const settlement = cli.notifications.find(
    (v) =>
      v.params.kind === "workflow.lifecycle" &&
      v.params.runId === runId &&
      v.params.status === "errored",
  );
  assert.match(
    String(settlement?.params.errorMessage),
    /enterprise_filesystem_denied/u,
  );
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v) =>
          v.params.kind === "model.request.status" &&
          v.params.querySource === "main_turn" &&
          v.params.status === "model_request_completed",
      ),
    10000,
  );
  const second = h.bodies.filter((b) => actor(b) && step(b) === 2);
  assert.equal(
    second.length,
    1,
    "the already admitted initial request did occur",
  );
  assert.equal(
    currentTools(second[0]!).length,
    0,
    "no tool-result continuation may dispatch",
  );
  assert.ok(
    JSON.stringify(second[0]!.messages).includes(
      "WORKFLOW_APPROVED_SKILL_VERSION_ONE",
    ),
  );
  const cancel = await cli.workflow.cancel(runId);
  assert.equal(cancel.status, "failed");
  assert.equal(
    cancel.reasonCode,
    "fault.command.backgroundWorkCancelRejected.not_running",
  );
  return {
    terminalStatus: "errored",
    refusal: settlement?.params.errorMessage,
    alreadyAdmittedSecondAskRequests: second.length,
    secondAskToolResultContinuations: 0,
    firstApprovedHistoryRetained: true,
    cancelAfterTerminal: cancel,
  };
}
