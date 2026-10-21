import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

export const INITIAL_REWIND_TEXT = "OWNED_REWIND_INITIAL\n第二行保持\n";
export const AGENT_REWIND_TEXT = "OWNED_REWIND_AGENT_WRITE\n";
export const EXTERNAL_REWIND_TEXT = "OWNED_REWIND_EXTERNAL_EDIT\n";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Controlled responses and passive file observation; all writes belong to the original CLI tool. */
export function createRewindSupplier(root) {
  assert.match(basename(root), /^client-native-prepublish-v\d+-20261021$/);
  const file = join(root, "prepublish-workspace/owned-rewind.txt");
  let readIssued = false,
    writeIssued = false,
    finalReplies = 0,
    editedReplies = 0,
    restoredBeforeEditedRequest = false,
    fallbackReplies = 0,
    externalPreservedBeforeFallbackRequest = false;
  return {
    async reply(body) {
      if (!body.stream) return undefined;
      const last = body.messages.findLastIndex((m) => m.role === "user");
      const query = text(body.messages[last]);
      if (query.includes("PREPUBLISH_REWIND_QUERY_F")) {
        assert.equal(fallbackReplies, 0, "extra fallback request");
        assert.equal(
          await readFile(file, "utf8"),
          EXTERNAL_REWIND_TEXT,
          "conversation-only fallback must preserve the external file",
        );
        fallbackReplies++;
        externalPreservedBeforeFallbackRequest = true;
        return { text: "原生企业资产联动完成。 PREPUBLISH_REWIND_ANSWER_F" };
      }
      if (query.includes("PREPUBLISH_REWIND_QUERY_E")) {
        assert.equal(editedReplies, 0, "extra edited request");
        assert.equal(
          await readFile(file, "utf8"),
          INITIAL_REWIND_TEXT,
          "rewind must precede the edited model request",
        );
        editedReplies++;
        restoredBeforeEditedRequest = true;
        return { text: "原生企业资产联动完成。 PREPUBLISH_REWIND_ANSWER_E" };
      }
      if (!query.includes("PREPUBLISH_REWIND_QUERY_A")) return undefined;
      const results = body.messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      if (results.length === 0) {
        assert.equal(readIssued, false);
        assert.ok(body.tools.some((t) => t.function?.name === "Read"));
        readIssued = true;
        return {
          toolCall: {
            id: "owned-rewind-read",
            name: "Read",
            arguments: JSON.stringify({ file_path: file }),
          },
        };
      }
      assert.equal(results[0].tool_call_id, "owned-rewind-read");
      assert.ok(text(results[0]).includes("OWNED_REWIND_INITIAL"));
      if (results.length === 1) {
        assert.equal(writeIssued, false);
        assert.ok(body.tools.some((t) => t.function?.name === "Write"));
        writeIssued = true;
        return {
          toolCall: {
            id: "owned-rewind-write",
            name: "Write",
            arguments: JSON.stringify({
              file_path: file,
              content: AGENT_REWIND_TEXT,
            }),
          },
        };
      }
      assert.equal(results.length, 2);
      assert.equal(results[1].tool_call_id, "owned-rewind-write");
      assert.ok(text(results[1]).includes("updated successfully"));
      assert.equal(await readFile(file, "utf8"), AGENT_REWIND_TEXT);
      assert.equal(finalReplies, 0);
      finalReplies++;
      return { text: "原生企业资产联动完成。 PREPUBLISH_REWIND_ANSWER_A" };
    },
    status() {
      return {
        readIssued,
        writeIssued,
        finalReplies,
        editedReplies,
        restoredBeforeEditedRequest,
        fallbackReplies,
        externalPreservedBeforeFallbackRequest,
        initialSha256: sha(INITIAL_REWIND_TEXT),
        agentSha256: sha(AGENT_REWIND_TEXT),
      };
    },
  };
}
