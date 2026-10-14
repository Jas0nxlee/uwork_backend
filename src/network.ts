import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, request } from "undici";
import ipaddr from "ipaddr.js";
import { fail } from "./core.js";

export function publicAddress(address: string) {
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}
export async function resolveAddresses(
  host: string,
  signal: AbortSignal,
  resolver = (hostname: string) => lookup(hostname, { all: true }),
) {
  signal.throwIfAborted();
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  return new Promise<Awaited<ReturnType<typeof resolver>>>(
    (resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
      void resolver(host).then(
        (addresses) => {
          signal.removeEventListener("abort", aborted);
          resolve(addresses);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", aborted);
          reject(error);
        },
      );
    },
  );
}
export async function safeRequest(
  url: string,
  options: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
    timeout?: number;
    headers?: Record<string, string>;
    onDispatch?: () => void;
  },
  allowPrivate = false,
) {
  const target = new URL(url);
  if (target.username || target.password || target.hash)
    fail(400, "INVALID_URL", "地址不能包含用户信息或片段");
  if (
    target.protocol !== "https:" &&
    !(allowPrivate && target.protocol === "http:")
  )
    fail(400, "HTTPS_REQUIRED", "上游必须使用 HTTPS");
  const timeout = options.timeout ?? 120000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolveAddresses(host, signal);
  if (
    !addresses.length ||
    (!allowPrivate && addresses.some((a) => !publicAddress(a.address)))
  )
    fail(400, "PRIVATE_UPSTREAM", "不能访问私有或保留地址");
  const first = addresses[0]!;
  const agent = new Agent({
    connect: {
      lookup: (_hostname, opts, callback) => {
        if (opts.all)
          callback(null, [
            { address: first.address, family: first.family as 4 | 6 },
          ]);
        else callback(null, first.address, first.family);
      },
      timeout: 10000,
    },
  });
  try {
    signal.throwIfAborted();
    options.onDispatch?.();
    const response = await request(target, {
      dispatcher: agent,
      method: options.method,
      headers: {
        "content-type": "application/json",
        "accept-encoding": "identity",
        ...options.headers,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
      headersTimeout: Math.min(timeout, 30000),
      bodyTimeout: timeout,
    });
    return {
      ...response,
      close: async () => {
        response.body.on("error", () => {});
        response.body.destroy();
        await agent.close();
      },
    };
  } catch (error) {
    await agent.close();
    throw error;
  }
}
export async function readJson(
  response: Awaited<ReturnType<typeof safeRequest>>,
  maxBytes = 2 * 1024 * 1024,
): Promise<unknown> {
  try {
    if (response.statusCode < 200 || response.statusCode >= 300)
      fail(502, "UPSTREAM_REJECTED", `上游返回 ${response.statusCode}`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > maxBytes) fail(502, "UPSTREAM_TOO_LARGE", "上游响应超出限制");
      chunks.push(b);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      fail(502, "UPSTREAM_FORMAT", "上游响应格式不正确");
    }
  } finally {
    await response.close();
  }
}
