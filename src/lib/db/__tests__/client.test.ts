import { beforeAll, afterAll, describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "test.db");

// Set environment variable before any modules are loaded
process.env.DATABASE_URL = `file:${testDbPath}`;

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("SQLite Persistence", () => {
  beforeAll(async () => {
    // Ensure clean test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    try {
      await db.execute("DELETE FROM portfolio_state");
    } catch {
      // Ignore if table does not exist prior to migrations
    }
  });

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
