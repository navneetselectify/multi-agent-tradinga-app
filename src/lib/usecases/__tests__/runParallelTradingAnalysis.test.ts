import { describe, it, expect, vi } from "vitest";
import {
  runParallelTradingAnalysis,
  createDefaultDeterministicAnalysts,
} from "../runParallelTradingAnalysis";
import { AnalysisCollaborators, MarketResult } from "@/lib/agent";

describe("runParallelTradingAnalysis Use Case", () => {
  it("runs default deterministic analysts and returns COMPLETE CombinedAnalysis", async () => {
    const result = await runParallelTradingAnalysis({
      symbol: "BTC",
      action: "BUY",
      quantity: 0.5,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
    expect(result.action).toBe("BUY");
    expect(result.market).toBeDefined();
    expect(result.market?.signal).toBe("BUY");
    expect(result.risk).toBeDefined();
    expect(result.risk?.status).toBe("APPROVED");
    expect(result.portfolio).toBeDefined();
    expect(result.failures).toEqual([]);
    expect(result).not.toHaveProperty("orderId");
  });

  it("supports injected collaborators", async () => {
    const customMarket: MarketResult = {
      marketConditions: "BEARISH_DIVERGENCE",
      externalFactors: ["Macro tightening"],
      signal: "SELL",
      confidence: 0.75,
      reason: "Resistance rejected at 200 EMA.",
    };

    const collaborators: AnalysisCollaborators = {
      ...createDefaultDeterministicAnalysts(),
      marketAnalyst: vi.fn().mockResolvedValue(customMarket),
    };

    const result = await runParallelTradingAnalysis(
      { symbol: "ETH" },
      { collaborators }
    );

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
    expect(result.action).toBe("SELL");
    expect(result.market).toEqual(customMarket);
  });

  it("enforces configured timeouts and marks INCOMPLETE when an analyst exceeds deadline", async () => {
    const collaborators: AnalysisCollaborators = {
      ...createDefaultDeterministicAnalysts(),
      marketAnalyst: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          marketConditions: "BULLISH",
          externalFactors: [],
          signal: "BUY",
          confidence: 0.8,
          reason: "Slow feed",
        };
      },
    };

    const result = await runParallelTradingAnalysis(
      {
        symbol: "SOL",
        timeouts: { marketMs: 25 },
      },
      { collaborators }
    );

    expect(result.status).toBe("INCOMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.market).toBeNull();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].analyst).toBe("market");
    expect(result.failures[0].reason).toContain("timed out after 25ms");
    expect(result.risk).not.toBeNull();
    expect(result.portfolio).not.toBeNull();
  });

  it("handles thrown analyst errors safely without throwing unhandled exceptions", async () => {
    const collaborators: AnalysisCollaborators = {
      ...createDefaultDeterministicAnalysts(),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk database disconnected")),
    };

    const result = await runParallelTradingAnalysis({}, { collaborators });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.risk).toBeNull();
    expect(result.failures[0]).toEqual({
      analyst: "risk",
      reason: "Risk database disconnected",
    });
  });

  it("respects SELL action across default deterministic analysts", async () => {
    const result = await runParallelTradingAnalysis({
      symbol: "ETH",
      action: "SELL",
      quantity: 2,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
    expect(result.action).toBe("SELL");
    expect(result.market?.signal).toBe("SELL");
    expect(result.market?.marketConditions).toBe("BEARISH_REVERSAL");
    expect(result.portfolio?.portfolioImpact).toContain("Reduces ETH exposure");
  });

  it("rejects trades exceeding the mock $100k risk cap", async () => {
    // 2 BTC @ $65,000 = $130,000 > $100,000 cap
    const result = await runParallelTradingAnalysis({
      symbol: "BTC",
      action: "BUY",
      quantity: 2.0,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.action).toBeNull();
    expect(result.risk?.status).toBe("REJECTED");
    expect(result.risk?.reasons[0]).toContain("exceeds mock single-order risk cap");
  });

  it("triggers timeout when mock latency exceeds configured timeout", async () => {
    const result = await runParallelTradingAnalysis({
      symbol: "BTC",
      timeouts: { marketMs: 25 },
      delays: { marketMs: 100 },
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.market).toBeNull();
    expect(result.failures[0].analyst).toBe("market");
    expect(result.failures[0].reason).toContain("timed out after 25ms");
  });
});
