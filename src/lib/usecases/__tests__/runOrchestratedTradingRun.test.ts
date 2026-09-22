import { describe, it, expect, vi } from "vitest";
import {
  runOrchestratedTradingRun,
  OrchestratedRunDependencies,
} from "../runOrchestratedTradingRun";
import { createDefaultDeterministicAnalysts } from "../runParallelTradingAnalysis";
import { MarketResult } from "@/lib/agent";
import { RiskState } from "@/lib/exchange/riskService";
import { OrderResult } from "@/lib/exchange/service";

const state: RiskState = {
  cash: 100000,
  holdings: [
    { symbol: "BTC", quantity: 1 },
    { symbol: "ETH", quantity: 5 },
  ],
  prices: { BTC: 65000, ETH: 3500, SOL: 150 },
};

const approve = { verdict: "APPROVE" as const, reason: "Within exposure limits." };

type ReviewFn = NonNullable<OrchestratedRunDependencies["review"]>;

const holdMarket: MarketResult = {
  marketConditions: "RANGE_BOUND",
  externalFactors: ["Low volatility"],
  signal: "HOLD",
  confidence: 0.9,
  reason: "No directional edge; waiting for confirmation.",
};

function makeDeps(overrides: Partial<OrchestratedRunDependencies> = {}) {
  const review = vi.fn<ReviewFn>(async () => approve as unknown);
  const execute = vi.fn(async (): Promise<OrderResult> => ({ orderId: 7, status: "EXECUTED" }));
  const getState = vi.fn(async () => state);

  const deps: OrchestratedRunDependencies = {
    collaborators: createDefaultDeterministicAnalysts(),
    review,
    execute,
    getState,
    ...overrides,
  };

  return { deps, spies: { review, execute, getState } };
}

describe("runOrchestratedTradingRun (analysis -> synthesis -> guarded cycle)", () => {
  it("BUY: executes a confirmed, approved proposal through the guarded cycle", async () => {
    const { deps, spies } = makeDeps();

    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 0.5 },
      deps
    );

    expect(report.status).toBe("EXECUTED");
    expect(report.cycleOutcome).toBe("EXECUTED");
    expect(report.proposal).toEqual(
      expect.objectContaining({ action: "BUY", symbol: "BTC", quantity: 0.5 })
    );
    expect(spies.review).toHaveBeenCalledTimes(1);
    expect(spies.review.mock.calls[0][0]).toEqual(report.proposal);
    expect(spies.execute).toHaveBeenCalledWith("BTC", "BUY", 0.5);
  });

  it("SELL: executes a confirmed sell proposal when holdings are sufficient", async () => {
    const { deps, spies } = makeDeps();

    const report = await runOrchestratedTradingRun(
      { symbol: "ETH", action: "SELL", quantity: 2 },
      deps
    );

    expect(report.status).toBe("EXECUTED");
    expect(report.proposal?.action).toBe("SELL");
    expect(report.analysis.action).toBe("SELL");
    expect(spies.execute).toHaveBeenCalledWith("ETH", "SELL", 2);
  });

  it("HOLD: skips without ever invoking the trading cycle", async () => {
    const { deps, spies } = makeDeps({
      collaborators: {
        ...createDefaultDeterministicAnalysts(),
        marketAnalyst: vi.fn().mockResolvedValue(holdMarket),
      },
    });

    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 0.5 },
      deps
    );

    expect(report.status).toBe("SKIPPED");
    expect(report.proposal).toBeNull();
    expect(report.cycleOutcome).toBeNull();
    expect(report.synthesisReason).toContain("HOLD");
    expect(spies.review).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("incomplete analysis: skips when an analyst fails", async () => {
    const { deps, spies } = makeDeps({
      collaborators: {
        ...createDefaultDeterministicAnalysts(),
        riskAnalyst: vi.fn().mockRejectedValue(new Error("Risk database disconnected")),
      },
    });

    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 0.5 },
      deps
    );

    expect(report.status).toBe("SKIPPED");
    expect(report.analysis.status).toBe("INCOMPLETE");
    expect(report.proposal).toBeNull();
    expect(report.cycleOutcome).toBeNull();
    expect(report.synthesisReason).toContain("INCOMPLETE");
    expect(spies.review).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("review rejection: the proposal is synthesized but the policy gate blocks execution", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => ({ verdict: "REJECT", reason: "Too concentrated." })),
    });

    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 0.5 },
      deps
    );

    expect(report.status).toBe("SKIPPED");
    expect(report.cycleOutcome).toBe("SKIPPED");
    expect(report.proposal).not.toBeNull();
    expect(report.reason).toContain("rejected");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("hard-risk policy rejection: insufficient cash blocks execution deterministically", async () => {
    const { deps, spies } = makeDeps({
      getState: vi.fn(async () => ({ ...state, cash: 100 })),
    });

    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 0.5 },
      deps
    );

    expect(report.status).toBe("SKIPPED");
    expect(report.proposal).not.toBeNull();
    expect(report.reason).toContain("Hard risk rules failed");
    expect(spies.review).toHaveBeenCalledTimes(1);
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("analyst output never bypasses the cycle: a risk-rejected analysis is vetoed before review", async () => {
    const { deps, spies } = makeDeps();

    // 2 BTC @ $65,000 = $130,000 > mock $100k cap -> Risk Analyst REJECTED.
    const report = await runOrchestratedTradingRun(
      { symbol: "BTC", action: "BUY", quantity: 2 },
      deps
    );

    expect(report.status).toBe("SKIPPED");
    expect(report.analysis.risk?.status).toBe("REJECTED");
    expect(report.proposal).toBeNull();
    expect(spies.review).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });
});
