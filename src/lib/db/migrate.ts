import { db } from "./client";

export async function runMigrations() {
  console.log("Starting SQLite migrations...");

  try {
    // 1. Create tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS portfolio_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cash REAL NOT NULL CHECK (cash >= 0),
        updated_at TEXT NOT NULL
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        symbol TEXT PRIMARY KEY NOT NULL,
        quantity REAL NOT NULL CHECK (quantity >= 0),
        updated_at TEXT NOT NULL
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity REAL NOT NULL CHECK (quantity > 0),
        price REAL NOT NULL CHECK (price > 0),
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'EXECUTED', 'CANCELLED')),
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS market_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL CHECK (price > 0),
        timestamp TEXT NOT NULL
      );
    `);

    console.log("Tables created successfully.");

    // 2. Seed initial portfolio_state if empty
    const result = await db.execute("SELECT COUNT(*) as count FROM portfolio_state");
    const count = result.rows[0]?.count as number;

    if (count === 0) {
      console.log("Seeding initial portfolio state...");
      const timestamp = new Date().toISOString();
      await db.execute({
        sql: "INSERT INTO portfolio_state (id, cash, updated_at) VALUES (1, 100000.0, ?)",
        args: [timestamp],
      });
      console.log("Seeded portfolio with $100,000 cash.");
    } else {
      console.log("Portfolio state already seeded.");
    }

    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

// Execute migration if run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith("migrate.ts") || 
  process.argv[1].endsWith("migrate.js")
);

if (isDirectRun) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
