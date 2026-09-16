import { vi, describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "actions-test.db");

// Set isolated test database URL before any modules are loaded
process.env.DATABASE_URL = `file:${testDbPath}`;

// Mock the GoogleGenAI module for offline testing
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  getDashboardData,
  triggerTick,
  executeTrade,
  getAIRecommendation,
} from "../trading";

describe("Server Actions Transport Boundary", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    // Ensure clean database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
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
    process.env.GEMINI_API_KEY = "mock-api-key-for-server-action-tests";
    vi.clearAllMocks();

    // Reset database state before each test
    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");
    await db.execute("UPDATE portfolio_state SET cash = 100000.0, updated_at = ? WHERE id = 1", [new Date().toISOString()]);
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  describe("getDashboardData()", () => {
    it("should retrieve initial seeded portfolio state and default fallback prices", async () => {
      const data = await getDashboardData();

      expect(data.cash).toBe(100000.0);
      expect(data.holdingsValue).toBe(0.0);
      expect(data.netAssetValue).toBe(100000.0);
      expect(data.holdings).toEqual([]);
      expect(data.orders).toEqual([]);
      expect(data.prices).toEqual({
        BTC: 60000.0,
        ETH: 3000.0,
        SOL: 150.0,
      });
    });
  });

  describe("triggerTick()", () => {
    it("should generate, persist, and return advanced deterministic price ticks", async () => {
      // 1. Advance the tick
      const nextPrices = await triggerTick();

      // Pricing values should differ from fallback defaults
      expect(nextPrices.BTC).toBeDefined();
      expect(nextPrices.BTC).not.toBe(60000.0);

      // 2. Fetch history records from DB to ensure prices were persisted
      const historyRes = await db.execute("SELECT * FROM market_history ORDER BY timestamp DESC");
      expect(historyRes.rows.length).toBe(3); // BTC, ETH, SOL

      // 3. Verify getDashboardData retrieves the updated market rates
      const updatedData = await getDashboardData();
      expect(updatedData.prices).toEqual(nextPrices);
    });
  });

  describe("executeTrade()", () => {
    it("should reject trades with invalid asset symbols with a transport error", async () => {
      await expect(executeTrade("DOGE", "BUY", 10)).rejects.toThrow(
        'Transport Error: Unsupported trade asset "DOGE".'
      );
    });

    it("should reject trades with non-positive quantities with a transport error", async () => {
      await expect(executeTrade("BTC", "BUY", 0)).rejects.toThrow(
        "Transport Error: Quantity must be strictly positive."
      );
      await expect(executeTrade("BTC", "BUY", -5)).rejects.toThrow(
        "Transport Error: Quantity must be strictly positive."
      );
    });

    it("should successfully execute a valid BUY order at the locked database price tick", async () => {
      // 1. Tick the market to write standard prices into market_history
      const prices = await triggerTick();
      const btcPrice = prices.BTC;

      // 2. Buy 1 BTC
      const tradeRes = await executeTrade("BTC", "BUY", 1);
      expect(tradeRes.status).toBe("EXECUTED");

      // 3. Verify portfolio cash balance decayed correctly
      const dashboard = await getDashboardData();
      expect(dashboard.cash).toBe(Math.round((100000.0 - btcPrice) * 100) / 100);

      // 4. Verify holdings correctly track 1 BTC
      expect(dashboard.holdings).toHaveLength(1);
      expect(dashboard.holdings[0]).toEqual({
        symbol: "BTC",
        quantity: 1,
        currentPrice: btcPrice,
        totalValue: btcPrice,
      });
    });
  });

  describe("getAIRecommendation()", () => {
    it("should gather complete database metrics, prompt Gemini, and return structured suggestions without executing them", async () => {
      // Seed a historical tick first
      const prices = await triggerTick();

      // Mock Gemini JSON output
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          action: "BUY",
          symbol: "ETH",
          quantity: 2.5,
          confidence: 0.9,
          reason: "Technical breakouts in ETH indicate a near-term rally.",
        }),
      });

      const recommendation = await getAIRecommendation();

      expect(recommendation).toEqual({
        action: "BUY",
        symbol: "ETH",
        quantity: 2.5,
        confidence: 0.9,
        reason: "Technical breakouts in ETH indicate a near-term rally.",
      });

      // Verify that no trade order was executed automatically
      const dashboard = await getDashboardData();
      expect(dashboard.cash).toBe(100000.0); // Cash remains exactly unchanged
      expect(dashboard.orders).toHaveLength(0); // No executed trades in log
    });
  });
});
