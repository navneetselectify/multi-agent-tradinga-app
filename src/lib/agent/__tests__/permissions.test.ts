import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "permissions-test.db");

// Isolate database file before importing db client
process.env.DATABASE_URL = `file:${testDbPath}`;

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { tradeEvents } from "@/lib/events";
import {
  RISK_REVIEWER_AGENT,
  TRADING_AGENT,
  executeTool,
  hasPermission,
  ExecuteTradeTool,
  GetPortfolioAndMarketStateTool,
  AdvanceMarketTool,
  getToolsForAgent,
} from "@/lib/agent";

describe("Agent Permission System & Security Enforcement", () => {
  const tradeTool = new ExecuteTradeTool();
  const readTool = new GetPortfolioAndMarketStateTool();
  const advanceTool = new AdvanceMarketTool();

  beforeAll(async () => {
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
    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");
    await db.execute(
      "UPDATE portfolio_state SET cash = 100000.0, updated_at = ? WHERE id = 1",
      [new Date().toISOString()]
    );
  });

  describe("Agent Contexts & Permissions Model", () => {
    it("should configure Risk Reviewer with portfolio.read only", () => {
      expect(RISK_REVIEWER_AGENT.permissions).toEqual(["portfolio.read"]);
      expect(hasPermission(RISK_REVIEWER_AGENT, "portfolio.read")).toBe(true);
      expect(hasPermission(RISK_REVIEWER_AGENT, "market.advance")).toBe(false);
      expect(hasPermission(RISK_REVIEWER_AGENT, "trade.execute")).toBe(false);
    });

    it("should configure Trading Agent with all permissions", () => {
      expect(TRADING_AGENT.permissions).toEqual([
        "portfolio.read",
        "market.advance",
        "trade.execute",
      ]);
      expect(hasPermission(TRADING_AGENT, "portfolio.read")).toBe(true);
      expect(hasPermission(TRADING_AGENT, "market.advance")).toBe(true);
      expect(hasPermission(TRADING_AGENT, "trade.execute")).toBe(true);
    });

    it("should declare required permissions on all tools", () => {
      expect(readTool.requiredPermission).toBe("portfolio.read");
      expect(advanceTool.requiredPermission).toBe("market.advance");
      expect(tradeTool.requiredPermission).toBe("trade.execute");
    });
  });

  describe("Unauthorized Execution Enforcement (Risk Reviewer)", () => {
    it("should deny trade execution for Risk Reviewer BEFORE tool execution", async () => {
      const eventListener = vi.fn();
      tradeEvents.on("trade.executed", eventListener);

      try {
        const result = await executeTool(tradeTool, RISK_REVIEWER_AGENT, {
          symbol: "BTC",
          side: "BUY",
          quantity: 1,
        });

        // 1. Result is structured permission denial
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("PERMISSION_DENIED");
        expect(result.error?.message).toContain("Risk Reviewer");
        expect(result.error?.message).toContain("trade.execute");

        // 2. No order created in database
        const orders = await db.execute("SELECT COUNT(*) as count FROM orders");
        expect(orders.rows[0].count).toBe(0);

        // 3. Cash remains completely unchanged
        const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
        expect(cashRes.rows[0].cash).toBe(100000.0);

        // 4. Holdings remain empty
        const holdingsRes = await db.execute("SELECT COUNT(*) as count FROM portfolio_holdings");
        expect(holdingsRes.rows[0].count).toBe(0);

        // 5. trade.executed event is NOT emitted
        expect(eventListener).not.toHaveBeenCalled();
      } finally {
        tradeEvents.off("trade.executed", eventListener);
      }
    });

    it("should deny permission before schema validation or side effects occur", async () => {
      // Pass completely invalid payload that would fail schema validation
      const invalidArgs = {
        symbol: "DOGE_INVALID",
        side: "NON_EXISTENT",
        quantity: -999,
      };

      const result = await executeTool(tradeTool, RISK_REVIEWER_AGENT, invalidArgs);

      // Must be PERMISSION_DENIED, proving check happens BEFORE tool validation
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PERMISSION_DENIED");
    });

    it("should deny market advancement for Risk Reviewer", async () => {
      const result = await executeTool(advanceTool, RISK_REVIEWER_AGENT, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PERMISSION_DENIED");
      expect(result.error?.message).toContain("market.advance");
    });

    it("should permit Risk Reviewer to execute read tools", async () => {
      const result = await executeTool(readTool, RISK_REVIEWER_AGENT, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.cash).toBe(100000.0);
    });
  });

  describe("Authorized Execution (Trading Agent)", () => {
    it("should allow Trading Agent to execute an authorized trade and emit trade.executed", async () => {
      const eventListener = vi.fn();
      tradeEvents.on("trade.executed", eventListener);

      try {
        const result = await executeTool(tradeTool, TRADING_AGENT, {
          symbol: "BTC",
          side: "BUY",
          quantity: 1,
        });

        // 1. Tool execution succeeded
        expect(result.success).toBe(true);
        expect(result.data?.status).toBe("EXECUTED");
        expect(result.data?.orderId).toBeGreaterThan(0);

        // 2. Order row recorded in database
        const orders = await db.execute("SELECT * FROM orders WHERE status = 'EXECUTED'");
        expect(orders.rows.length).toBe(1);
        expect(orders.rows[0].symbol).toBe("BTC");
        expect(orders.rows[0].side).toBe("BUY");

        // 3. Cash balance deducted (default fallback BTC price is 60,000.0)
        const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
        expect(cashRes.rows[0].cash).toBe(40000.0);

        // 4. Holdings updated
        const holdingsRes = await db.execute("SELECT quantity FROM portfolio_holdings WHERE symbol = 'BTC'");
        expect(holdingsRes.rows[0].quantity).toBe(1);

        // 5. trade.executed event emitted exactly once
        expect(eventListener).toHaveBeenCalledTimes(1);
        expect(eventListener).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: result.data?.orderId,
            symbol: "BTC",
            side: "BUY",
            quantity: 1,
            price: 60000.0,
          })
        );
      } finally {
        tradeEvents.off("trade.executed", eventListener);
      }
    });

    it("should allow Trading Agent to advance market", async () => {
      const result = await executeTool(advanceTool, TRADING_AGENT, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.BTC).toBeDefined();
    });
  });

  describe("Scoped Tool Registry Architecture", () => {
    it("should scope tools available to Risk Reviewer to read-only capabilities", () => {
      const tools = getToolsForAgent(RISK_REVIEWER_AGENT);
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("get_portfolio_and_market_state");
      expect(toolNames).not.toContain("execute_asset_trade");
      expect(toolNames).not.toContain("advance_market");
    });

    it("should provide full tool catalog to Trading Agent", () => {
      const tools = getToolsForAgent(TRADING_AGENT);
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("get_portfolio_and_market_state");
      expect(toolNames).toContain("advance_market");
      expect(toolNames).toContain("execute_asset_trade");
    });
  });
});
