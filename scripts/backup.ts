import { backupDatabase } from "../src/db.js";
import { environment } from "../src/config.js";
import { resolve } from "node:path";
const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: npm run backup -- /absolute/path/snapshot.sqlite");
await backupDatabase(environment().database, resolve(destination));
console.log(
  "SQLite online backup completed. Keep MASTER_KEY in a separate protected backup.",
);
