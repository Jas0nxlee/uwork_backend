import {
  Usage,
  setTracingDisabled,
  setTraceProcessors,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
  type AssistantMessageItem,
  type FunctionCallItem,
} from "@openai/agents-core";
import {
  completionSchema,
  type CompletionInput,
  type CompletionResult,
} from "./gateway.js";
import type { ToolCall } from "./completion-tools.js";
import { fail } from "./core.js";

setTracingDisabled(true);
setTraceProcessors([]);

type CompletionPort = (
  input: CompletionInput,
  key: string,
  signal?: AbortSignal,
) => Promise<CompletionResult>;
type Message = CompletionInput["messages"][number];
type SupportedOutput = AssistantMessageItem | FunctionCallItem;
function messages(request: ModelRequest): Message[] {
  const result: Message[] = [];
  if (request.systemInstructions)
    result.push({ role: "system", content: request.systemInstructions });
  if (typeof request.input === "string")
    return [...result, { role: "user", content: request.input }];
  for (const item of request.input) {
    if ("role" in item) {
      const content =
        typeof item.content === "string"
          ? item.content
          : item.content
              .map((part) => {
                if ("text" in part) return part.text;
                fail(
                  400,
                  "AGENT_INPUT_UNSUPPORTED",
                  "智能体当前仅接受文本上下文",
                );
              })
              .join("");
      result.push({ role: item.role, content });
    } else if (item.type === "function_call") {
      const call: ToolCall = {
        id: item.callId,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
      const last = result.at(-1);
      if (last?.role === "assistant") (last.tool_calls ??= []).push(call);
      else
        result.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_result") {
      const output = item.output;
      if (
        typeof output !== "string" &&
        (Array.isArray(output) || output.type !== "text")
      )
        fail(400, "AGENT_OUTPUT_UNSUPPORTED", "智能体工具当前仅返回文本");
      result.push({
        role: "tool",
        tool_call_id: item.callId,
        content: typeof output === "string" ? output : output.text,
      });
    } else fail(400, "AGENT_INPUT_UNSUPPORTED", "智能体上下文含未支持的项目");
  }
  return result;
}

export class GatewayAgentModel implements Model {
  private calls = 0;
  constructor(
    private modelId: string,
    private runId: string,
    private maxCalls: number,
    private complete: CompletionPort,
    private registerCalls: (
      calls: ToolCall[],
    ) => void | Promise<void> = () => {},
  ) {}
  async getResponse(
    request: ModelRequest,
  ): Promise<ModelResponse & { output: SupportedOutput[] }> {
    request.signal?.throwIfAborted();
    if (
      request.tracing ||
      request.handoffs.length ||
      request.previousResponseId ||
      request.conversationId ||
      request.prompt ||
      request.outputType !== "text"
    )
      fail(400, "AGENT_CONFIG_UNSUPPORTED", "智能体配置超出自有网关合同");
    if (this.calls >= this.maxCalls)
      fail(429, "MODEL_TURN_LIMIT", "智能体模型轮次已达上限");
    const tools = request.tools.map((tool) => {
      if (tool.type !== "function")
        fail(400, "AGENT_TOOL_UNSUPPORTED", "仅允许已注册的函数工具");
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict,
        },
      };
    });
    const choice = request.modelSettings.toolChoice;
    const input = completionSchema.parse({
      model: this.modelId,
      messages: messages(request),
      max_tokens: request.modelSettings.maxTokens,
      temperature: request.modelSettings.temperature ?? 0.7,
      stream: false,
      ...(tools.length ? { tools } : {}),
      ...(choice
        ? {
            tool_choice: ["auto", "none", "required"].includes(choice)
              ? choice
              : { type: "function", function: { name: choice } },
          }
        : {}),
      parallel_tool_calls: false,
    });
    const result = await this.complete(
      input,
      `run:${this.runId}:model:${++this.calls}`,
      request.signal,
    );
    request.signal?.throwIfAborted();
    const message = result.choices[0]!.message,
      calls = message.tool_calls ?? [];
    await this.registerCalls(calls);
    request.signal?.throwIfAborted();
    const output: SupportedOutput[] = [];
    if (message.content || !calls.length)
      output.push({
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: message.content }],
      });
    for (const call of calls)
      output.push({
        type: "function_call",
        callId: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: "completed",
      });
    return {
      output,
      usage: new Usage({
        requests: 1,
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      }),
    };
  }
  async *getStreamedResponse(
    request: ModelRequest,
  ): AsyncIterable<StreamEvent> {
    yield { type: "response_started" };
    const result = await this.getResponse(request);
    yield {
      type: "response_done",
      response: {
        id: `run:${this.runId}:model:${this.calls}`,
        usage: result.usage,
        output: result.output,
      },
    };
  }
}
