import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "cycle-integration-test.db");

// Isolate database before static imports load db/client.ts
vi.hoisted(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dbPath = path.resolve(process.cwd(), "cycle-integration-test.db");
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-journal`, { force: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
});

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { runTradingCycle } from "../runTradingCycle";
import { TradeProposal } from "@/lib/agent/contracts";
import { createRiskReviewer } from "@/lib/agent/reviewer";
import { AgentExecutor } from "@/lib/agent/executor";

describe("runTradingCycle Integration with Real DB & Mock Reviewer", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const journalPath = `${testDbPath}-journal`;
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
  });

  beforeEach(async () => {
    // Reset DB state
    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");
    await db.execute("UPDATE portfolio_state SET cash = 100000.0, updated_at = ? WHERE id = 1", [
      new Date().toISOString(),
    ]);

    // Seed initial market prices for BTC, ETH, SOL
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO market_history (symbol, price, timestamp) VALUES ('BTC', 60000.0, ?)",
      [now]
    );
    await db.execute(
      "INSERT INTO market_history (symbol, price, timestamp) VALUES ('ETH', 3000.0, ?)",
      [now]
    );
    await db.execute(
      "INSERT INTO market_history (symbol, price, timestamp) VALUES ('SOL', 150.0, ?)",
      [now]
    );
  });

  it("executes an end-to-end trading cycle: propose -> hard risk -> reviewer -> gate -> executeTrade in DB", async () => {
    const proposal: TradeProposal = {
      action: "BUY",
      symbol: "BTC",
      quantity: 1,
      confidence: 0.9,
      reason: "Momentum breakout confirmed by technical indicators.",
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        finalResponse: JSON.stringify({
          verdict: "APPROVE",
          reason: "Risk-reward profile is favorable within current portfolio limits.",
        }),
      }),
    } as unknown as AgentExecutor;

    const reviewAdapter = createRiskReviewer({ executor: mockExecutor });

    // runTradingCycle uses real getDashboardData and real executeTrade against the test DB
    const report = await runTradingCycle({
      propose: async () => proposal,
      review: reviewAdapter,
    });

    expect(report.outcome).toBe("EXECUTED");
    expect(report.hardRisk?.allowed).toBe(true);
    expect(report.hardRisk?.executionPrice).toBe(60000);
    expect(report.verdict).toEqual({
      verdict: "APPROVE",
      reason: "Risk-reward profile is favorable within current portfolio limits.",
    });
    expect(report.gate?.execute).toBe(true);
    expect(report.order?.status).toBe("EXECUTED");

    // Verify database state: cash deducted, holdings recorded, order saved
    const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    expect(cashRes.rows[0].cash).toBe(40000.0); // 100000 - 60000

    const holdingsRes = await db.execute("SELECT symbol, quantity FROM portfolio_holdings WHERE symbol = 'BTC'");
    expect(holdingsRes.rows[0].quantity).toBe(1);

    const ordersRes = await db.execute("SELECT symbol, side, quantity, price, status FROM orders");
    expect(ordersRes.rows).toHaveLength(1);
    expect(ordersRes.rows[0].symbol).toBe("BTC");
    expect(ordersRes.rows[0].side).toBe("BUY");
    expect(ordersRes.rows[0].quantity).toBe(1);
    expect(ordersRes.rows[0].price).toBe(60000.0);
    expect(ordersRes.rows[0].status).toBe("EXECUTED");
  });

  it("skips execution on REJECT verdict without altering DB state", async () => {
    const proposal: TradeProposal = {
      action: "BUY",
      symbol: "BTC",
      quantity: 1,
      confidence: 0.8,
      reason: "Attempting buy before volatility spike.",
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        finalResponse: JSON.stringify({
          verdict: "REJECT",
          reason: "Excessive exposure given pending macroeconomic data.",
        }),
      }),
    } as unknown as AgentExecutor;

    const reviewAdapter = createRiskReviewer({ executor: mockExecutor });

    const report = await runTradingCycle({
      propose: async () => proposal,
      review: reviewAdapter,
    });

    expect(report.outcome).toBe("SKIPPED");
    expect(report.hardRisk?.allowed).toBe(true);
    expect(report.verdict?.verdict).toBe("REJECT");
    expect(report.gate?.execute).toBe(false);
    expect(report.order).toBeNull();

    // Verify DB was unchanged
    const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    expect(cashRes.rows[0].cash).toBe(100000.0);

    const ordersRes = await db.execute("SELECT * FROM orders");
    expect(ordersRes.rows).toHaveLength(0);
  });

  it("executes adjusted quantity on ADJUST verdict with real DB state updates", async () => {
    const proposal: TradeProposal = {
      action: "BUY",
      symbol: "BTC",
      quantity: 1,
      confidence: 0.75,
      reason: "Moderate upside opportunity.",
    };

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        finalResponse: JSON.stringify({
          verdict: "ADJUST",
          reason: "Reduce position size to conserve liquidity.",
          adjustedQuantity: 0.5,
        }),
      }),
    } as unknown as AgentExecutor;

    const reviewAdapter = createRiskReviewer({ executor: mockExecutor });

    const report = await runTradingCycle({
      propose: async () => proposal,
      review: reviewAdapter,
    });

    expect(report.outcome).toBe("EXECUTED");
    expect(report.gate?.execute).toBe(true);
    if (report.gate?.execute) {
      expect(report.gate.quantity).toBe(0.5);
    }
    expect(report.order?.status).toBe("EXECUTED");

    // Verify DB reflected adjusted quantity
    const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    expect(cashRes.rows[0].cash).toBe(70000.0); // 100000 - (60000 * 0.5)

    const holdingsRes = await db.execute("SELECT symbol, quantity FROM portfolio_holdings WHERE symbol = 'BTC'");
    expect(holdingsRes.rows[0].quantity).toBe(0.5);

    const ordersRes = await db.execute("SELECT symbol, side, quantity, price, status FROM orders");
    expect(ordersRes.rows).toHaveLength(1);
    expect(ordersRes.rows[0].quantity).toBe(0.5);
  });
});
