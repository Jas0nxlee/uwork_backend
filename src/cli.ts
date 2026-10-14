import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Db } from "./db.js";
import { bootstrap } from "./identity.js";
import { environment } from "./config.js";

if (process.argv[2] !== "init") throw new Error("Supported command: init");
if (!process.env.MASTER_KEY) {
  try {
    await readFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(
      ".env",
      `MASTER_KEY=${randomBytes(32).toString("hex")}\nDATABASE_PATH=data/uwork.sqlite\nPUBLIC_URL=http://localhost:3000\nHOST=127.0.0.1\nPORT=3000\nALLOW_PRIVATE_UPSTREAMS=false\n`,
      { mode: 0o600, flag: "wx" },
    );
  }
  process.loadEnvFile(".env");
}
const config = environment();
const db = new Db(config.database);
try {
  if (db.get("SELECT id FROM tenants LIMIT 1")) {
    console.log("Database already initialized. No accounts changed.");
  } else {
    const password =
      process.env.BOOTSTRAP_PASSWORD ?? randomBytes(24).toString("base64url");
    const email = process.env.BOOTSTRAP_EMAIL ?? "admin@uwork.local";
    const result = await bootstrap(db, {
      name: process.env.BOOTSTRAP_ORGANIZATION ?? "UWork 本地企业",
      email,
      password,
    });
    await mkdir("data", { recursive: true, mode: 0o700 });
    await writeFile(
      "data/bootstrap-credentials.txt",
      `URL: ${config.publicUrl}\nEmail: ${email}\nPassword: ${password}\nTenant ID: ${result.tenantId}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Initialized. Credentials: data/bootstrap-credentials.txt (mode 0600).",
    );
  }
} finally {
  db.close();
}
