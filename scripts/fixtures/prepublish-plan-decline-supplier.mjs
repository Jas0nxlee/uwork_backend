import assert from "node:assert/strict";
import { PLAN_A, PLAN_B } from "./prepublish-plan-approval-supplier.mjs";
import { ExitPlanModeInputSchema } from "../../clients/uwork/apps/zcode-cli/packages/contracts/src/tools/plan-mode.ts";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
export function createPlanDeclineSupplier() {
  let entered = false,
    proposed = 0,
    approved = false;
  const proposal = (id, plan) => ({
    toolCall: {
      id,
      name: "ExitPlanMode",
      arguments: JSON.stringify(ExitPlanModeInputSchema.parse({ plan })),
    },
  });
  return {
    reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex(
          (m) =>
            m.role === "user" &&
            [
              "PREPUBLISH_PLAN_DECLINE",
              "PREPUBLISH_PLAN_DECLINE_RESUME",
            ].includes(text(m)),
        ),
        query = text(body.messages[last]);
      if (query === "PREPUBLISH_PLAN_DECLINE") {
        const tools = body.messages
          .slice(last + 1)
          .filter((m) => m.role === "tool");
        if (tools.length === 0) {
          assert.equal(entered, false);
          assert.ok(
            body.tools.some((t) => t.function?.name === "EnterPlanMode"),
          );
          entered = true;
          return {
            toolCall: {
              id: "owned-plan-decline-enter",
              name: "EnterPlanMode",
              arguments: "{}",
            },
          };
        }
        assert.equal(
          tools.length,
          1,
          "plain plan decline must stop the turn before any further model request",
        );
        assert.equal(tools[0].tool_call_id, "owned-plan-decline-enter");
        assert.ok(text(tools[0]).includes("Entered plan mode"));
        assert.equal(proposed, 0);
        proposed++;
        return proposal("owned-plan-decline-first", PLAN_A);
      }
      if (query === "PREPUBLISH_PLAN_DECLINE_RESUME") {
        assert.equal(entered, true);
        const old = body.messages.filter(
          (m) =>
            m.role === "tool" && m.tool_call_id === "owned-plan-decline-first",
        );
        assert.equal(old.length, 1);
        assert.ok(text(old[0]).includes("Permission denied for ExitPlanMode"));
        const tools = body.messages
          .slice(last + 1)
          .filter((m) => m.role === "tool");
        if (tools.length === 0) {
          assert.equal(proposed, 1);
          assert.ok(
            body.tools.some((t) => t.function?.name === "ExitPlanMode"),
          );
          proposed++;
          return proposal("owned-plan-decline-resumed", PLAN_B);
        }
        assert.equal(tools.length, 1);
        assert.equal(tools[0].tool_call_id, "owned-plan-decline-resumed");
        assert.equal(
          text(tools[0]),
          "User has approved your plan. You can now start coding. Start with updating your todo list if applicable.\n\n## Approved Plan:\n" +
            PLAN_B.trim(),
        );
        assert.equal(approved, false);
        approved = true;
        return {
          text: "原生企业资产联动完成。 PREPUBLISH_PLAN_DECLINE_RESUMED",
        };
      }
      return undefined;
    },
    status() {
      return { entered, proposed, approved };
    },
  };
}
