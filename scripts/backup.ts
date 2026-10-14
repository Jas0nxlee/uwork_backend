import { Db } from "../src/db.js";
import { environment } from "../src/config.js";
import { resolve } from "node:path";
const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: npm run backup -- /absolute/path/snapshot.sqlite");
const db = new Db(environment().database);
try {
  await db.backupTo(resolve(destination));
  console.log(
    "SQLite online backup completed. Keep MASTER_KEY in a separate protected backup.",
  );
} finally {
  db.close();
}
