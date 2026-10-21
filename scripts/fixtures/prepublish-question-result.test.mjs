import assert from "node:assert/strict";
import test from "node:test";
import { askUserQuestionToolEntry } from "../../clients/uwork/apps/zcode-cli/packages/core/src/tool/handlers/ask-user-question.ts";
import * as questionReader from "../../clients/uwork/packages/ui/src/lib/askUserQuestion.ts";
const {
  readAskUserQuestionAnswers,
  getAskUserQuestionAnswerText,
  normalizeAskUserQuestionInput,
} = questionReader;
const input = {
  questions: [
    {
      question: "选择环境？",
      header: "环境",
      multiSelect: false,
      options: [
        { label: "甲", description: "甲" },
        { label: "乙", description: "乙" },
      ],
    },
  ],
};
for (const answers of [{ "选择环境？": '乙："原文"\n第二行' }, {}])
  test(
    "actual producer output remains readable by the existing UI JSON path: " +
      JSON.stringify(answers),
    () => {
      const output = askUserQuestionToolEntry.formatModelContent({
        ...input,
        answers,
      });
      const actual = readAskUserQuestionAnswers({ input, output });
      assert.deepEqual(actual, answers);
      const question = normalizeAskUserQuestionInput(input).questions[0];
      assert.equal(
        getAskUserQuestionAnswerText(question, actual, "未答"),
        answers["选择环境？"] ?? "未答",
      );
      const restored = readAskUserQuestionAnswers(
        JSON.parse(JSON.stringify({ input, output })),
      );
      assert.deepEqual(restored, answers);
    },
  );
test("missing historical answers are distinct from explicit empty and partial answers", () => {
  assert.equal(
    typeof questionReader.getAskUserQuestionMissingAnswerMessageId,
    "function",
  );
  assert.equal(
    questionReader.getAskUserQuestionMissingAnswerMessageId(undefined),
    "chat.askQuestion.answerUnavailable",
  );
  assert.equal(
    questionReader.getAskUserQuestionMissingAnswerMessageId({}),
    "chat.askQuestion.autoContinued",
  );
  assert.equal(
    questionReader.getAskUserQuestionMissingAnswerMessageId({
      其他问题: "已回答",
    }),
    "chat.askQuestion.noAnswerProvided",
  );
});
test("existing structured and legacy single-answer records remain readable", () => {
  assert.deepEqual(
    readAskUserQuestionAnswers({
      input,
      output: JSON.stringify({ answers: { "选择环境？": "甲" } }),
    }),
    { "选择环境？": "甲" },
  );
  assert.deepEqual(
    readAskUserQuestionAnswers({
      input,
      output: JSON.stringify({ type: "answered_custom", text: "旧自定义" }),
    }),
    { "选择环境？": "旧自定义" },
  );
});
test("old human-readable summaries remain available without guessing answer fields", () => {
  assert.equal(
    typeof questionReader.getAskUserQuestionRetainedSummary,
    "function",
  );
  const original = 'User has answered your questions: "选择环境？"="乙".';
  assert.equal(
    readAskUserQuestionAnswers({ input, output: original }),
    undefined,
  );
  assert.equal(
    questionReader.getAskUserQuestionRetainedSummary(original, undefined),
    original,
  );
  assert.equal(
    questionReader.getAskUserQuestionRetainedSummary(original, {
      "选择环境？": "乙",
    }),
    undefined,
  );
  assert.equal(
    questionReader.getAskUserQuestionRetainedSummary("  ", undefined),
    undefined,
  );
});
