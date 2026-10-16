import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, open, rm } from "node:fs/promises";
import { Db } from "./db.js";
import { bootstrap } from "./identity.js";
import { environment } from "./config.js";
import { id } from "./core.js";

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
const db = new Db(config.database, id());
try {
  if (db.get("SELECT id FROM tenants LIMIT 1")) {
    console.log("Database already initialized. No accounts changed.");
  } else {
    const password =
      process.env.BOOTSTRAP_PASSWORD ?? randomBytes(24).toString("base64url");
    const email = process.env.BOOTSTRAP_EMAIL ?? "admin@uwork.local";
    await mkdir("data", { recursive: true, mode: 0o700 });
    const credentialPath = "data/bootstrap-credentials.txt";
    const credentials = await open(credentialPath, "wx", 0o600);
    let created = false;
    try {
      // Persist the login material before committing the random-password account.
      // If a later annotation fails, these credentials still allow recovery.
      await credentials.writeFile(
        `URL: ${config.publicUrl}\nEmail: ${email}\nPassword: ${password}\n`,
      );
      await credentials.sync();
      const result = await bootstrap(db, {
        name: process.env.BOOTSTRAP_ORGANIZATION ?? "UWork 本地企业",
        email,
        password,
      });
      created = true;
      await credentials.appendFile(`Tenant ID: ${result.tenantId}\n`);
      await credentials.sync();
    } finally {
      try {
        await credentials.close();
      } finally {
        if (!created) await rm(credentialPath, { force: true });
      }
    }
    console.log(
      "Initialized. Credentials: data/bootstrap-credentials.txt (mode 0600).",
    );
  }
} finally {
  db.close();
}
