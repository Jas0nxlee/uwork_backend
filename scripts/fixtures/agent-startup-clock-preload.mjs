// Owned test fixture: change Date.now only in the exact new Agent process until
// its original startup/storageState ready frame. Never changes OS/VM clocks.
import fs from "node:fs";
import crypto from "node:crypto";
const metadata = JSON.parse(fs.readFileSync("/input/metadata.json", "utf8"));
let entry;
try {
  entry = fs.realpathSync(process.argv[1]);
} catch {}
if (metadata.clockRollback && entry === metadata.clockRollback.targetEntry) {
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(entry))
    .digest("hex");
  if (actual !== metadata.new.agentSha256)
    throw new Error("Owned clock fixture Agent digest mismatch");
  const journal = "/work/clock-agent-journal.jsonl";
  const append = (row) =>
    fs.appendFileSync(
      journal,
      JSON.stringify({ pid: process.pid, entry, agentSha256: actual, ...row }) +
        "\n",
    );
  const originalNow = Date.now;
  const originalWrite = process.stdout.write;
  const wallStart = originalNow();
  let calls = 0;
  Date.now = () => wallStart - 100 * ++calls;
  const firstWallSample = Date.now();
  const secondWallSample = Date.now();
  append({
    event: "wall-clock-rollback-installed",
    firstWallSample,
    secondWallSample,
    processLocalOnly: true,
    osClockModified: false,
  });
  const states = [];
  process.stdout.write = function (chunk, ...args) {
    try {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.trim().split("\n")) {
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        if (frame.method !== "startup/storageState") continue;
        states.push({
          phase: frame.params.phase,
          elapsedMs: frame.params.elapsedMs,
        });
        if (frame.params.phase === "ready") {
          Date.now = originalNow;
          process.stdout.write = originalWrite;
          append({
            event: "original-startup-ready-clock-restored",
            dateNowCalls: calls,
            states,
          });
        }
      }
    } catch (error) {
      Date.now = originalNow;
      process.stdout.write = originalWrite;
      append({
        event: "clock-fixture-observation-error",
        error: String(error),
      });
      throw error;
    }
    return Reflect.apply(originalWrite, this, [chunk, ...args]);
  };
}
