// CDP bridge: newline-delimited JSON RPC on stdio -> one owned DevTools endpoint.
// Only the standard DevTools protocol is forwarded; no product module is imported.
import { createInterface } from "node:readline";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0 || port >= 65536)
  throw Error("Pass the owned CDP port");
const sender = JSON.parse(process.argv[3] ?? "1");
if (sender !== 1) throw Error("Pass the owned Main pid as sender");
// Optional owned renderer document prefix; selects the same page the reviewed pin() uses.
const rendererPrefix = process.argv[4];

const version = await (async () => {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await (
        await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(3000),
        })
      ).json();
    } catch {
      if (Date.now() > deadline)
        throw Error("Owned DevTools endpoint never listened");
      await new Promise((done) => setTimeout(done, 200));
    }
  }
})();
const endpoint = new URL(version.webSocketDebuggerUrl);
if (
  endpoint.hostname !== "127.0.0.1" ||
  Number(endpoint.port) !== port ||
  !endpoint.pathname.startsWith("/devtools/browser/")
)
  throw Error(
    "Refusing an endpoint that is not the owned loopback DevTools one",
  );

const socket = new WebSocket(endpoint);
await new Promise((done, fail) => {
  socket.addEventListener("open", () => done(), { once: true });
  socket.addEventListener("error", () => fail(Error("CDP socket failed")), {
    once: true,
  });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(message.error);
  else entry.resolve(message.result ?? {});
});
const send = (method, params, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(
      JSON.stringify({
        id,
        method,
        params: params ?? {},
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });

let attached;
const attachedSession = async () => {
  if (attached) return attached;
  // The owned renderer may still be navigating; select the same document pin() uses.
  const deadline = Date.now() + 30000;
  for (;;) {
    const { targetInfos } = await send("Target.getTargets");
    const pages = targetInfos
      .filter((info) => info.type === "page")
      .filter((info) => !rendererPrefix || info.url.startsWith(rendererPrefix));
    if (pages.length === 1) {
      const { sessionId } = await send("Target.attachToTarget", {
        targetId: pages[0].targetId,
        flatten: true,
      });
      attached = { sessionId, targetId: pages[0].targetId, url: pages[0].url };
      return attached;
    }
    if (Date.now() > deadline)
      throw Error("Expected one owned page target for the owned renderer document");
    await new Promise((done) => setTimeout(done, 250));
  }
};

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ error: "bad request" }) + "\n");
    return;
  }
  try {
    if (request.op === "attach") {
      process.stdout.write(
        JSON.stringify({ id: request.id, result: await attachedSession() }) +
          "\n",
      );
      return;
    }
    if (request.op === "targets") {
      process.stdout.write(
        JSON.stringify({
          id: request.id,
          result: await send("Target.getTargets"),
        }) + "\n",
      );
      return;
    }
    const sessionId = request.sessionId ?? (await attachedSession()).sessionId;
    const result = await send(request.method, request.params, sessionId);
    process.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        id: request.id,
        error:
          typeof error === "object" && error
            ? String(error.message ?? "cdp")
            : String(error),
      }) + "\n",
    );
  }
});
lines.on("close", () => {
  try {
    socket.close();
  } catch {}
  process.exit(0);
});
