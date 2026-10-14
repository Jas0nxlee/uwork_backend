import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export const id = () => randomBytes(16).toString("hex");
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const now = () => Date.now();
export const text = z.string().trim().min(1).max(200);
export const serviceUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "服务地址只能包含 HTTP(S) origin 与路径，凭据必须存入 vault");
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const role = z.enum(["owner", "admin", "operator", "auditor", "member"]);
export type Role = z.infer<typeof role>;
export const scopeSchema = z
  .object({
    all: z.boolean().default(false),
    members: z.array(identifier).max(1000).default([]),
    departments: z.array(identifier).max(1000).default([]),
  })
  .strict();
export type Scope = z.infer<typeof scopeSchema>;
export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
  departmentId: string | null;
  seat: boolean;
  sessionHash: string;
  kind: string;
  scopes: string[];
}
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).default(""),
});
export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
export function csv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r\n]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...rows.map((r) => columns.map((k) => cell(r[k])).join(",")),
    ].join("\r\n")
  );
}
