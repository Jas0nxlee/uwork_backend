import assert from "node:assert/strict";
export const STAGED_GENERATED_MESSAGE = "test: 生成已暂存联动记录";
export const ALL_GENERATED_MESSAGE = "test: 提交剩余联动变更";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((p) => p.text ?? "").join("");
export function createGitCommitSupplier({ commitOnly = false } = {}) {
  let generated = 0;
  return {
    reply(body) {
      const prompt = body.messages.map(text).join("\n");
      if (
        !prompt.includes(
          "Write exactly one Git commit message for the workspace changes below.",
        )
      )
        return undefined;
      assert.ok(
        generated < (commitOnly ? 1 : 2),
        "unexpected extra commit generation",
      );
      if (!commitOnly && generated === 0) {
        assert.ok(
          prompt.includes("staged.txt") && prompt.includes("OWNED_STAGED_B"),
        );
        assert.equal(prompt.includes("unstaged.txt"), false);
        assert.equal(prompt.includes("OWNED_UNSTAGED_C"), false);
        assert.equal(prompt.includes("new.txt"), false);
        assert.equal(prompt.includes("OWNED_NEW_D"), false);
      } else {
        assert.ok(
          prompt.includes("unstaged.txt") &&
            prompt.includes("OWNED_UNSTAGED_C") &&
            prompt.includes("new.txt") &&
            prompt.includes("OWNED_NEW_D"),
        );
        assert.doesNotMatch(prompt, /(?:^|[\s/])staged\.txt(?=[\s:]|$)/m);
        assert.equal(prompt.includes("OWNED_STAGED_B"), false);
      }
      generated++;
      return {
        text:
          !commitOnly && generated === 1
            ? STAGED_GENERATED_MESSAGE
            : ALL_GENERATED_MESSAGE,
      };
    },
    status() {
      return { generated };
    },
  };
}
