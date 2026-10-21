import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createActiveQuitHold } from "./mac-native-active-quit-runtime.mjs";
import {
  deriveActiveQuitFixture,
  ACTIVE_QUIT_PROFILE,
} from "./mac-native-active-quit-derived.mjs";
const original = readFileSync(
  "scripts/fixtures/client-native-enterprise.mjs",
  "utf8",
);
test("actual full original Common derives without executing; original 1c remains byte exact", () => {
  const source = deriveActiveQuitFixture(original);
  parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const body = (s) =>
    s.slice(
      s.indexOf("async function openWorkspace(workspacePath) {"),
      s.indexOf("async function stopNative() {"),
    );
  assert.equal(body(source), body(original));
  assert.equal(
    createHash("sha256").update(body(source)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert(source.includes("contextWindow:500000"));
  assert(source.includes("ownedActiveModel.data.contextWindow!==500000"));
  assert(
    source.includes("native-packaged-macos-arm64-secondary-exit-runtime.mjs"),
  );
  assert(!source.includes("import './mac-native-active-quit-derived.mjs'"));
  assert.match(
    ACTIVE_QUIT_PROFILE,
    /^client-native-packaged-macos-clock-arm64-/,
  );
});
test("single supplier interception and original retained child exit receipt before arm; no app quit IPC", () => {
  const s = deriveActiveQuitFixture(original);
  assert.equal(
    s.split("activeQuitHold.intercept(body,res,modelCalls)").length,
    2,
  );
  assert(s.includes("activeQuitChild.once('exit'"));
  assert(
    s.indexOf("activeQuitChild.once('exit'") <
      s.indexOf("activeQuitHold.arm(workspacePath)"),
  );
  assert(s.includes("activeQuitChild!==electron"));
  assert(s.includes("activeQuitHold.dispose();"));
  assert(!s.includes("c.op==='appQuit'"));
  assert.throws(() =>
    deriveActiveQuitFixture(
      original.replace("  if (!fileContext) modelRequests.push(body);", ""),
    ),
  );
});
test("actual arm handler executes with Common bindings and original EventEmitter child; changed owner rejects before arm", async () => {
  const s = deriveActiveQuitFixture(original);
  let block;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "IfStatement" &&
      s.slice(node.test.start, node.test.end).includes("c.op==='activeQuitArm'")
    )
      block = node.consequent;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(parse(s, { ecmaVersion: "latest", sourceType: "module" }));
  assert.ok(block);
  const body = s.slice(block.start + 1, block.end - 1);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(
    "child",
    "validateOwnedNativeWorkspace",
    "activeQuitHold",
    "console",
    `let electron=child,activeQuitChild,activeQuitStarted,activeQuitExit=null;const packagedRuntime={},root='/owned';const c={op:'activeQuitArm',workspacePath:'/owned/project'};const performance={now:()=>100};await (async()=>{${body}})();child.emit('exit',0,null);return {activeQuitExit,held:activeQuitHold.safe()};`,
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
  });
  const logs = [];
  const proof = await run(
    child,
    async (root, path) => {
      assert.equal(root, "/owned");
      return path;
    },
    createActiveQuitHold(),
    { log: (x) => logs.push(JSON.parse(x)) },
  );
  assert.deepEqual(logs, [{ op: "activeQuitArm", status: "done", pid: 123 }]);
  assert.deepEqual(proof.activeQuitExit, {
    pid: 123,
    code: 0,
    signal: null,
    observedAfterArmMs: 0,
  });
  assert.equal(proof.held.armed, true);
  const changed = Object.assign(new EventEmitter(), {
    pid: 124,
    exitCode: null,
    signalCode: null,
  });
  const hold = createActiveQuitHold();
  await assert.rejects(
    run(
      changed,
      async (_, path) => {
        changed.exitCode = 0;
        return path;
      },
      hold,
      { log: () => assert.fail("No changed-owner success") },
    ),
    /ACTIVE_QUIT_OWNER_CHANGED/,
  );
  assert.equal(hold.safe().armed, false);
  assert.equal(changed.listenerCount("exit"), 0);
});
