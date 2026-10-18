import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const source = await readFile(
  "scripts/fixtures/native-controlled-viewer-evidence.py",
  "utf8",
);
const match = source.match(/^VISIBLE_TEXT_EXPRESSION = """([^\n]+)"""$/mu);
assert.ok(
  match,
  "The production evidence gate must expose one fixed text expression",
);
const expression = new Script(match[1]);
function project(statusHidden) {
  const elements = {
    title: { textContent: "Owned share" },
    conversation: { textContent: statusHidden ? "Owned conversation" : "" },
    status: { hidden: statusHidden },
    "status-title": {
      textContent: statusHidden ? "正在验证访问权限…" : "请先登录企业账号",
    },
    logout: { hidden: !statusHidden },
    revoke: { hidden: true },
  };
  return JSON.parse(
    JSON.stringify(
      expression.runInNewContext({
        document: {
          getElementById(id) {
            return elements[id] ?? null;
          },
        },
      }),
    ),
  );
}

test("ready evidence omits the hidden loading status while preserving the readonly content", () => {
  assert.deepEqual(project(true), {
    title: "Owned share",
    conversation: "Owned conversation",
    status: "",
    logoutVisible: true,
    revokeVisible: false,
  });
});

test("anonymous evidence retains the visible login-required status and empty conversation", () => {
  assert.deepEqual(project(false), {
    title: "Owned share",
    conversation: "",
    status: "请先登录企业账号",
    logoutVisible: false,
    revokeVisible: false,
  });
});
