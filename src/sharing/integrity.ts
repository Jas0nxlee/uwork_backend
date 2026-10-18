import { createHash } from "node:crypto";
import { fail } from "../core.js";

const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
export const MAX_SHARE_PAYLOAD_BYTES = 1024 * 1024;

function validUnicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** 先迭代限深/节点，再递归摘要，避免不可信 JSON 以栈溢出变成 500。 */
export function assertShareJson(
  value: unknown,
  maximum = MAX_SHARE_PAYLOAD_BYTES,
) {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > MAX_NODES || entry.depth > MAX_DEPTH)
      fail(400, "SHARE_JSON_LIMIT", "分享内容结构超过限制");
    const current = entry.value;
    if (typeof current === "string") {
      if (!validUnicode(current))
        fail(400, "SHARE_JSON_INVALID", "分享内容包含无效字符");
    } else if (typeof current === "number") {
      if (!Number.isFinite(current))
        fail(400, "SHARE_JSON_INVALID", "分享数字必须有限");
    } else if (current !== null && typeof current === "object") {
      if (
        !Array.isArray(current) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(current))
      )
        fail(400, "SHARE_JSON_INVALID", "分享内容必须是 JSON");
      for (const [key, child] of Object.entries(current)) {
        if (
          !validUnicode(key) ||
          ["__proto__", "constructor", "prototype"].includes(key)
        )
          fail(400, "SHARE_JSON_INVALID", "分享字段不合法");
        pending.push({ value: child, depth: entry.depth + 1 });
        if (pending.length + nodes > MAX_NODES)
          fail(400, "SHARE_JSON_LIMIT", "分享内容结构超过限制");
      }
    } else if (current !== null && typeof current !== "boolean") {
      fail(400, "SHARE_JSON_INVALID", "分享内容必须是 JSON");
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum)
    fail(400, "SHARE_PAYLOAD_LIMIT", "分享内容超过大小限制");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 与现客户端 canonical JSON 的字段排序、Unicode、有限数字语义保持一致。 */
export function shareJsonSha256(value: unknown) {
  assertShareJson(value);
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function shareBytesSha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
