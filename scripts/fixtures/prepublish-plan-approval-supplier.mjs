import assert from "node:assert/strict";
import { ExitPlanModeInputSchema } from "../../clients/uwork/apps/zcode-cli/packages/contracts/src/tools/plan-mode.ts";
export const PLAN_FEEDBACK = "请保留中文记录。\n只验证联动，不改业务文件。";
export const PLAN_A =
  "# 原计划A\n\nOWNED_PLAN_A\n\n1. 检查联动。\n2. 写业务文件。\n";
export const PLAN_B =
  "# 修订计划B\n\nOWNED_PLAN_B\n\n1. 检查真实前后端联动。\n2. 保留中文记录，不改业务文件。\n";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
export function createPlanApprovalSupplier({ detailOnly = false } = {}) {
  let entered = false,
    proposed = 0,
    feedbackObserved = false,
    approved = false;
  return {
    reply(body) {
      if (
        !body.stream ||
        !body.messages.some(
          (m) =>
            m.role === "user" && text(m).includes("PREPUBLISH_PLAN_APPROVAL"),
        )
      )
        return undefined;
      const tools = body.messages.filter(
        (m) => m.role === "tool" && m.tool_call_id?.startsWith("owned-plan-"),
      );
      if (tools.length === 0) {
        assert.equal(entered, false);
        assert.ok(body.tools.some((t) => t.function?.name === "EnterPlanMode"));
        entered = true;
        return {
          toolCall: {
            id: "owned-plan-enter",
            name: "EnterPlanMode",
            arguments: "{}",
          },
        };
      }
      assert.equal(tools[0].tool_call_id, "owned-plan-enter");
      assert.ok(text(tools[0]).includes("Entered plan mode"));
      if (detailOnly) {
        if (tools.length === 1) {
          assert.equal(proposed, 0);
          proposed++;
          return {
            toolCall: {
              id: "owned-plan-revised",
              name: "ExitPlanMode",
              arguments: JSON.stringify(
                ExitPlanModeInputSchema.parse({ plan: PLAN_B }),
              ),
            },
          };
        }
        assert.equal(tools.length, 2);
        assert.equal(tools[1].tool_call_id, "owned-plan-revised");
        assert.equal(
          text(tools[1]),
          "User has approved your plan. You can now start coding. Start with updating your todo list if applicable.\n\n## Approved Plan:\n" +
            PLAN_B.trim(),
        );
        assert.equal(approved, false);
        approved = true;
        return { text: "原生企业资产联动完成。 PREPUBLISH_PLAN_APPROVAL_DONE" };
      }
      if (tools.length === 1) {
        assert.equal(proposed, 0);
        assert.ok(body.tools.some((t) => t.function?.name === "ExitPlanMode"));
        proposed++;
        return {
          toolCall: {
            id: "owned-plan-first",
            name: "ExitPlanMode",
            arguments: JSON.stringify(
              ExitPlanModeInputSchema.parse({ plan: PLAN_A }),
            ),
          },
        };
      }
      assert.equal(tools[1].tool_call_id, "owned-plan-first");
      assert.equal(text(tools[1]), "The plan was not approved by the user.");
      const feedback = body.messages.filter(
        (m) => m.role === "user" && text(m) === PLAN_FEEDBACK,
      );
      assert.equal(
        feedback.length,
        1,
        "actual plan feedback must become a real user message",
      );
      feedbackObserved = true;
      if (tools.length === 2) {
        assert.equal(proposed, 1);
        proposed++;
        return {
          toolCall: {
            id: "owned-plan-revised",
            name: "ExitPlanMode",
            arguments: JSON.stringify(
              ExitPlanModeInputSchema.parse({ plan: PLAN_B }),
            ),
          },
        };
      }
      assert.equal(tools.length, 3);
      assert.equal(tools[2].tool_call_id, "owned-plan-revised");
      assert.equal(
        text(tools[2]),
        "User has approved your plan. You can now start coding. Start with updating your todo list if applicable.\n\n## Approved Plan:\n" +
          PLAN_B.trim(),
      );
      assert.equal(approved, false);
      approved = true;
      return { text: "原生企业资产联动完成。 PREPUBLISH_PLAN_APPROVAL_DONE" };
    },
    status() {
      return { entered, proposed, feedbackObserved, approved };
    },
  };
}
