import { TEST_DATABASE_URL } from "./test-env";

// Runs before each test file's imports, so the Prisma client binds to the test database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-0123456789abcdef0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.CRON_SECRET = "test-cron-secret";
process.env.EMAIL_PROVIDER = "console";
process.env.AI_PROVIDER = "heuristic";
