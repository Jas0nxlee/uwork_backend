import assert from "node:assert/strict";
import test from "node:test";
import { analyzeExpertProof } from "./client-native-experts-config-proof.mjs";

function fixture() {
  const before = { modelCalls: 0, modelRequests: [], ledger: [], traffic: [] };
  const after = {
    modelCalls: 2,
    modelRequests: [
      {
        stream: true,
        tools: [{ function: { name: "Agent" } }],
        messages: [
          { role: "system", content: "# UWork Desktop Context" },
          { role: "user", content: "运行企业专家 EXPERT_CONFIG_FINAL_WARM" },
        ],
      },
      {
        stream: true,
        messages: [
          { role: "system", content: "NATIVE_APPROVED_ENTERPRISE_EXPERT_V1" },
          { role: "user", content: "NATIVE_ENTERPRISE_EXPERT_CHILD" },
        ],
      },
    ],
    ledger: [
      { id: "new-root", status: "settled", amount: 22 },
      { id: "new-child", status: "settled", amount: 22 },
    ],
    traffic: [{ method: "POST", status: 200 }],
  };
  return { before, after };
}

test("accepts actual root Desktop and approved child without Desktop", () => {
  const { before, after } = fixture();
  const result = analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM");
  assert.equal(result.status, "passed");
  assert.deepEqual(result.childRequestIndices, [1]);
});

test("UI or parent success without approved child never passes", () => {
  const { before, after } = fixture();
  after.modelRequests.pop();
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("actual_approved_enterprise_child_missing"),
  );
});

test("rejects Desktop leaked into child", () => {
  const { before, after } = fixture();
  after.modelRequests[1].messages[0].content += "\n# UWork Desktop Context";
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("desktop_leaked_to_child"),
  );
});

test("rejects personal shadow in any request", () => {
  const { before, after } = fixture();
  after.modelRequests[1].messages[0].content +=
    " NATIVE_PERSONAL_SHADOW_MUST_NOT_REPLACE_ENTERPRISE";
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("personal_shadow_seen"),
  );
});

test("rejects missing parent Desktop", () => {
  const { before, after } = fixture();
  after.modelRequests[0].messages[0].content = "Terminal context";
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("root_desktop_or_agent_missing"),
  );
});

test("checks snapshot prefix and phase instead of reusing an old child", () => {
  const { before, after } = fixture();
  before.modelRequests = structuredClone(after.modelRequests);
  before.modelCalls = before.modelRequests.length;
  after.modelRequests.push(structuredClone(after.modelRequests[0]));
  after.modelCalls = after.modelRequests.length;
  const result = analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM");
  assert(result.failures.includes("actual_approved_enterprise_child_missing"));
  after.modelRequests[0].messages[0].content = "Changed old request";
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("snapshot_request_prefix_changed"),
  );
});

test("keeps prior uncertain ledger but rejects any new uncertain row or 402", () => {
  const { before, after } = fixture();
  before.ledger.push({ id: "old", status: "uncertain", amount: 99 });
  after.ledger.unshift(structuredClone(before.ledger[0]));
  assert.equal(
    analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM").status,
    "passed",
  );
  after.ledger[0].status = "settled";
  after.ledger[1].status = "uncertain";
  after.traffic.push({ status: 402 });
  const result = analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM");
  assert(result.failures.includes("old_ledger_row_changed"));
  assert(result.failures.includes("new_ledger_not_all_settled"));
  assert(result.failures.includes("http_402_seen"));
});

test("one settled root ledger cannot hide a missing child ledger", () => {
  const { before, after } = fixture();
  after.ledger.pop();
  const result = analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM");
  assert.equal(result.status, "failed");
  assert(result.failures.includes("new_request_ledger_count_mismatch"));
  assert.equal(result.deltaRequests, 2);
  assert.equal(result.deltaLedger, 1);
});

test("extra unmatched settled ledger is rejected", () => {
  const { before, after } = fixture();
  after.ledger.push({ id: "unmatched", status: "settled", amount: 22 });
  assert(
    analyzeExpertProof(
      before,
      after,
      "EXPERT_CONFIG_FINAL_WARM",
    ).failures.includes("new_request_ledger_count_mismatch"),
  );
});

test("changed modelCalls counters are rejected for either snapshot", () => {
  const { before, after } = fixture();
  before.modelCalls = 1;
  after.modelCalls = 3;
  const result = analyzeExpertProof(before, after, "EXPERT_CONFIG_FINAL_WARM");
  assert.equal(result.status, "failed");
  assert(result.failures.includes("before_model_call_request_count_mismatch"));
  assert(result.failures.includes("after_model_call_request_count_mismatch"));
});
