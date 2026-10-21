import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { PERMISSION_DENIED_BY_USER_CONTENT } from "../../clients/uwork/apps/zcode-cli/packages/bootstrap/src/permission-options.ts";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
// 原Read的file_unchanged收据（read.ts），仅在已有实际写入和文件字节一致时接受。
const unchanged =
  "Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.";
export function createProjectPermissionSupplier(root) {
  assert.match(basename(root), /^client-native-prepublish-v\d+-20261021$/);
  const owned = join(root, "prepublish-workspace/owned-permission.txt"),
    other = join(root, "prepublish-workspace/other-permission.txt");
  const otherInitial = "OWNED_PROJECT_OTHER_INITIAL\n";
  const issued = {
    P: { read: false, write: false, final: 0 },
    Q: { read: false, write: false, final: 0 },
    R: { read: false, write: false, final: 0 },
  };
  return {
    async reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex((m) => m.role === "user"),
        query = text(body.messages[last]);
      const phase = ["P", "Q", "R"].find((p) =>
        query.includes("PREPUBLISH_PROJECT_ALLOW_" + p),
      );
      if (!phase) return undefined;
      const state = issued[phase],
        file = phase === "R" ? other : owned;
      const results = body.messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      if (!results.length) {
        assert.equal(state.read, false);
        state.read = true;
        return {
          toolCall: {
            id: "owned-project-read-" + phase,
            name: "Read",
            arguments: JSON.stringify({ file_path: file }),
          },
        };
      }
      assert.equal(results[0].tool_call_id, "owned-project-read-" + phase);
      if (phase === "Q" && text(results[0]) === unchanged) {
        assert.equal(
          await readFile(owned, "utf8"),
          results.length === 1
            ? "OWNED_PROJECT_PERMISSION_A\n"
            : "OWNED_PROJECT_PERMISSION_B\n",
        );
        assert.ok(
          body.messages.some(
            (m) =>
              m.role === "tool" &&
              m.tool_call_id === "owned-project-write-P" &&
              text(m).includes("updated successfully"),
          ),
        );
        const calls = body.messages.flatMap((m) => m.tool_calls ?? []);
        const prior = calls.find((c) => c.id === "owned-project-write-P");
        assert.ok(prior && prior.function.name === "Write");
        assert.deepEqual(JSON.parse(prior.function.arguments), {
          file_path: owned,
          content: "OWNED_PROJECT_PERMISSION_A\n",
        });
        state.readUnchanged = true;
      } else {
        assert.ok(
          text(results[0]).includes(
            phase === "P"
              ? "OWNED_PERMISSION_INITIAL"
              : phase === "Q"
                ? "OWNED_PROJECT_PERMISSION_A"
                : "OWNED_PROJECT_OTHER_INITIAL",
          ),
        );
      }
      if (results.length === 1) {
        assert.equal(state.write, false);
        state.write = true;
        return {
          toolCall: {
            id: "owned-project-write-" + phase,
            name: "Write",
            arguments: JSON.stringify({
              file_path: file,
              content:
                phase === "P"
                  ? "OWNED_PROJECT_PERMISSION_A\n"
                  : phase === "Q"
                    ? "OWNED_PROJECT_PERMISSION_B\n"
                    : "OWNED_PROJECT_MUST_NOT_WRITE\n",
            }),
          },
        };
      }
      assert.equal(results.length, 2);
      assert.equal(results[1].tool_call_id, "owned-project-write-" + phase);
      assert.equal(state.final, 0);
      if (phase === "R") {
        assert.ok(text(results[1]).includes(PERMISSION_DENIED_BY_USER_CONTENT));
        assert.equal(await readFile(other, "utf8"), otherInitial);
        assert.equal(
          await readFile(owned, "utf8"),
          "OWNED_PROJECT_PERMISSION_B\n",
        );
      } else {
        assert.ok(text(results[1]).includes("updated successfully"));
        assert.equal(
          await readFile(owned, "utf8"),
          phase === "P"
            ? "OWNED_PROJECT_PERMISSION_A\n"
            : "OWNED_PROJECT_PERMISSION_B\n",
        );
        assert.equal(await readFile(other, "utf8"), otherInitial);
      }
      state.final++;
      return {
        text: "原生企业资产联动完成。 PREPUBLISH_PROJECT_DONE_" + phase,
      };
    },
    status() {
      return structuredClone(issued);
    },
  };
}
