import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  getAskUserQuestionRetainedSummary,
  getAskUserQuestionAnswerText,
  normalizeAskUserQuestionInput,
} from "../../clients/uwork/packages/ui/src/lib/askUserQuestion.ts";
const path = new URL(
  "../../clients/uwork/packages/ui/src/ToolCallBlocks/renderers/ask-question.tsx",
  import.meta.url,
);
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const callbacks = [];
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "renderContent"
  ) {
    assert.ok(ts.isCallExpression(node.initializer));
    callbacks.push(node.initializer.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(callbacks.length, 1);
const code = ts.transpileModule("return (" + callbacks[0] + ");", {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const input = {
  questions: [
    {
      question: "选择环境？",
      header: "环境",
      options: [
        { label: "甲", description: "甲" },
        { label: "南京", description: "南京" },
      ],
    },
  ],
};
function render(output, answers, isRunning = false, isFailed = false) {
  const values = {
    React,
    isRunning,
    isFailed,
    retainedSummary: getAskUserQuestionRetainedSummary(output, answers),
    retainedSummaryLabel: "原始回答摘要",
    data: normalizeAskUserQuestionInput(input),
    answers,
    noAnswerText: "历史回答不可用",
    getAskUserQuestionAnswerText,
  };
  const fn = new Function(...Object.keys(values), code)(
    ...Object.values(values),
  );
  return renderToStaticMarkup(fn());
}
test("actual answered-card closure displays structured answer", () => {
  const html = render("ignored because answers are known", {
    "选择环境？": "南京",
  });
  assert.ok(html.includes("南京"));
  assert.equal(html.includes("历史回答不可用"), false);
  assert.equal(html.includes("原始回答摘要"), false);
});
test("actual legacy card retains its summary as escaped text without inventing answer fields", () => {
  const original =
    'Old summary: "选择环境？"="南京" <script>not executable</script>';
  const html = render(original, undefined);
  assert.ok(
    html.includes("原始回答摘要") &&
      html.includes("南京") &&
      html.includes("&lt;script&gt;"),
  );
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("历史回答不可用"), false);
});
test("actual unknown history remains distinct and running content stays hidden", () => {
  assert.ok(render(undefined, undefined).includes("历史回答不可用"));
  assert.equal(render("pending text", undefined, true), "");
});
