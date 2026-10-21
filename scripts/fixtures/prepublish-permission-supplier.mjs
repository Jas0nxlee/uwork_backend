import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  PERMISSION_DENIED_BY_USER_CONTENT,
  buildPermissionDeniedContent,
} from "../../clients/uwork/apps/zcode-cli/packages/bootstrap/src/permission-options.ts";

export const INITIAL_PERMISSION_TEXT = "OWNED_PERMISSION_INITIAL\n第二行保持\n";
export const RECOVERED_PERMISSION_TEXT = "OWNED_PERMISSION_RECOVERED_B\n";
export const PERMISSION_TEST_FEEDBACK =
  "不要写入；只说明原因。\n保留“第二行”原始字节。";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
export function createPermissionSupplier(root) {
  assert.match(basename(root), /^client-native-prepublish-v\d+-20261021$/);
  const file = join(root, "prepublish-workspace/owned-permission.txt");
  let readIssued = false,
    deniedWriteIssued = false,
    userDenialObserved = false,
    deniedReply = 0,
    recoveryWriteIssued = false,
    recoveryConfirmed = false,
    recoveryReply = 0,
    feedbackObserved = false;
  return {
    async reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex((m) => m.role === "user"),
        query = text(body.messages[last]);
      const results = body.messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      const feedback = query.includes("PREPUBLISH_PERMISSION_QUERY_F");
      if (query.includes("PREPUBLISH_PERMISSION_QUERY_A") || feedback) {
        if (!results.length) {
          assert.equal(readIssued, false);
          readIssued = true;
          return {
            toolCall: {
              id: "owned-permission-read",
              name: "Read",
              arguments: JSON.stringify({ file_path: file }),
            },
          };
        }
        assert.equal(results[0].tool_call_id, "owned-permission-read");
        assert.ok(text(results[0]).includes("OWNED_PERMISSION_INITIAL"));
        if (results.length === 1) {
          assert.equal(deniedWriteIssued, false);
          deniedWriteIssued = true;
          return {
            toolCall: {
              id: "owned-permission-denied-write",
              name: "Write",
              arguments: JSON.stringify({
                file_path: file,
                content: "OWNED_PERMISSION_MUST_NOT_BE_WRITTEN\n",
              }),
            },
          };
        }
        assert.equal(results.length, 2);
        assert.equal(results[1].tool_call_id, "owned-permission-denied-write");
        assert.ok(
          text(results[1]).includes(
            feedback
              ? buildPermissionDeniedContent(PERMISSION_TEST_FEEDBACK)
              : PERMISSION_DENIED_BY_USER_CONTENT,
          ),
          "original user denial must reach actual model context",
        );
        assert.equal(text(results[1]).includes("updated successfully"), false);
        assert.equal(await readFile(file, "utf8"), INITIAL_PERMISSION_TEXT);
        assert.equal(deniedReply, 0);
        userDenialObserved = true;
        feedbackObserved = feedback;
        deniedReply++;
        return {
          text:
            "原生企业资产联动完成。 " +
            (feedback
              ? "PREPUBLISH_PERMISSION_FEEDBACK_ACCEPTED"
              : "PREPUBLISH_PERMISSION_DENIED_WAITING"),
        };
      }
      if (query.includes("PREPUBLISH_PERMISSION_QUERY_B")) {
        assert.ok(userDenialObserved);
        if (!results.length) {
          assert.equal(recoveryWriteIssued, false);
          recoveryWriteIssued = true;
          return {
            toolCall: {
              id: "owned-permission-recovery-write",
              name: "Write",
              arguments: JSON.stringify({
                file_path: file,
                content: RECOVERED_PERMISSION_TEXT,
              }),
            },
          };
        }
        assert.equal(results.length, 1);
        assert.equal(
          results[0].tool_call_id,
          "owned-permission-recovery-write",
        );
        assert.ok(text(results[0]).includes("updated successfully"));
        assert.equal(await readFile(file, "utf8"), RECOVERED_PERMISSION_TEXT);
        assert.equal(recoveryReply, 0);
        recoveryConfirmed = true;
        recoveryReply++;
        return {
          text: "原生企业资产联动完成。 PREPUBLISH_PERMISSION_RECOVERED",
        };
      }
      return undefined;
    },
    status() {
      return {
        readIssued,
        deniedWriteIssued,
        userDenialObserved,
        deniedReply,
        recoveryWriteIssued,
        recoveryConfirmed,
        recoveryReply,
        feedbackObserved,
      };
    },
  };
}
