import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./test-env";

/**
 * Apply migrations to the dedicated test database (non-destructive `migrate deploy`).
 * Tests isolate themselves by truncating tables, so the schema only needs to be current.
 */
export default function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${dbName}": database name must end with _test`);
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
