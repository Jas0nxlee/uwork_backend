import type { createApp } from "../../src/app.js";

export type Row = Record<string, unknown>;
/** Shared ports for independent original-admin-UI consumers; no controller state owner. */
export interface AdminUiCasePorts {
  app: Awaited<ReturnType<typeof createApp>>;
  prefix: string;
  api(
    path: string,
    method?: string,
    data?: Row,
    expected?: number,
  ): Promise<Row>;
  run(stage: string): Promise<unknown>;
  control: Row;
  saveControl(): Promise<void>;
  supplier: Row[];
  traffic: Row[];
  facts: Row;
}
