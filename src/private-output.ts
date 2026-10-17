import { fail } from "./core.js";

const reject = () => fail(502, "UPSTREAM_PRIVATE", "上游响应包含私有凭据");

/** Inspect decoded output, including keys and JSON held inside tool arguments. */
export function assertNoPrivateOutput(value: unknown, secret: string) {
  if (!secret) return;
  const pending: { value: unknown; embeddedDepth: number }[] = [
    { value, embeddedDepth: 0 },
  ];
  while (pending.length) {
    const item = pending.pop()!;
    if (typeof item.value === "string") {
      if (item.value.includes(secret)) reject();
      // Tool arguments are a JSON string inside the already-decoded envelope.
      // Four nested JSON encodings are bounded independently of object depth.
      if (item.embeddedDepth < 4 && /^[\s]*[\[{]/.test(item.value)) {
        try {
          pending.push({
            value: JSON.parse(item.value),
            embeddedDepth: item.embeddedDepth + 1,
          });
        } catch {
          // Ordinary model text need not be JSON. Its literal value was checked.
        }
      }
    } else if (Array.isArray(item.value)) {
      for (const value of item.value)
        pending.push({ value, embeddedDepth: item.embeddedDepth });
    } else if (item.value && typeof item.value === "object") {
      for (const [key, value] of Object.entries(item.value)) {
        if (key.includes(secret)) reject();
        pending.push({ value, embeddedDepth: item.embeddedDepth });
      }
    }
  }
}

/** Hold only a suffix that could become the private key in later text deltas. */
export class PrivateTextHoldback {
  private pending = "";
  private readonly prefix: Uint32Array;
  constructor(private readonly secret: string) {
    this.prefix = new Uint32Array(secret.length);
    for (let index = 1, matched = 0; index < secret.length; index++) {
      while (matched && secret[index] !== secret[matched])
        matched = this.prefix[matched - 1]!;
      if (secret[index] === secret[matched]) matched++;
      this.prefix[index] = matched;
    }
  }
  push(text: string) {
    if (!this.secret) return text;
    const candidate = this.pending + text;
    let held = this.pending.length;
    for (let index = 0; index < text.length; index++) {
      while (held && text[index] !== this.secret[held])
        held = this.prefix[held - 1]!;
      if (text[index] === this.secret[held]) held++;
      if (held === this.secret.length) reject();
    }
    this.pending = held ? candidate.slice(-held) : "";
    return candidate.slice(0, candidate.length - held);
  }
  finish() {
    const value = this.pending;
    this.pending = "";
    return value;
  }
}
