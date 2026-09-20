import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const testDbPath = path.resolve(process.cwd(), "events-test.db");

// Isolate database file before importing db client
process.env.DATABASE_URL = `file:${testDbPath}`;

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { OrderService } from "@/lib/exchange/service";
import { tradeEvents, TradeExecutedPayload } from "@/lib/events";

describe("trade.executed Event System", () => {
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

  it("should emit trade.executed exactly once for a successful BUY trade with required payload fields", async () => {
    const listener = vi.fn();
    tradeEvents.on("trade.executed", listener);

    try {
      const ethPrice = 3000.0;
      const quantity = 2;
      const res = await OrderService.executeTrade("ETH", "BUY", quantity, ethPrice);

      expect(res.status).toBe("EXECUTED");
      expect(listener).toHaveBeenCalledTimes(1);

      const payload: TradeExecutedPayload = listener.mock.calls[0][0];
      expect(payload).toEqual({
        orderId: res.orderId,
        symbol: "ETH",
        side: "BUY",
        quantity: 2,
        price: 3000.0,
      });

      // Explicit property checks
      expect(payload.orderId).toBe(res.orderId);
      expect(typeof payload.orderId).toBe("number");
      expect(payload.symbol).toBe("ETH");
      expect(payload.side).toBe("BUY");
      expect(payload.quantity).toBe(quantity);
      expect(payload.price).toBe(ethPrice);
    } finally {
      tradeEvents.off("trade.executed", listener);
    }
  });

  it("should emit trade.executed exactly once for a successful SELL trade with required payload fields", async () => {
    // Seed holdings first
    await OrderService.executeTrade("SOL", "BUY", 10, 150.0);

    const listener = vi.fn();
    tradeEvents.on("trade.executed", listener);

    try {
      const solPrice = 150.0;
      const quantity = 4;
      const res = await OrderService.executeTrade("SOL", "SELL", quantity, solPrice);

      expect(res.status).toBe("EXECUTED");
      expect(listener).toHaveBeenCalledTimes(1);

      const payload: TradeExecutedPayload = listener.mock.calls[0][0];
      expect(payload).toEqual({
        orderId: res.orderId,
        symbol: "SOL",
        side: "SELL",
        quantity: 4,
        price: 150.0,
      });

      // Explicit property checks
      expect(payload.orderId).toBe(res.orderId);
      expect(typeof payload.orderId).toBe("number");
      expect(payload.symbol).toBe("SOL");
      expect(payload.side).toBe("SELL");
      expect(payload.quantity).toBe(quantity);
      expect(payload.price).toBe(solPrice);
    } finally {
      tradeEvents.off("trade.executed", listener);
    }
  });

  it("should not emit trade.executed for cancelled BUY trades due to insufficient funds", async () => {
    const listener = vi.fn();
    tradeEvents.on("trade.executed", listener);

    try {
      // Trying to buy 2 BTC @ $60,000 requires $120,000 (portfolio has $100,000)
      const res = await OrderService.executeTrade("BTC", "BUY", 2, 60000.0);

      expect(res.status).toBe("CANCELLED");
      expect(res.reason).toBe("Insufficient funds");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      tradeEvents.off("trade.executed", listener);
    }
  });

  it("should not emit trade.executed for cancelled SELL trades due to insufficient holdings", async () => {
    const listener = vi.fn();
    tradeEvents.on("trade.executed", listener);

    try {
      // Trying to sell 5 ETH when holding 0
      const res = await OrderService.executeTrade("ETH", "SELL", 5, 3000.0);

      expect(res.status).toBe("CANCELLED");
      expect(res.reason).toBe("Insufficient holdings");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      tradeEvents.off("trade.executed", listener);
    }
  });

  it("should not emit trade.executed for failed trades that trigger database rollback", async () => {
    const listener = vi.fn();
    tradeEvents.on("trade.executed", listener);

    try {
      // Invalid quantity violates check constraint in SQLite
      await expect(
        OrderService.executeTrade("BTC", "BUY", -1, 60000.0)
      ).rejects.toThrow();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      tradeEvents.off("trade.executed", listener);
    }
  });

  it("should log the trade.executed event using the built-in listener", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const res = await OrderService.executeTrade("ETH", "BUY", 1, 3000.0);
      expect(res.status).toBe("EXECUTED");

      expect(consoleSpy).toHaveBeenCalledWith("[trade.executed]", {
        orderId: res.orderId,
        symbol: "ETH",
        side: "BUY",
        quantity: 1,
        price: 3000.0,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
