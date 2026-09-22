import { describe, it, expect } from "vitest";
import {
  CombinedAnalysis,
  CombinedAnalysisSchema,
  DEFAULT_MIN_CONFIDENCE,
  MarketResult,
  PortfolioResult,
  RiskResult,
  TradeProposalSchema,
  synthesizeProposal,
} from "@/lib/agent";

const market = (overrides: Partial<MarketResult> = {}): MarketResult => ({
  marketConditions: "BULLISH_TREND",
  externalFactors: ["Strong ETF inflows"],
  signal: "BUY",
  confidence: 0.85,
  reason: "Breakout confirmed above the 20-day moving average.",
  ...overrides,
});

const risk = (overrides: Partial<RiskResult> = {}): RiskResult => ({
  status: "APPROVED",
  reasons: ["Risk score within conservative thresholds."],
  riskFactors: ["Moderate intraday volatility"],
  topRisks: ["Wick liquidation on high leverage"],
  ...overrides,
});

const portfolio = (overrides: Partial<PortfolioResult> = {}): PortfolioResult => ({
  currentExposure: 15000,
  tradeAmount: 32500,
  portfolioImpact: "Increases BTC allocation within limits.",
  relevantHistory: ["Prior BTC trades executed in profit."],
  confidence: 0.88,
  reason: "Ample unallocated liquidity is available.",
  ...overrides,
});

function makeAnalysis(overrides: Partial<CombinedAnalysis> = {}): CombinedAnalysis {
  return CombinedAnalysisSchema.parse({
    status: "COMPLETE",
    executionAllowed: true,
    market: market(),
    risk: risk(),
    portfolio: portfolio(),
    failures: [],
    reasons: ["All mandatory analyses succeeded."],
    summary: "All analyses complete.",
    action: "BUY",
    ...overrides,
  });
}

const candidate = { symbol: "BTC", action: "BUY" as const, quantity: 0.5 };

describe("synthesizeProposal (pure deterministic helper)", () => {
  it("synthesizes a BUY proposal when the analysis confirms the candidate", () => {
    const result = synthesizeProposal(makeAnalysis(), candidate);

    expect(result.proposal).not.toBeNull();
    expect(result.proposal).toEqual({
      action: "BUY",
      symbol: "BTC",
      quantity: 0.5,
      confidence: 0.85,
      reason: "Breakout confirmed above the 20-day moving average.",
    });
    expect(TradeProposalSchema.safeParse(result.proposal).success).toBe(true);
    expect(result.reason).toContain("Synthesized BUY proposal for BTC");
  });

  it("synthesizes a SELL proposal when the analysis confirms the candidate", () => {
    const analysis = makeAnalysis({
      market: market({ signal: "SELL", confidence: 0.81, reason: "Rejection at resistance." }),
      action: "SELL",
    });

    const result = synthesizeProposal(analysis, {
      symbol: "ETH",
      action: "SELL",
      quantity: 2,
    });

    expect(result.proposal?.action).toBe("SELL");
    expect(result.proposal?.symbol).toBe("ETH");
    expect(result.proposal?.quantity).toBe(2);
  });

  it("vetoes a HOLD market signal", () => {
    const analysis = makeAnalysis({
      market: market({ signal: "HOLD", confidence: 0.9 }),
      executionAllowed: false,
      action: "HOLD",
    });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("HOLD");
  });

  it("vetoes an INCOMPLETE analysis", () => {
    const analysis = makeAnalysis({
      status: "INCOMPLETE",
      executionAllowed: false,
      market: null,
      action: null,
      summary: "Analysis incomplete: missing required analyst results.",
      reasons: ["Risk Analyst failed or is missing."],
    });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("INCOMPLETE");
  });

  it("vetoes an analysis that reported failures", () => {
    const analysis = makeAnalysis({
      failures: [{ analyst: "portfolio", reason: "Portfolio database disconnected." }],
    });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("portfolio: Portfolio database disconnected.");
  });

  it("vetoes when the risk analyst rejected the proposal", () => {
    const analysis = makeAnalysis({
      risk: risk({ status: "REJECTED", reasons: ["Exceeds single-order risk cap."] }),
      executionAllowed: false,
      action: null,
    });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("Risk analyst rejected the proposal");
    expect(result.reason).toContain("Exceeds single-order risk cap.");
  });

  it("vetoes when the analysis signal disagrees with the candidate action", () => {
    const analysis = makeAnalysis({
      market: market({ signal: "SELL" }),
      action: "SELL",
    });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("does not confirm the candidate action BUY");
  });

  it("vetoes confidence below the default threshold", () => {
    const analysis = makeAnalysis({ market: market({ confidence: 0.4 }) });

    const result = synthesizeProposal(analysis, candidate);

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain(`below the minimum threshold ${DEFAULT_MIN_CONFIDENCE}`);
  });

  it("respects a caller-provided minConfidence threshold", () => {
    const analysis = makeAnalysis({ market: market({ confidence: 0.75 }) });

    expect(synthesizeProposal(analysis, candidate).proposal).not.toBeNull();
    expect(synthesizeProposal(analysis, candidate, 0.8).proposal).toBeNull();
  });

  it("vetoes unsupported symbols", () => {
    const result = synthesizeProposal(makeAnalysis(), {
      symbol: "DOGE",
      action: "BUY",
      quantity: 1,
    });

    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("Unsupported symbol");
  });

  it("vetoes invalid candidate quantities", () => {
    expect(synthesizeProposal(makeAnalysis(), { ...candidate, quantity: 0 }).proposal).toBeNull();
    expect(synthesizeProposal(makeAnalysis(), { ...candidate, quantity: -1 }).proposal).toBeNull();
    expect(
      synthesizeProposal(makeAnalysis(), { ...candidate, quantity: Number.NaN }).proposal
    ).toBeNull();
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const analysis = makeAnalysis();

    const first = synthesizeProposal(analysis, candidate);
    const second = synthesizeProposal(analysis, candidate);

    expect(first).toEqual(second);
  });
});
