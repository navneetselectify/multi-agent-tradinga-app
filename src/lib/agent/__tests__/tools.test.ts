import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetPortfolioAndMarketStateTool } from "../tools/getPortfolioAndMarketState";
import { AdvanceMarketTickTool } from "../tools/advanceMarketTick";
import { ExecuteAssetTradeTool } from "../tools/executeAssetTrade";

// Mock the core use cases
vi.mock("@/lib/usecases", () => {
  return {
    getDashboardData: vi.fn(),
    triggerTick: vi.fn(),
    executeTrade: vi.fn(),
  };
});

import { getDashboardData, triggerTick, executeTrade } from "@/lib/usecases";

describe("Agent Tool Suite Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get_portfolio_and_market_state", () => {
    const tool = new GetPortfolioAndMarketStateTool();

    it("should return portfolio and market data when executed with empty arguments", async () => {
      const mockDashboardData = {
        cash: 100000.0,
        holdingsValue: 0,
        netAssetValue: 100000.0,
        holdings: [],
        orders: [],
        prices: { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 },
      };
      vi.mocked(getDashboardData).mockResolvedValueOnce(mockDashboardData);

      const res = await tool.execute({});

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockDashboardData);
      expect(getDashboardData).toHaveBeenCalledTimes(1);
    });

    it("should reject invalid arguments with a VALIDATION_ERROR (strict schema)", async () => {
      const res = await tool.execute({ extraArg: "unsupported" });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
      expect(res.error?.message).toContain("Input validation failed");
    });

    it("should format unexpected use-case throws as BUSINESS_RULE_VIOLATION errors", async () => {
      vi.mocked(getDashboardData).mockRejectedValueOnce(new Error("Database disconnected"));

      const res = await tool.execute({});

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(res.error?.message).toBe("Database disconnected");
    });
  });

  describe("advance_market_tick", () => {
    const tool = new AdvanceMarketTickTool();

    it("should advance market tick when given a valid reason", async () => {
      const mockNextPrices = { BTC: 60500.0, ETH: 3010.0, SOL: 152.0 };
      vi.mocked(triggerTick).mockResolvedValueOnce(mockNextPrices);

      const res = await tool.execute({ reason: "Market consolidation analysis" });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockNextPrices);
      expect(triggerTick).toHaveBeenCalledTimes(1);
    });

    it("should reject empty or extremely short reason with a VALIDATION_ERROR", async () => {
      const res = await tool.execute({ reason: "no" }); // Less than 5 characters

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
      expect(res.error?.details?.[0]).toContain("reason");
    });

    it("should format unexpected use-case throws as BUSINESS_RULE_VIOLATION errors", async () => {
      vi.mocked(triggerTick).mockRejectedValueOnce(new Error("Tick recording crash"));

      const res = await tool.execute({ reason: "Market consolidation analysis" });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(res.error?.message).toBe("Tick recording crash");
    });
  });

  describe("execute_asset_trade", () => {
    const tool = new ExecuteAssetTradeTool();

    it("should successfully execute a valid trade BUY order", async () => {
      const mockOrderResult = { orderId: 42, status: "EXECUTED" as const };
      vi.mocked(executeTrade).mockResolvedValueOnce(mockOrderResult);

      const res = await tool.execute({
        symbol: "BTC",
        side: "BUY",
        quantity: 1.5,
        reason: "Bitcoin breaking dynamic overhead support zone.",
        confidence: 0.95,
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockOrderResult);
      expect(executeTrade).toHaveBeenCalledWith("BTC", "BUY", 1.5);
    });

    it("should support both BUY and SELL on supported symbols (SOL, ETH, BTC)", async () => {
      const mockOrderResult = { orderId: 43, status: "EXECUTED" as const };
      vi.mocked(executeTrade).mockResolvedValueOnce(mockOrderResult);

      const res = await tool.execute({
        symbol: "SOL",
        side: "SELL",
        quantity: 10,
        reason: "Solana hitting major horizontal supply target.",
        confidence: 0.8,
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockOrderResult);
    });

    it("should fail validation if symbol is unsupported", async () => {
      const res = await tool.execute({
        symbol: "DOGE", // Invalid
        side: "BUY",
        quantity: 5,
        reason: "Testing invalid symbol validation.",
        confidence: 0.7,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
      expect(res.error?.details?.[0]).toContain("Symbol must be one of: BTC, ETH, SOL");
    });

    it("should fail validation if side is unsupported", async () => {
      const res = await tool.execute({
        symbol: "ETH",
        side: "SHORT", // Invalid side
        quantity: 2,
        reason: "Testing invalid side validation.",
        confidence: 0.7,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
      expect(res.error?.details?.[0]).toContain("Side must be one of: BUY, SELL");
    });

    it("should fail validation if quantity is non-positive", async () => {
      const res = await tool.execute({
        symbol: "BTC",
        side: "BUY",
        quantity: -1, // Negative quantity
        reason: "Testing invalid quantity validation.",
        confidence: 0.9,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should fail validation if reason is too short", async () => {
      const res = await tool.execute({
        symbol: "BTC",
        side: "BUY",
        quantity: 0.1,
        reason: "Too short", // Less than 10 characters
        confidence: 0.9,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should fail validation if confidence is out of bounds", async () => {
      const res = await tool.execute({
        symbol: "BTC",
        side: "BUY",
        quantity: 0.1,
        reason: "Valid reason for audit purposes.",
        confidence: 1.1, // Out of bounds (> 1.0)
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should format unexpected use-case throws as BUSINESS_RULE_VIOLATION errors", async () => {
      vi.mocked(executeTrade).mockRejectedValueOnce(new Error("Insufficient funds validation bypass"));

      const res = await tool.execute({
        symbol: "BTC",
        side: "BUY",
        quantity: 5.0,
        reason: "Wants to buy large amount of BTC.",
        confidence: 0.85,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(res.error?.message).toBe("Insufficient funds validation bypass");
    });
  });
});
