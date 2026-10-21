/** Only the owned fixture Node server's passive request event; never reads body/headers/response. */
import assert from "node:assert/strict";
export function installMacColdIngressObserver(server) {
  let count = 0,
    unavailable = false;
  const observe = (request) => {
    try {
      if (
        request.method === "POST" &&
        typeof request.url === "string" &&
        request.url.split("?", 1)[0] === "/v1/chat/completions"
      )
        count++;
    } catch {
      unavailable = true;
    }
  };
  server.on("request", observe);
  server.once("close", () => server.off("request", observe));
  return {
    read() {
      assert.ok(!unavailable, "Ingress observation unavailable");
      assert.ok(Number.isSafeInteger(count));
      return count;
    },
  };
}
