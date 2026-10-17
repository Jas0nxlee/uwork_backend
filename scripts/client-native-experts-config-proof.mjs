import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const APPROVED = "NATIVE_APPROVED_ENTERPRISE_EXPERT_V1";
const SHADOW = "NATIVE_PERSONAL_SHADOW_MUST_NOT_REPLACE_ENTERPRISE";
const DESKTOP = "# UWork Desktop Context";
const CHILD = "NATIVE_ENTERPRISE_EXPERT_CHILD";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const text = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => part.text ?? "").join("")
      : "";

export function analyzeExpertProof(before, after, trigger) {
  if (!/^EXPERT_CONFIG_FINAL_(WARM|COLD)$/.test(trigger))
    throw new Error("Expected one explicit Native expert phase marker");
  const previous = before.modelRequests ?? [];
  const all = after.modelRequests ?? [];
  const failures = [];
  if (before.modelCalls !== previous.length)
    failures.push("before_model_call_request_count_mismatch");
  if (after.modelCalls !== all.length)
    failures.push("after_model_call_request_count_mismatch");
  if (
    all.length < previous.length ||
    JSON.stringify(all.slice(0, previous.length)) !== JSON.stringify(previous)
  )
    failures.push("snapshot_request_prefix_changed");
  const requests = all.slice(previous.length).map((body, offset) => {
    const messages = body.messages ?? [];
    const system = messages
      .filter((message) => message.role === "system")
      .map(text)
      .join("\n");
    const user = text(messages.findLast((message) => message.role === "user"));
    return {
      requestIndex: previous.length + offset,
      bodySha256: digest(JSON.stringify(body)),
      systemSha256: digest(system),
      streaming: body.stream === true,
      phaseRoot: body.stream === true && user.includes(trigger),
      hasAgentTool:
        body.tools?.some((tool) => tool.function?.name === "Agent") ?? false,
      enterpriseChild: system.includes(APPROVED) && user.includes(CHILD),
      hasApprovedSystem: system.includes(APPROVED),
      hasDesktopSystem: system.includes(DESKTOP),
      hasPersonalShadowAnywhere: JSON.stringify(body).includes(SHADOW),
      toolError: messages.some(
        (message) =>
          message.role === "tool" &&
          /Agent type .*not found|enterprise_asset_selection_changed|Enterprise expert catalog denied/i.test(
            text(message),
          ),
      ),
    };
  });
  const roots = requests.filter((request) => request.phaseRoot);
  const children = requests.filter((request) => request.enterpriseChild);
  if (!roots.length) failures.push("actual_root_request_missing");
  if (
    roots.some((request) => !request.hasDesktopSystem || !request.hasAgentTool)
  )
    failures.push("root_desktop_or_agent_missing");
  if (!children.length)
    failures.push("actual_approved_enterprise_child_missing");
  if (children.some((request) => request.hasDesktopSystem))
    failures.push("desktop_leaked_to_child");
  if (
    requests.some(
      (request) => request.hasApprovedSystem && !request.enterpriseChild,
    )
  )
    failures.push("approved_body_without_expected_child_prompt");
  if (requests.some((request) => request.hasPersonalShadowAnywhere))
    failures.push("personal_shadow_seen");
  if (requests.some((request) => request.toolError))
    failures.push("expert_tool_error_seen");
  const oldLedger = before.ledger ?? [];
  const ledger = after.ledger ?? [];
  const oldIds = new Set(oldLedger.map((item) => item.id));
  if (
    oldLedger.some((item) => !ledger.some((current) => current.id === item.id))
  )
    failures.push("old_ledger_row_removed");
  if (
    oldLedger.some((item) =>
      ledger.some(
        (current) =>
          current.id === item.id &&
          JSON.stringify(current) !== JSON.stringify(item),
      ),
    )
  )
    failures.push("old_ledger_row_changed");
  const newLedger = ledger.filter((item) => !oldIds.has(item.id));
  if (requests.length !== newLedger.length)
    failures.push("new_request_ledger_count_mismatch");
  if (!newLedger.length) failures.push("actual_ledger_missing");
  if (newLedger.some((item) => item.status !== "settled"))
    failures.push("new_ledger_not_all_settled");
  const newTraffic = (after.traffic ?? []).slice((before.traffic ?? []).length);
  if (newTraffic.some((item) => item.status === 402))
    failures.push("http_402_seen");
  return {
    status: failures.length ? "failed" : "passed",
    trigger,
    beforeRequests: previous.length,
    afterRequests: all.length,
    beforeModelCalls: before.modelCalls,
    afterModelCalls: after.modelCalls,
    deltaRequests: requests.length,
    deltaLedger: newLedger.length,
    rootRequestIndices: roots.map((request) => request.requestIndex),
    childRequestIndices: children.map((request) => request.requestIndex),
    requests,
    newLedger,
    newHttpStatusCounts: Object.fromEntries(
      [...new Set(newTraffic.map((item) => item.status))].map((status) => [
        status,
        newTraffic.filter((item) => item.status === status).length,
      ]),
    ),
    failures,
    uiReplyAloneAccepted: false,
  };
}

function evidencePath(path) {
  const root = resolve("evidence");
  const target = resolve(path);
  const part = relative(root, target);
  if (!part || part.startsWith("..") || isAbsolute(part))
    throw new Error("Proof paths must stay under repository evidence");
  return target;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [beforePath, afterPath, trigger, outputPath] = process.argv.slice(2);
  if (!beforePath || !afterPath || !trigger || !outputPath)
    throw new Error(
      "Usage: proof before.json after.json EXPERT_CONFIG_FINAL_WARM|COLD output.json",
    );
  const before = JSON.parse(await readFile(evidencePath(beforePath), "utf8"));
  const after = JSON.parse(await readFile(evidencePath(afterPath), "utf8"));
  const result = analyzeExpertProof(before, after, trigger);
  await writeFile(evidencePath(outputPath), JSON.stringify(result, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: result.status,
      trigger,
      rootRequestIndices: result.rootRequestIndices,
      childRequestIndices: result.childRequestIndices,
      failures: result.failures,
    }),
  );
  if (result.status !== "passed") process.exitCode = 1;
}
