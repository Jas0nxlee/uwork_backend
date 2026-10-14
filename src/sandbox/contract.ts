import type { Scope } from "../core.js";
export interface SandboxOwner {
  id: string;
  tenantId: string;
  ownerToken: string;
  expiresAt: number;
}
export interface SandboxObservation {
  running: boolean;
  exitCode: number | null;
  containerId: string;
}
export interface SandboxOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export interface SandboxDriver {
  health(): Promise<{ available: boolean; image: string }>;
  create(owner: SandboxOwner): Promise<SandboxObservation>;
  inspect(owner: SandboxOwner): Promise<SandboxObservation | null>;
  execute(
    owner: SandboxOwner,
    code: string,
    signal: AbortSignal,
  ): Promise<SandboxOutput>;
  stop(owner: SandboxOwner): Promise<void>;
  remove(owner: SandboxOwner): Promise<void>;
}
export interface SandboxRuntimeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  scope: string;
  owner_token: string;
  container_id: string | null;
  status: string;
  error_code: string | null;
  created_at: number;
  expires_at: number;
  updated_at: number;
  revision: number;
}
export interface SandboxExecutionRow {
  id: string;
  tenant_id: string;
  runtime_id: string;
  user_id: string;
  status: string;
  code: string;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  error_code: string | null;
  timeout_ms: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}
export interface SandboxRuntimeView {
  id: string;
  name: string;
  scope: Scope;
  status: string;
  containerId: string | null;
  createdAt: number;
  expiresAt: number;
  errorCode: string | null;
  revision: number;
}
