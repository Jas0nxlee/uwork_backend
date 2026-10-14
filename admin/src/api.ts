export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok)
    throw new HttpError(response.status, value.error?.message ?? "请求失败");
  return value as T;
}
export type Row = Record<string, unknown>;
export function display(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
export function date(v: unknown) {
  return typeof v === "number"
    ? new Date(v).toLocaleString("zh-CN")
    : display(v);
}
