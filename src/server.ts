import { createApp } from "./app.js";
import { environment } from "./config.js";
const config = environment();
const app = await createApp({ ...config, logger: true, worker: true });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
await app.listen({ host: config.host, port: config.port });
