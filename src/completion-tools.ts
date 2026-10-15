import { z } from "zod";
import { fail } from "./core.js";

const name = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
function objectJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}
function boundedSchema(value: Record<string, unknown>) {
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > 100000) return false;
    const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++nodes > 10000 || item.depth > 20) return false;
      if (item.value && typeof item.value === "object")
        for (const child of Object.values(item.value))
          pending.push({ value: child, depth: item.depth + 1 });
    }
    return true;
  } catch {
    return false;
  }
}
export const functionToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name,
        description: z.string().max(20000).optional(),
        parameters: z
          .record(z.string(), z.unknown())
          .refine(boundedSchema, "工具参数 schema 超出限制"),
        strict: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export const toolCallSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.literal("function"),
    function: z
      .object({
        name,
        arguments: z
          .string()
          .max(100000)
          .refine(objectJson, "工具参数必须为 JSON 对象"),
      })
      .strict(),
  })
  .strict();
export type ToolCall = z.infer<typeof toolCallSchema>;
// Some compatible providers annotate JSON calls with the SSE-style index.
// Keep that transport detail outside the strict client/history contract.
export const upstreamToolCallSchema = toolCallSchema
  .extend({ index: z.number().int().min(0).max(31).optional() })
  .transform(({ id, type, function: definition }) => ({
    id,
    type,
    function: definition,
  }));
export const toolDeltaSchema = z.object({
  index: z.number().int().min(0).max(31),
  id: z.string().max(200).optional(),
  type: z.literal("function").optional(),
  function: z
    .object({
      name: z.string().max(64).optional(),
      arguments: z.string().max(100000).optional(),
    })
    .optional(),
});
export type ToolDelta = z.infer<typeof toolDeltaSchema>;
export const toolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z
    .object({
      type: z.literal("function"),
      function: z.object({ name }).strict(),
    })
    .strict(),
]);
export class ToolCallAccumulator {
  private calls = new Map<number, ToolCall>();
  add(deltas: ToolDelta[]) {
    for (const delta of deltas) {
      const call = this.calls.get(delta.index) ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      call.id += delta.id ?? "";
      call.function.name += delta.function?.name ?? "";
      call.function.arguments += delta.function?.arguments ?? "";
      if (
        call.id.length > 200 ||
        call.function.name.length > 64 ||
        call.function.arguments.length > 100000
      )
        fail(502, "UPSTREAM_TOOL_FORMAT", "上游工具调用超出限制");
      this.calls.set(delta.index, call);
    }
  }
  finish() {
    const ordered = [...this.calls.entries()].sort(([a], [b]) => a - b);
    if (ordered.some(([index], position) => index !== position))
      fail(502, "UPSTREAM_TOOL_FORMAT", "上游工具调用片段不完整");
    return ordered.map(([, call]) => call);
  }
}
export function validateToolCalls(
  calls: ToolCall[],
  tools: z.infer<typeof functionToolSchema>[] | undefined,
  choice: z.infer<typeof toolChoiceSchema> | undefined,
  reason: string,
  parallelToolCalls?: boolean,
) {
  const names = new Set(tools?.map((tool) => tool.function.name) ?? []);
  const parsed = z.array(toolCallSchema).max(32).safeParse(calls);
  if (
    !parsed.success ||
    new Set(calls.map((call) => call.id)).size !== calls.length ||
    calls.some((call) => !names.has(call.function.name)) ||
    (parallelToolCalls === false && calls.length > 1) ||
    (calls.length > 0 && (choice === "none" || reason !== "tool_calls")) ||
    (calls.length === 0 &&
      (choice === "required" ||
        reason === "tool_calls" ||
        typeof choice === "object")) ||
    (typeof choice === "object" &&
      calls.some((call) => call.function.name !== choice.function.name))
  )
    fail(502, "UPSTREAM_TOOL_FORMAT", "上游工具调用不符合已授权协议");
  return parsed.data;
}
