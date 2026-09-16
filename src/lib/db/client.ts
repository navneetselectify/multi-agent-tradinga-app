import { createClient } from "@libsql/client";

const dbUrl = process.env.DATABASE_URL || "file:local.db";

export const db = createClient({
  url: dbUrl,
});
