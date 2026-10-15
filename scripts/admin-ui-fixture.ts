import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

// 独立内存库和专用 hostname：浏览器回归不会接触实际企业账号或持久数据。
const port = Number(process.env.UWORK_VERIFICATION_PORT ?? 3015);
const app = await createApp({
  database: ":memory:",
  masterKey: randomBytes(32),
  publicUrl: `http://uwork-review.localhost:${port}`,
});
await bootstrap(app.services.db, {
  name: "Controlled UI verification",
  email: "review@example.test",
  password: "synthetic-review-only",
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host: "127.0.0.1", port });
console.log(`Controlled UI fixture: http://uwork-review.localhost:${port}`);
