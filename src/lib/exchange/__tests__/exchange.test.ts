import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "exchange-test.db");

// Isolate database file before importing client
process.env.DATABASE_URL = `file:${testDbPath}`;

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { MockExchangeEngine } from "../engine";
import { OrderService } from "../service";

describe("Mock Exchange & Order Execution", () => {
  let engine: MockExchangeEngine;

  beforeAll(async () => {
    // Delete old test database if any
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Initialize schema
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
    // Reset database to initial state
    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");
    await db.execute("UPDATE portfolio_state SET cash = 100000.0, updated_at = ? WHERE id = 1", [new Date().toISOString()]);
    
    // Instantiate a new engine with standard seed
    engine = new MockExchangeEngine(12345);
  });

  describe("MockExchangeEngine (Pricing Model)", () => {
    it("should produce the same price sequence when using the same seed", () => {
      const engine1 = new MockExchangeEngine(42);
      const engine2 = new MockExchangeEngine(42);

      const sequence1 = [engine1.tick(), engine1.tick(), engine1.tick()];
      const sequence2 = [engine2.tick(), engine2.tick(), engine2.tick()];

      expect(sequence1).toEqual(sequence2);
    });

    it("should produce different sequences when using different seeds", () => {
      const engine1 = new MockExchangeEngine(111);
      const engine2 = new MockExchangeEngine(222);

      const sequence1 = [engine1.tick(), engine1.tick()];
      const sequence2 = [engine2.tick(), engine2.tick()];

      expect(sequence1).not.toEqual(sequence2);
    });

    it("should retrieve individual asset prices correctly", () => {
      expect(engine.getPrice("BTC")).toBe(60000.0);
      expect(engine.getPrice("eth")).toBe(3000.0); // Handles lowercase
      expect(() => engine.getPrice("XYZ")).toThrow("Unsupported symbol");
    });

    it("should initialize correct prices when starting prices are supplied to constructor", () => {
      const customPrices = { BTC: 55000.0, ETH: 2800.0 };
      const engine1 = new MockExchangeEngine(12345, customPrices);

      expect(engine1.getPrice("BTC")).toBe(55000.0);
      expect(engine1.getPrice("ETH")).toBe(2800.0);
      expect(engine1.getPrice("SOL")).toBe(150.0); // Retains default for SOL
    });
  });

  describe("OrderService (Trade Execution)", () => {
    it("should fail a BUY order with CANCELLED status when funds are insufficient", async () => {
      const btcPrice = engine.getPrice("BTC"); // 60,000
      // Attempting to buy 2 BTC requires $120,000 (starting cash is $100,000)
      const res = await OrderService.executeTrade("BTC", "BUY", 2, btcPrice);

      expect(res.status).toBe("CANCELLED");
      expect(res.reason).toBe("Insufficient funds");
      expect(res.orderId).toBeGreaterThan(0);

      // Verify DB state remains unchanged
      const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
      expect(cashRes.rows[0].cash).toBe(100000.0);

      const holdingsRes = await db.execute("SELECT COUNT(*) as count FROM portfolio_holdings");
      expect(holdingsRes.rows[0].count).toBe(0);

      // Verify order table records the cancellation
      const orderRes = await db.execute({
        sql: "SELECT * FROM orders WHERE id = ?",
        args: [res.orderId],
      });
      expect(orderRes.rows[0].status).toBe("CANCELLED");
      expect(orderRes.rows[0].cancel_reason).toBe("Insufficient funds");
    });

    it("should fail a SELL order with CANCELLED status when holdings are insufficient", async () => {
      const btcPrice = engine.getPrice("BTC");
      // Attempt to sell 1 BTC when portfolio holds 0 BTC
      const res = await OrderService.executeTrade("BTC", "SELL", 1, btcPrice);

      expect(res.status).toBe("CANCELLED");
      expect(res.reason).toBe("Insufficient holdings");

      // Verify cash balance is unaffected
      const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
      expect(cashRes.rows[0].cash).toBe(100000.0);

      // Verify cancellation is saved
      const orderRes = await db.execute({
        sql: "SELECT * FROM orders WHERE id = ?",
        args: [res.orderId],
      });
      expect(orderRes.rows[0].status).toBe("CANCELLED");
      expect(orderRes.rows[0].cancel_reason).toBe("Insufficient holdings");
    });

    it("should execute a successful BUY order and update portfolio atomically", async () => {
      const ethPrice = engine.getPrice("ETH"); // 3000
      // Buy 5 ETH = $15,000
      const res = await OrderService.executeTrade("ETH", "BUY", 5, ethPrice);

      expect(res.status).toBe("EXECUTED");
      expect(res.reason).toBeUndefined();

      // Cash decreases to $85,000
      const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
      expect(cashRes.rows[0].cash).toBe(85000.0);

      // Holdings increase to 5 ETH
      const holdingRes = await db.execute({
        sql: "SELECT quantity FROM portfolio_holdings WHERE symbol = 'ETH'",
        args: [],
      });
      expect(holdingRes.rows[0].quantity).toBe(5);

      // Verify execution is saved in orders
      const orderRes = await db.execute({
        sql: "SELECT * FROM orders WHERE id = ?",
        args: [res.orderId],
      });
      expect(orderRes.rows[0].status).toBe("EXECUTED");
      expect(orderRes.rows[0].cancel_reason).toBeNull();
    });

    it("should execute a successful SELL order and decrement holdings/increment cash atomically", async () => {
      // 1. First seed holdings by buying 10 SOL @ $150 ($1,500 total)
      const solPrice = engine.getPrice("SOL");
      await OrderService.executeTrade("SOL", "BUY", 10, solPrice);

      // Verify pre-conditions
      const preCash = (await db.execute("SELECT cash FROM portfolio_state WHERE id = 1")).rows[0].cash as number;
      expect(preCash).toBe(98500.0);

      // 2. Sell 4 SOL @ $150 ($600 credit)
      const res = await OrderService.executeTrade("SOL", "SELL", 4, solPrice);
      expect(res.status).toBe("EXECUTED");

      // Verify holdings decayed to 6 SOL
      const holdingRes = await db.execute("SELECT quantity FROM portfolio_holdings WHERE symbol = 'SOL'");
      expect(holdingRes.rows[0].quantity).toBe(6);

      // Verify cash increased to $99,100 ($98,500 + $600)
      const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
      expect(cashRes.rows[0].cash).toBe(99100.0);
    });

    it("should completely remove holding row when asset quantity becomes zero", async () => {
      const solPrice = engine.getPrice("SOL");
      
      // Buy 2 SOL, then sell all 2 SOL
      await OrderService.executeTrade("SOL", "BUY", 2, solPrice);
      await OrderService.executeTrade("SOL", "SELL", 2, solPrice);

      // Verify holdings row is completely removed
      const holdingRes = await db.execute("SELECT COUNT(*) as count FROM portfolio_holdings WHERE symbol = 'SOL'");
      expect(holdingRes.rows[0].count).toBe(0);
    });

    it("should roll back transaction and leave portfolio state untouched on SQL failure", async () => {
      const btcPrice = engine.getPrice("BTC");
      
      // We will trigger a CHECK constraint violation by executing a trade with an invalid quantity of -1
      // The orders table check constraints require (quantity > 0)
      await expect(
        OrderService.executeTrade("BTC", "BUY", -1, btcPrice)
      ).rejects.toThrow();

      // Verify portfolio cash remained exactly $100,000 (aborted trade did not deduct money)
      const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
      expect(cashRes.rows[0].cash).toBe(100000.0);

      // Verify holdings are still empty
      const holdingRes = await db.execute("SELECT COUNT(*) as count FROM portfolio_holdings");
      expect(holdingRes.rows[0].count).toBe(0);
    });

    it("should successfully log market history values when tick records are stored", async () => {
      const marketState = engine.tick();
      await OrderService.recordTickPrices(marketState);

      const historyCount = await db.execute("SELECT COUNT(*) as count FROM market_history");
      // BTC, ETH, SOL recorded = 3 records
      expect(historyCount.rows[0].count).toBe(3);
    });
  });
});
