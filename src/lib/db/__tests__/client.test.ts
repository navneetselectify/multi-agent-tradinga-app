import { afterAll, describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Must run before static imports are resolved: db/client.ts opens the database
// eagerly, so the isolated file is removed and selected before it is imported.
vi.hoisted(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dbPath = path.resolve(process.cwd(), "test.db");
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-journal`, { force: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
});

const testDbPath = path.resolve(process.cwd(), "test.db");

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("SQLite Persistence", () => {
  afterAll(async () => {
    // Close connection so we can delete the file safely
    db.close();
    
    // Clean up test database file
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Also clean up any journal/wal files if created
    const journalPath = `${testDbPath}-journal`;
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
  });

  it("should run migrations and seed portfolio successfully", async () => {
    // Run the migrations
    await runMigrations();

    // Clean out tables to prevent previous test runs from leaking
    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");

    // Verify portfolio state exists and is seeded with $100,000
    const stateResult = await db.execute("SELECT * FROM portfolio_state WHERE id = 1");
    expect(stateResult.rows.length).toBe(1);
    
    const row = stateResult.rows[0];
    expect(row.id).toBe(1);
    expect(row.cash).toBe(100000.0);
    expect(typeof row.updated_at).toBe("string");

    // Verify tables exist by attempting to select from them
    const holdingsResult = await db.execute("SELECT COUNT(*) as count FROM portfolio_holdings");
    expect(holdingsResult.rows[0].count).toBe(0);

    const ordersResult = await db.execute("SELECT COUNT(*) as count FROM orders");
    expect(ordersResult.rows[0].count).toBe(0);

    const marketHistoryResult = await db.execute("SELECT COUNT(*) as count FROM market_history");
    expect(marketHistoryResult.rows[0].count).toBe(0);
  });

  it("should be idempotent and not fail on subsequent migration runs", async () => {
    // Running migrations again should succeed cleanly
    await expect(runMigrations()).resolves.not.toThrow();

    // Verify cash is still $100,000
    const stateResult = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    expect(stateResult.rows[0].cash).toBe(100000.0);
  });
});
