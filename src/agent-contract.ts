import { z } from "zod";
import { scopeSchema, text } from "./core.js";

export const agentSchema = z
  .object({
    name: text,
    modelId: text,
    instructions: z.string().min(1).max(50000),
    assetIds: z.array(text).max(20).default([]),
    maxOutputTokens: z.number().int().min(1).max(131072).default(4096),
    sandbox: z.boolean().default(false),
    maxTurns: z.number().int().min(1).max(20).default(8),
    maxToolCalls: z.number().int().min(1).max(20).default(8),
    toolTimeoutMs: z.number().int().min(100).max(60000).default(30000),
    scope: scopeSchema,
    enabled: z.boolean().default(true),
  })
  .strict();
export const agentDataSchema = agentSchema.omit({
  name: true,
  scope: true,
  enabled: true,
});
export type AgentData = z.infer<typeof agentDataSchema>;
export interface Run {
  id: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
  agent_id: string;
  agent_version: number;
  status: string;
  input: string;
  output: string | null;
  error_code: string | null;
  timeout_ms: number;
  trigger_key: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  cancel_requested: number;
}
export interface RunTool {
  run_id: string;
  call_id: string;
  name: string;
  fingerprint: string;
  input: string;
  result: string | null;
  status: string;
  execution_id: string | null;
  error_code: string | null;
  created_at: number;
  finished_at: number | null;
}
