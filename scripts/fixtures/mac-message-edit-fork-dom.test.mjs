/** Actual source JSX returns -> React SSR -> DOM. Peripheral components only are stubbed; no App. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(
  new URL("../../clients/uwork/package.json", import.meta.url),
);
const { load } = require("cheerio");
const viewPath = "clients/uwork/packages/ui/src/v4/ConversationRowView.tsx",
  groupPath = "clients/uwork/packages/ui/src/v4/ConversationTurnGroup.tsx";
const view = readFileSync(viewPath, "utf8"),
  group = readFileSync(groupPath, "utf8");
function actualReturn(source, name) {
  const tree = ts.createSourceFile(
    "actual.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name?.text === name
    )
      found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, name);
  const ret = found.body.statements.findLast((n) => ts.isReturnStatement(n));
  assert.ok(ret, name);
  return ret.getText(tree);
}
const row = {
  rowId: 3,
  entityId: "msg_owned",
  state: "complete",
  text: "UWORK_MESSAGE_WARM_REPLY_20261021",
  createdAt: 1,
};
const common = {
  React,
  cn: (...args) => args.filter((v) => typeof v === "string").join(" "),
  String,
  testId: (prefix, id) => prefix + "-" + id,
  TID_V4_ROW: "v4-row",
  context: { sessionId: "sess_owned" },
  row,
  streaming: false,
  visibleText: row.text,
  codeCommentCardsEnabled: false,
  visiblePreviewCards: null,
  hideActions: false,
  deferActions: true,
  copyText: row.text,
  MessageResponse: ({ children }) => React.createElement("div", null, children),
};
function component(source, name, extra = {}) {
  const code = transformSync(
    "function Render(){" + actualReturn(source, name) + "}",
    {
      loader: "tsx",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    },
  ).code;
  const values = { ...common, ...extra };
  return vm.runInNewContext(
    code + ";Render",
    new Proxy(values, {
      get: (o, k) =>
        k in o
          ? o[k]
          : typeof k === "string" && /^[A-Z]/.test(k)
            ? () => null
            : undefined,
    }),
  );
}
const Shell = component(view, "RowShell", {
  rowId: 3,
  children: React.createElement("span", null, row.text),
  className: "group/assistant-row",
});
const actions = component(view, "ConversationAssistantTextActions", {
  rowId: 3,
  entityId: "msg_owned",
  text: row.text,
  onFork: () => {},
  onFeedbackChange: null,
  hookInvocations: null,
  turnId: "turn_owned",
  copyLabel: "Copy",
  forkLabel: "Fork",
  resolveTooltip: () => "",
  TID_V4_FORK: "v4-fork",
  MessageActions: ({ children, ...props }) =>
    React.createElement("div", props, children),
  MessageAction: ({ children, ...props }) => {
    delete props.label;
    delete props.tooltip;
    return React.createElement("button", props, children);
  },
});
const rowTree = ts.createSourceFile(
  "view.tsx",
  view,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const shellNode = rowTree.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "RowShell",
);
assert.ok(shellNode);
const shellCode = transformSync(shellNode.getText(rowTree), {
  loader: "tsx",
  jsxFactory: "React.createElement",
}).code;
const ActualRowShell = vm.runInNewContext(shellCode + ";RowShell", common);
const Assistant = component(view, "AssistantTextRowView", {
  RowShell: ActualRowShell,
  ConversationAssistantTextActions: actions,
});
const flow = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      { "data-row-id": "2" },
      "MACOS_CLOCK_LINK_20261020",
      React.createElement("button", { "data-testid": "v4-edit-2" }, "Edit"),
    ),
    React.createElement(Assistant),
  );
const Group = component(group, "ConversationTurnGroupImpl", {
  unit: {
    turnId: "turn_owned",
    key: "owned",
    leadingBoundaryRows: [],
    browserTurnEndRows: [],
    assistantTailRows: [],
    hookInvocations: [],
    header: {},
  },
  hasAssistantTurnContent: true,
  shareSelectionRows: [],
  backgroundResultTitle: null,
  ConversationTurnFlow: flow,
  canRenderAssistantActions: true,
  latestAssistantTextRow: row,
  canForkLatestAssistant: true,
  onFork: () => {},
  ConversationAssistantTextActions: actions,
  readAssistantFeedback: () => null,
  assistantRowContext: {},
  assistantCopyText: row.text,
});
function html() {
  return (
    '<div data-root-workspace-surface="interactive"><div data-session-id="sess_owned">' +
    renderToStaticMarkup(React.createElement(Group)) +
    '<div data-testid="v4-model-config" data-source="composer" data-model="model" data-thought="none"></div></div></div><div data-testid="task-item-sess_owned"><span data-task-title-copy="original">Owned title</span></div><div data-testid="enterprise-identity-name">企业用户甲</div>'
  );
}
function documentFor(html) {
  const $ = load(html),
    cache = new WeakMap();
  function wrap(n) {
    if (!n) return null;
    if (cache.has(n)) return cache.get(n);
    const v = {
      get textContent() {
        return $(n).text();
      },
      get innerText() {
        return $(n).text();
      },
      querySelectorAll: (s) => $(n).find(s).toArray().map(wrap),
      querySelector: (s) => wrap($(n).find(s)[0]),
      closest: (s) => wrap($(n).closest(s)[0]),
      getAttribute: (k) => $(n).attr(k) ?? null,
      getClientRects: () => [{}],
    };
    cache.set(n, v);
    return v;
  }
  return {
    querySelectorAll: (s) => $(s).toArray().map(wrap),
    querySelector: (s) => wrap($(s)[0]),
  };
}
function expression(path) {
  return execFileSync(
    "python3",
    [
      "-c",
      "import runpy; m=runpy.run_path(" +
        JSON.stringify(path) +
        "); print(m['lifecycle_ui']('MACOS_CLOCK_LINK_20261020','UWORK_MESSAGE_WARM_REPLY_20261021'))",
    ],
    { encoding: "utf8" },
  ).trim();
}
const old =
  "evidence/client-macos-message-edit-fork-preparation-20261021/before-footer-review-input/reviewed-sources/scripts/tests/mac-message-edit-fork-probe.py";
test("actual JSX ownership has deferred RowShell body and sibling exact-suffix footer in one turn", () => {
  assert.ok(
    renderToStaticMarkup(React.createElement(Shell)).includes(
      'data-row-id="3"',
    ),
  );
  const $ = load(html());
  const body = $('[data-row-id="3"]'),
    button = $('[data-testid="v4-fork-3"]');
  assert.equal(body.length, 1);
  assert.equal(button.length, 1);
  assert.equal(body.find('[data-testid="v4-fork-3"]').length, 0);
  assert.equal(
    body.closest("section[data-turn-id]")[0],
    button.closest("section[data-turn-id]")[0],
  );
  assert.ok(group.includes("deferAssistantActions"));
});
test("old real projection reproduces assistantRow null on actual source DOM; new projection binds exact action+turn", () => {
  const doc = documentFor(html());
  const oldValue = vm.runInNewContext(expression(old), { document: doc });
  assert.equal(oldValue.assistantRow, null);
  assert.equal(oldValue.ok, false);
  const path =
    process.env.UWORK_MESSAGE_DOM_PROJECTION_SOURCE ??
    "scripts/tests/mac-message-edit-fork-probe.py";
  const value = vm.runInNewContext(expression(path), { document: doc });
  assert.equal(value.ok, true);
  assert.equal(value.assistantRow, "3");
  assert.equal(value.assistantTurnId, "turn_owned");
  assert.equal(value.exactForkMatchCount, 1);
  assert.equal(value.sameTurn, true);
});
test("exact suffix in another turn or duplicate action fails closed", () => {
  const path =
    process.env.UWORK_MESSAGE_DOM_PROJECTION_SOURCE ??
    "scripts/tests/mac-message-edit-fork-probe.py";
  const $ = load(html());
  const moved = $('[data-testid="v4-fork-3"]').remove();
  $("div[data-session-id]").append(
    '<section data-turn-id="wrong" data-turn-key="wrong"></section>',
  );
  $('section[data-turn-id="wrong"]').append(moved);
  for (const content of [
    $.html(),
    html().replace('data-testid="v4-fork-3"', 'data-testid="v4-fork-4"'),
    html().replace(
      "</section>",
      '<button data-testid="v4-fork-3"></button></section>',
    ),
  ]) {
    assert.equal(
      vm.runInNewContext(expression(path), { document: documentFor(content) })
        .ok,
      false,
    );
  }
});
const raceOld =
  "evidence/client-macos-message-edit-fork-preparation-20261021/before-fork-wait-review-input/reviewed-sources/scripts/tests/mac-message-edit-fork-probe.py";
function forkExpression(path, excluded) {
  return execFileSync(
    "python3",
    [
      "-c",
      "import runpy; m=runpy.run_path(" +
        JSON.stringify(path) +
        "); print(m['lifecycle_ui']('MACOS_CLOCK_LINK_20261020','UWORK_MESSAGE_WARM_REPLY_20261021'" +
        (excluded ? ",excluded=['sess_owned']" : "") +
        "))",
    ],
    { encoding: "utf8" },
  ).trim();
}
function runActualUntil(values) {
  const python = `import sys,json,ast,runpy,pathlib,types
sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()))
m=runpy.run_path('scripts/tests/mac-message-edit-fork-probe.py');source=m['deriveMessageProbe'](m['BASE'].read_text());tree=ast.parse(source);outer=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run');fn=next(n for n in outer.body if isinstance(n,ast.FunctionDef) and n.name=='until');clock=[0.0];values=json.load(sys.stdin);calls=[0]
class Bridge:
 def evaluate(self,_):
  calls[0]+=1
  return values[min(calls[0]-1,len(values)-1)]
ns={'bridge':Bridge(),'time':types.SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda t:clock.__setitem__(0,clock[0]+t)),'memory_work_end':20,'memory_budget_left':lambda deadline: (_ for _ in ()).throw(AssertionError('deadline')) if clock[0]>=deadline else deadline-clock[0],'observations':{},'root':pathlib.Path('/owned/uncreated-message-pure')}
exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual-message-until','exec'),ns)
try:
 value=ns['until']('already evaluated source DOM projection','child needed',1)
 print(json.dumps({'taskId':value.get('taskId'),'calls':calls[0],'timedOut':False}))
except AssertionError:print(json.dumps({'calls':calls[0],'timedOut':True}))`;
  return JSON.parse(
    execFileSync("python3", ["-c", python], {
      input: JSON.stringify(values),
      encoding: "utf8",
    }),
  );
}
test("actual until parent-parent-child returns parent with old predicate and waits child with new predicate; missing child times out", () => {
  const parent = documentFor(html()),
    child = documentFor(html().replaceAll("sess_owned", "sess_child"));
  const old = forkExpression(raceOld, false);
  const oldValues = [parent, parent, child].map((document) =>
    vm.runInNewContext(old, { document }),
  );
  assert.equal(runActualUntil(oldValues).taskId, "sess_owned");
  const path =
    process.env.UWORK_MESSAGE_DOM_PROJECTION_SOURCE ??
    "scripts/tests/mac-message-edit-fork-probe.py";
  const current = forkExpression(path, true);
  const values = [parent, parent, child].map((document) =>
    vm.runInNewContext(current, { document }),
  );
  const observed = runActualUntil(values);
  assert.equal(observed.taskId, "sess_child");
  assert.equal(observed.calls, 3);
  assert.equal(runActualUntil([values[0], values[1]]).timedOut, true);
  const unrelated = documentFor(
    html()
      .replaceAll("sess_owned", "sess_unrelated")
      .replaceAll("UWORK_MESSAGE_WARM_REPLY_20261021", "UNRELATED_REPLY"),
  );
  const unrelatedValue = vm.runInNewContext(current, { document: unrelated });
  assert.equal(unrelatedValue.ok, false);
  assert.equal(runActualUntil([unrelatedValue]).timedOut, true);
});
