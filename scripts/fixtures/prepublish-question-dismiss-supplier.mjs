import assert from "node:assert/strict";
import { QUESTION_INPUT } from "./prepublish-question-supplier.mjs";
import { askUserQuestionToolEntry } from "../../clients/uwork/apps/zcode-cli/packages/core/src/tool/handlers/ask-user-question.ts";

export const DISMISS_INPUT = {
  questions: QUESTION_INPUT.questions.slice(0, 1),
};
const text = (message) =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? []).map((p) => p.text ?? "").join("");
export function createQuestionDismissSupplier() {
  let asked = 0,
    declined = 0,
    recovered = 0;
  return {
    reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex((m) => m.role === "user"),
        query = text(body.messages[last]);
      const mode = query.includes("PREPUBLISH_QUESTION_DISMISS_RECOVERY")
        ? "recovery"
        : query.includes("PREPUBLISH_QUESTION_DISMISS")
          ? "dismiss"
          : undefined;
      if (!mode) return undefined;
      const results = body.messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      if (results.length === 0) {
        assert.equal(asked, mode === "dismiss" ? 0 : 1);
        assert.equal(declined, mode === "dismiss" ? 0 : 1);
        assert.ok(
          body.tools.some((t) => t.function?.name === "AskUserQuestion"),
        );
        asked++;
        return {
          toolCall: {
            id: "owned-question-" + mode,
            name: "AskUserQuestion",
            arguments: JSON.stringify(DISMISS_INPUT),
          },
        };
      }
      assert.equal(results.length, 1);
      assert.equal(results[0].tool_call_id, "owned-question-" + mode);
      if (mode === "dismiss") {
        assert.equal(declined, 0);
        assert.ok(
          text(results[0]).includes("AskUserQuestion was declined"),
          "original decline reason must reach the actual model",
        );
        assert.equal(text(results[0]).includes('"answers"'), false);
        assert.equal(
          text(results[0]).includes("do not treat this as a rejection"),
          false,
        );
        declined++;
      } else {
        assert.equal(declined, 1);
        assert.equal(recovered, 0);
        const expected = askUserQuestionToolEntry.formatModelContent({
          ...DISMISS_INPUT,
          answers: { "选择本次验证环境？": "北京" },
        });
        assert.equal(text(results[0]), expected);
        assert.deepEqual(JSON.parse(expected).answers, {
          "选择本次验证环境？": "北京",
        });
        recovered++;
      }
      return {
        text: "原生企业资产联动完成。 PREPUBLISH_QUESTION_DISMISS_DONE_" + mode,
      };
    },
    status() {
      return { asked, declined, recovered };
    },
  };
}
