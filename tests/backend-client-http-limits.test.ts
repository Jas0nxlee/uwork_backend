import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { test, type TestContext } from "node:test";
import {
  BackendClientError,
  UWorkBackendClient,
} from "../src/backend-client.js";

async function server(
  t: TestContext,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const listener = createServer(handler);
  t.after(async () => {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
}

test("Host HTTP reader accepts exactly 2 MiB and rejects one byte beyond its decoded limit", async (t) => {
  const limit = 2 * 1024 * 1024;
  const base = {
    data: [
      { id: "model", name: "", context_window: 128, max_output_tokens: 1 },
    ],
  };
  base.data[0]!.name = "x".repeat(
    limit - Buffer.byteLength(JSON.stringify(base)),
  );
  const exact = JSON.stringify(base);
  assert.equal(Buffer.byteLength(exact), limit);
  let oversized = false;
  const origin = await server(t, (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(exact + (oversized ? " " : ""));
  });
  const client = new UWorkBackendClient(origin, async () => "synthetic-only");
  assert.equal((await client.models()).length, 1);
  oversized = true;
  await assert.rejects(
    client.models(),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "RESPONSE_LIMIT",
  );
});

test("Host HTTP transport refuses redirect instead of forwarding a device credential", async (t) => {
  let first = 0,
    redirected = 0;
  const destination = await server(t, (_req, res) => {
    redirected++;
    res.end("{}");
  });
  const origin = await server(t, (_req, res) => {
    first++;
    res.writeHead(302, { location: destination + "/v1/models" });
    res.end();
  });
  const client = new UWorkBackendClient(origin, async () => "synthetic-only");
  await assert.rejects(client.models());
  assert.equal(first, 1);
  assert.equal(redirected, 0);
});

test("Host HTTP transport honors an already aborted request before reaching its backend", async (t) => {
  let requests = 0;
  const origin = await server(t, (_req, res) => {
    requests++;
    res.end("{}");
  });
  const client = new UWorkBackendClient(origin, async () => "synthetic-only");
  const reason = new Error("controlled pre-dispatch cancellation");
  await assert.rejects(
    client.models(AbortSignal.abort(reason)),
    (error: unknown) => error === reason,
  );
  assert.equal(requests, 0);
});
