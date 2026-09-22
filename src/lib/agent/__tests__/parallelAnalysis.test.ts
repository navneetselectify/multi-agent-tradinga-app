import { describe, it, expect, vi } from "vitest";
import {
  executeParallelAnalysis,
  runParallelAnalysis,
  AnalysisCollaborators,
  AnalysisRequest,
} from "../parallelAnalysis";
import { aggregateAnalysis, AnalysisAggregator } from "../aggregator";
import { MarketResult, RiskResult, PortfolioResult } from "../contracts";

describe("Epic 4 — Parallel Agent Execution (Fan-Out / Fan-In / Aggregator)", () => {
  const sampleRequest: AnalysisRequest = {
    symbol: "BTC",
    action: "BUY",
    quantity: 0.5,
  };

  const mockMarketSuccess: MarketResult = {
    marketConditions: "STRONG_BULLISH",
    externalFactors: ["Spot ETF inflow acceleration", "Macro rate cut expected"],
    signal: "BUY",
    confidence: 0.88,
    reason: "Clear breakout above key 200 EMA with expanding volume.",
  };

  const mockRiskApproved: RiskResult = {
    status: "APPROVED",
    reasons: ["Total risk exposure is within conservative 2% portfolio limits."],
    riskFactors: ["Moderate intraday volatility"],
    topRisks: ["Wick liquidation on high leverage"],
  };

  const mockRiskRejected: RiskResult = {
    status: "REJECTED",
    reasons: ["Proposed trade exceeds single-asset concentration threshold."],
    riskFactors: ["Extreme concentration", "Low liquidity depth"],
    topRisks: ["Severe drawdown potential"],
  };

  const mockPortfolioSuccess: PortfolioResult = {
    currentExposure: 12500,
    tradeAmount: 30000,
    portfolioImpact: "Increases BTC exposure from 12.5% to 42.5%.",
    relevantHistory: ["3 consecutive profitable swing trades on BTC."],
    confidence: 0.82,
    reason: "Sufficient unallocated cash reserve and favorable portfolio Sharpe ratio.",
  };

  function createSuccessfulCollaborators(): AnalysisCollaborators {
    return {
      marketAnalyst: vi.fn().mockResolvedValue(mockMarketSuccess),
      riskAnalyst: vi.fn().mockResolvedValue(mockRiskApproved),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };
  }

  // 1. All three succeed
  it("all three succeed: collects results, marks COMPLETE, and allows execution", async () => {
    const collaborators = createSuccessfulCollaborators();

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toEqual(mockMarketSuccess);
    expect(fanIn.risk).toEqual(mockRiskApproved);
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
    expect(fanIn.failures).toEqual([]);
    expect(fanIn.settled.market.status).toBe("fulfilled");
    expect(fanIn.settled.risk.status).toBe("fulfilled");
    expect(fanIn.settled.portfolio.status).toBe("fulfilled");

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("COMPLETE");
    expect(combined.executionAllowed).toBe(true);
    expect(combined.action).toBe("BUY");
    expect(combined.market).toEqual(mockMarketSuccess);
    expect(combined.risk).toEqual(mockRiskApproved);
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    expect(combined.failures).toEqual([]);
    expect(combined.reasons.some((r) => r.includes("approved"))).toBe(true);
  });

  // 2. Market fails
  it("Market fails: preserves Risk and Portfolio results, marks INCOMPLETE, and blocks execution", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockRejectedValue(new Error("Market data provider timeout")),
      riskAnalyst: vi.fn().mockResolvedValue(mockRiskApproved),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toBeNull();
    expect(fanIn.risk).toEqual(mockRiskApproved);
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
    expect(fanIn.failures).toHaveLength(1);
    expect(fanIn.failures[0]).toEqual({
      analyst: "market",
      reason: "Market data provider timeout",
    });

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBeNull();
    expect(combined.market).toBeNull();
    expect(combined.risk).toEqual(mockRiskApproved);
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    expect(combined.failures).toHaveLength(1);
    expect(combined.failures[0].analyst).toBe("market");
    expect(combined.reasons.some((r) => r.includes("Market Analyst failed"))).toBe(true);
  });

  // 3. Risk fails
  it("Risk fails: preserves Market and Portfolio results, marks INCOMPLETE, and sets executionAllowed = false", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockResolvedValue(mockMarketSuccess),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk model calculation overflow")),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toEqual(mockMarketSuccess);
    expect(fanIn.risk).toBeNull();
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
    expect(fanIn.failures).toHaveLength(1);
    expect(fanIn.failures[0]).toEqual({
      analyst: "risk",
      reason: "Risk model calculation overflow",
    });

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBeNull();
    expect(combined.market).toEqual(mockMarketSuccess);
    expect(combined.risk).toBeNull();
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    expect(combined.failures[0].analyst).toBe("risk");
    expect(combined.reasons.some((r) => r.includes("Risk Analyst failed"))).toBe(true);
  });

  // 4. Portfolio fails
  it("Portfolio fails: preserves Market and Risk results, marks INCOMPLETE, and blocks execution", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockResolvedValue(mockMarketSuccess),
      riskAnalyst: vi.fn().mockResolvedValue(mockRiskApproved),
      portfolioAnalyst: vi.fn().mockRejectedValue(new Error("Database connection dropped")),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toEqual(mockMarketSuccess);
    expect(fanIn.risk).toEqual(mockRiskApproved);
    expect(fanIn.portfolio).toBeNull();
    expect(fanIn.failures).toHaveLength(1);
    expect(fanIn.failures[0]).toEqual({
      analyst: "portfolio",
      reason: "Database connection dropped",
    });

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBeNull();
    expect(combined.market).toEqual(mockMarketSuccess);
    expect(combined.risk).toEqual(mockRiskApproved);
    expect(combined.portfolio).toBeNull();
    expect(combined.failures[0].analyst).toBe("portfolio");
    expect(combined.reasons.some((r) => r.includes("Portfolio Analyst failed"))).toBe(true);
  });

  // 5. Multiple agents fail
  it("multiple agents fail: preserves all failure details and successful results", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockRejectedValue(new Error("Market network failure")),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk timeout")),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toBeNull();
    expect(fanIn.risk).toBeNull();
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
    expect(fanIn.failures).toHaveLength(2);
    expect(fanIn.failures).toEqual([
      { analyst: "market", reason: "Market network failure" },
      { analyst: "risk", reason: "Risk timeout" },
    ]);

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.market).toBeNull();
    expect(combined.risk).toBeNull();
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    expect(combined.failures).toHaveLength(2);
    expect(combined.reasons.some((r) => r.includes("Risk Analyst failed"))).toBe(true);
    expect(combined.reasons.some((r) => r.includes("Market Analyst failed"))).toBe(true);
  });

  // All three fail
  it("all three agents fail: preserves all 3 failures and blocks execution", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockRejectedValue(new Error("Market fail")),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk fail")),
      portfolioAnalyst: vi.fn().mockRejectedValue(new Error("Portfolio fail")),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toBeNull();
    expect(fanIn.risk).toBeNull();
    expect(fanIn.portfolio).toBeNull();
    expect(fanIn.failures).toHaveLength(3);

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.failures).toHaveLength(3);
  });

  // 6. Successful results are preserved when another fails
  it("successful results are preserved when another fails", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockResolvedValue(mockMarketSuccess),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk service unavailable")),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    // Verify fanIn preserves results from successful analysts
    expect(fanIn.market).toEqual(mockMarketSuccess);
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);

    const combined = aggregateAnalysis(fanIn);

    // Verify CombinedAnalysis preserves results from successful analysts
    expect(combined.market).toEqual(mockMarketSuccess);
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    expect(combined.risk).toBeNull();
  });

  // 7. Final decision is blocked when mandatory analysis is missing
  it("final decision is blocked when mandatory analysis is missing", async () => {
    // Missing Portfolio
    const fanInMissingPortfolio = {
      market: mockMarketSuccess,
      risk: mockRiskApproved,
      portfolio: null,
      failures: [{ analyst: "portfolio" as const, reason: "Unresponsive agent" }],
      settled: {
        market: { status: "fulfilled" as const, value: mockMarketSuccess },
        risk: { status: "fulfilled" as const, value: mockRiskApproved },
        portfolio: { status: "rejected" as const, reason: new Error("Unresponsive agent") },
      },
    };

    const combined = aggregateAnalysis(fanInMissingPortfolio);

    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBeNull();
    expect(
      combined.reasons.some((r) =>
        r.includes("Final trading decision is blocked: all three analyses (Market, Risk, Portfolio) are mandatory")
      )
    ).toBe(true);
  });

  // 8. Aggregator receives all settled results
  it("aggregator receives all settled results via FanInResults", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockResolvedValue(mockMarketSuccess),
      riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk rate limit exceeded")),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    // Inspect the settled property received from Promise.allSettled
    expect(fanIn.settled).toBeDefined();
    expect(fanIn.settled.market.status).toBe("fulfilled");
    if (fanIn.settled.market.status === "fulfilled") {
      expect(fanIn.settled.market.value).toEqual(mockMarketSuccess);
    }
    expect(fanIn.settled.risk.status).toBe("rejected");
    if (fanIn.settled.risk.status === "rejected") {
      expect(fanIn.settled.risk.reason).toBeInstanceOf(Error);
      expect((fanIn.settled.risk.reason as Error).message).toBe("Risk rate limit exceeded");
    }
    expect(fanIn.settled.portfolio.status).toBe("fulfilled");
    if (fanIn.settled.portfolio.status === "fulfilled") {
      expect(fanIn.settled.portfolio.value).toEqual(mockPortfolioSuccess);
    }

    const spy = vi.spyOn(AnalysisAggregator, "aggregate");
    const combined = aggregateAnalysis(fanIn);

    expect(spy).toHaveBeenCalledWith(fanIn);
    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.failures[0]).toEqual({
      analyst: "risk",
      reason: "Risk rate limit exceeded",
    });
    spy.mockRestore();
  });

  // 9. Aggregator must NOT execute trades
  it("Aggregator must NOT execute trades and operates purely as a data combiner", async () => {
    const collaborators = createSuccessfulCollaborators();
    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);
    const combined = aggregateAnalysis(fanIn);

    // CombinedAnalysis is data only: no orders are placed
    expect(combined).not.toHaveProperty("orderId");
    expect(combined).not.toHaveProperty("orderStatus");
    expect(combined.executionAllowed).toBe(true);
  });

  // 10. When all three succeed but Risk rejects trade
  it("when all three succeed but Risk Analyst rejects, status is COMPLETE but executionAllowed is false", () => {
    const fanIn = {
      market: mockMarketSuccess,
      risk: mockRiskRejected,
      portfolio: mockPortfolioSuccess,
      failures: [],
      settled: {
        market: { status: "fulfilled" as const, value: mockMarketSuccess },
        risk: { status: "fulfilled" as const, value: mockRiskRejected },
        portfolio: { status: "fulfilled" as const, value: mockPortfolioSuccess },
      },
    };

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("COMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBeNull();
    expect(combined.reasons.some((r) => r.includes("Risk Analyst rejected"))).toBe(true);
  });

  // 11. When all three succeed but Market signal is HOLD
  it("when all three succeed but Market signal is HOLD, executionAllowed is false and action is HOLD", () => {
    const marketHold: MarketResult = {
      ...mockMarketSuccess,
      signal: "HOLD",
      reason: "Consolidation phase with no clear trend.",
    };

    const fanIn = {
      market: marketHold,
      risk: mockRiskApproved,
      portfolio: mockPortfolioSuccess,
      failures: [],
      settled: {
        market: { status: "fulfilled" as const, value: marketHold },
        risk: { status: "fulfilled" as const, value: mockRiskApproved },
        portfolio: { status: "fulfilled" as const, value: mockPortfolioSuccess },
      },
    };

    const combined = aggregateAnalysis(fanIn);

    expect(combined.status).toBe("COMPLETE");
    expect(combined.executionAllowed).toBe(false);
    expect(combined.action).toBe("HOLD");
    expect(combined.reasons.some((r) => r.includes("Market signal is HOLD"))).toBe(true);
  });

  // 12. Contract schema violation in analyst output is handled as failure
  it("treats schema-invalid analyst output as a failure and preserves error reason", async () => {
    const invalidMarketOutput = {
      marketConditions: "BULLISH",
      // missing externalFactors, signal, confidence, reason
    };

    const collaborators: AnalysisCollaborators = {
      marketAnalyst: vi.fn().mockResolvedValue(invalidMarketOutput as unknown as MarketResult),
      riskAnalyst: vi.fn().mockResolvedValue(mockRiskApproved),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toBeNull();
    expect(fanIn.failures).toHaveLength(1);
    expect(fanIn.failures[0].analyst).toBe("market");
    expect(fanIn.failures[0].reason).toContain("Market analyst output failed contract validation");

    const combined = aggregateAnalysis(fanIn);
    expect(combined.status).toBe("INCOMPLETE");
    expect(combined.executionAllowed).toBe(false);
  });

  // 13. Synchronous exception in analyst function is safely caught by Promise.allSettled
  it("safely catches synchronous exceptions in analyst functions without throwing unhandled errors", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: () => {
        throw new Error("Synchronous crash in market analyst");
      },
      riskAnalyst: vi.fn().mockResolvedValue(mockRiskApproved),
      portfolioAnalyst: vi.fn().mockResolvedValue(mockPortfolioSuccess),
    };

    const fanIn = await executeParallelAnalysis(sampleRequest, collaborators);

    expect(fanIn.market).toBeNull();
    expect(fanIn.failures).toHaveLength(1);
    expect(fanIn.failures[0]).toEqual({
      analyst: "market",
      reason: "Synchronous crash in market analyst",
    });
    expect(fanIn.risk).toEqual(mockRiskApproved);
    expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
  });

  // 14. Supports object-based analyst interfaces with analyze() method
  it("supports injected analysts implementing an object interface with analyze() method", async () => {
    const collaborators: AnalysisCollaborators = {
      marketAnalyst: {
        analyze: vi.fn().mockResolvedValue(mockMarketSuccess),
      },
      riskAnalyst: {
        analyze: vi.fn().mockResolvedValue(mockRiskApproved),
      },
      portfolioAnalyst: {
        analyze: vi.fn().mockResolvedValue(mockPortfolioSuccess),
      },
    };

    const combined = await runParallelAnalysis(sampleRequest, collaborators);

    expect(combined.status).toBe("COMPLETE");
    expect(combined.executionAllowed).toBe(true);
    expect(combined.market).toEqual(mockMarketSuccess);
    expect(combined.risk).toEqual(mockRiskApproved);
    expect(combined.portfolio).toEqual(mockPortfolioSuccess);
  });

  describe("Epic 4.5 — Configurable Per-Analyst Timeouts", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // 1. All analysts succeed before timeout
    it("all analysts succeed before timeout: produces COMPLETE and executionAllowed = true", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(10);
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          await sleep(10);
          return mockRiskApproved;
        },
        portfolioAnalyst: async () => {
          await sleep(10);
          return mockPortfolioSuccess;
        },
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { marketMs: 100, riskMs: 100, portfolioMs: 100 },
      });

      expect(fanIn.market).toEqual(mockMarketSuccess);
      expect(fanIn.risk).toEqual(mockRiskApproved);
      expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
      expect(fanIn.failures).toEqual([]);

      const combined = aggregateAnalysis(fanIn);
      expect(combined.status).toBe("COMPLETE");
      expect(combined.executionAllowed).toBe(true);
    });

    // 2. One analyst throws while others succeed
    it("one analyst throws: captures error in failures and preserves other successful results", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(10);
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          throw new Error("Risk service calculation threw fatal error");
        },
        portfolioAnalyst: async () => {
          await sleep(10);
          return mockPortfolioSuccess;
        },
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { marketMs: 100, riskMs: 100, portfolioMs: 100 },
      });

      expect(fanIn.market).toEqual(mockMarketSuccess);
      expect(fanIn.risk).toBeNull();
      expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
      expect(fanIn.failures).toHaveLength(1);
      expect(fanIn.failures[0]).toEqual({
        analyst: "risk",
        reason: "Risk service calculation threw fatal error",
      });

      const combined = aggregateAnalysis(fanIn);
      expect(combined.status).toBe("INCOMPLETE");
      expect(combined.executionAllowed).toBe(false);
    });

    // 3. One analyst times out
    it("one analyst times out: records structured timeout failure and does not wait indefinitely", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(150); // exceeds 30ms timeout
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          await sleep(10);
          return mockRiskApproved;
        },
        portfolioAnalyst: async () => {
          await sleep(10);
          return mockPortfolioSuccess;
        },
      };

      const startTime = Date.now();
      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { marketMs: 30, riskMs: 200, portfolioMs: 200 },
      });
      const elapsed = Date.now() - startTime;

      // Elapsed should be well under the 150ms delay of marketAnalyst
      expect(elapsed).toBeLessThan(120);

      expect(fanIn.market).toBeNull();
      expect(fanIn.risk).toEqual(mockRiskApproved);
      expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
      expect(fanIn.failures).toHaveLength(1);
      expect(fanIn.failures[0].analyst).toBe("market");
      expect(fanIn.failures[0].reason).toContain("Market Analyst analysis timed out after 30ms.");

      const combined = aggregateAnalysis(fanIn);
      expect(combined.status).toBe("INCOMPLETE");
      expect(combined.executionAllowed).toBe(false);
    });

    // 4. Multiple analysts fail/timeout
    it("multiple analysts fail/timeout: captures both timeout and thrown failures", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(150); // times out
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          throw new Error("Risk model computation crashed"); // throws
        },
        portfolioAnalyst: async () => {
          await sleep(10);
          return mockPortfolioSuccess;
        },
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { marketMs: 30, portfolioMs: 200 },
      });

      expect(fanIn.market).toBeNull();
      expect(fanIn.risk).toBeNull();
      expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);
      expect(fanIn.failures).toHaveLength(2);

      const marketFailure = fanIn.failures.find((f) => f.analyst === "market");
      const riskFailure = fanIn.failures.find((f) => f.analyst === "risk");

      expect(marketFailure?.reason).toContain("Market Analyst analysis timed out after 30ms.");
      expect(riskFailure?.reason).toBe("Risk model computation crashed");

      const combined = aggregateAnalysis(fanIn);
      expect(combined.status).toBe("INCOMPLETE");
      expect(combined.executionAllowed).toBe(false);
      expect(combined.portfolio).toEqual(mockPortfolioSuccess);
    });

    // 5. Successful results remain preserved when another times out
    it("successful results remain preserved when another times out", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(10);
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          await sleep(150); // times out
          return mockRiskApproved;
        },
        portfolioAnalyst: async () => {
          await sleep(10);
          return mockPortfolioSuccess;
        },
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { riskMs: 25 },
      });

      expect(fanIn.risk).toBeNull();
      expect(fanIn.market).toEqual(mockMarketSuccess);
      expect(fanIn.portfolio).toEqual(mockPortfolioSuccess);

      const combined = aggregateAnalysis(fanIn);
      expect(combined.market).toEqual(mockMarketSuccess);
      expect(combined.portfolio).toEqual(mockPortfolioSuccess);
      expect(combined.risk).toBeNull();
    });

    // 6. Timeout failure identifies the correct analyst
    it("timeout failure identifies the correct analyst", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(10);
          return mockMarketSuccess;
        },
        riskAnalyst: async () => {
          await sleep(10);
          return mockRiskApproved;
        },
        portfolioAnalyst: async () => {
          await sleep(150); // times out
          return mockPortfolioSuccess;
        },
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { portfolioMs: 25 },
      });

      expect(fanIn.failures).toHaveLength(1);
      expect(fanIn.failures[0].analyst).toBe("portfolio");
      expect(fanIn.failures[0].reason).toBe("Portfolio Analyst analysis timed out after 25ms.");
      expect(fanIn.market).toEqual(mockMarketSuccess);
      expect(fanIn.risk).toEqual(mockRiskApproved);
      expect(fanIn.portfolio).toBeNull();
    });

    // 7. Aggregator still blocks execution when a mandatory analysis is unavailable
    it("aggregator still blocks execution when a mandatory analysis is unavailable due to timeout", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(120); // times out
          return mockMarketSuccess;
        },
        riskAnalyst: async () => mockRiskApproved,
        portfolioAnalyst: async () => mockPortfolioSuccess,
      };

      const combined = await runParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { marketMs: 25 },
      });

      expect(combined.status).toBe("INCOMPLETE");
      expect(combined.executionAllowed).toBe(false);
      expect(combined.action).toBeNull();
      expect(
        combined.reasons.some((r) =>
          r.includes("Final trading decision is blocked: all three analyses (Market, Risk, Portfolio) are mandatory.")
        )
      ).toBe(true);
      expect(combined.failures[0].analyst).toBe("market");
      expect(combined.failures[0].reason).toContain("timed out after 25ms");
    });

    // 8. defaultTimeoutMs fallback applies to unconfigured analysts
    it("uses defaultTimeoutMs when specific analyst timeout is not provided", async () => {
      const collaborators: AnalysisCollaborators = {
        marketAnalyst: async () => {
          await sleep(80); // times out under default 25ms
          return mockMarketSuccess;
        },
        riskAnalyst: async () => mockRiskApproved,
        portfolioAnalyst: async () => mockPortfolioSuccess,
      };

      const fanIn = await executeParallelAnalysis(sampleRequest, collaborators, {
        timeouts: { defaultTimeoutMs: 25 },
      });

      expect(fanIn.failures).toHaveLength(1);
      expect(fanIn.failures[0].analyst).toBe("market");
      expect(fanIn.failures[0].reason).toBe("Market Analyst analysis timed out after 25ms.");
    });
  });
});
