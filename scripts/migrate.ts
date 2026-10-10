import "./load-env";
import { runMigrations } from "../src/lib/db/migrate";
import { closeDb } from "../src/lib/db/client";

runMigrations()
  .then(() => console.log("✔ migrations applied"))
  .catch((e) => {
    console.error("✖ migration failed:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
