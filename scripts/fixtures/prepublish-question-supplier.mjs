import assert from "node:assert/strict";
import { AskUserQuestionInputSchema } from "../../clients/uwork/apps/zcode-cli/packages/contracts/src/tools/ask-user-question.ts";
import { askUserQuestionToolEntry } from "../../clients/uwork/apps/zcode-cli/packages/core/src/tool/handlers/ask-user-question.ts";

export const QUESTION_INPUT = AskUserQuestionInputSchema.parse({
  questions: [
    {
      header: "环境",
      question: "选择本次验证环境？",
      multiSelect: false,
      options: [
        { label: "北京", description: "第一个受控选项" },
        { label: "南京", description: "第二个受控选项" },
      ],
    },
    {
      header: "输出",
      question: "需要验证哪些输出？",
      multiSelect: true,
      options: [
        { label: "日志", description: "验证日志记录" },
        { label: "文件", description: "验证文件记录" },
        { label: "指标", description: "不选择的负例" },
      ],
    },
    {
      header: "补充",
      question: "还有什么补充要求？",
      multiSelect: false,
      options: [
        { label: "无额外要求", description: "一个明确偏好" },
        { label: "另行讨论", description: "另一个明确偏好" },
      ],
    },
  ],
});
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
export function createQuestionSupplier() {
  let asked = 0,
    answered = 0,
    mode;
  return {
    reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex((m) => m.role === "user"),
        query = text(body.messages[last]);
      const selected = query.includes("PREPUBLISH_QUESTION_MULTI")
        ? "multi"
        : query.includes("PREPUBLISH_QUESTION_SKIP")
          ? "skip"
          : query.includes("PREPUBLISH_QUESTION_HISTORY")
            ? "history"
            : undefined;
      if (!selected) return undefined;
      const results = body.messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      if (!results.length) {
        assert.equal(asked, 0);
        assert.ok(
          body.tools.some((t) => t.function?.name === "AskUserQuestion"),
        );
        asked++;
        mode = selected;
        return {
          toolCall: {
            id: "owned-question-" + selected,
            name: "AskUserQuestion",
            arguments: JSON.stringify(
              selected === "history"
                ? { questions: QUESTION_INPUT.questions.slice(0, 1) }
                : QUESTION_INPUT,
            ),
          },
        };
      }
      assert.equal(selected, mode);
      assert.equal(results.length, 1);
      assert.equal(results[0].tool_call_id, "owned-question-" + selected);
      assert.equal(answered, 0);
      const answers =
        selected === "history"
          ? { "选择本次验证环境？": "南京" }
          : selected === "multi"
            ? {
                "选择本次验证环境？": "南京",
                "需要验证哪些输出？": "日志, 文件, 补充：仅此案例",
              }
            : {};
      const expected = askUserQuestionToolEntry.formatModelContent({
        ...(selected === "history"
          ? { questions: QUESTION_INPUT.questions.slice(0, 1) }
          : QUESTION_INPUT),
        answers,
      });
      assert.equal(
        text(results[0]),
        expected,
        "real model must receive exact production question answer output",
      );
      if (selected === "multi") {
        const value = JSON.parse(expected);
        assert.deepEqual(value.answers, answers);
        assert.ok(value.guidance.includes("skipped 1"));
        assert.equal(
          value.answers["需要验证哪些输出？"],
          "日志, 文件, 补充：仅此案例",
        );
      } else if (selected === "skip")
        assert.ok(expected.includes("do not treat this as a rejection"));
      answered++;
      return {
        text: "原生企业资产联动完成。 PREPUBLISH_QUESTION_DONE_" + selected,
      };
    },
    status() {
      return { asked, answered, mode: mode ?? null };
    },
  };
}
