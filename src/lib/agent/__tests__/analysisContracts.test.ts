import { describe, it, expect } from "vitest";
import {
  MarketResultSchema,
  MarketResult,
  RiskResultSchema,
  RiskResult,
  PortfolioResultSchema,
  PortfolioResult,
  CombinedAnalysisSchema,
  CombinedAnalysis,
} from "../contracts";

describe("MarketResult Contract", () => {
  const validMarket: MarketResult = {
    marketConditions: "BULLISH_TREND",
    externalFactors: ["Fed rate cut hints", "High institutional inflows"],
    signal: "BUY",
    confidence: 0.85,
    reason: "Strong momentum breakout confirmed across multiple timeframes.",
  };

  it("accepts a valid MarketResult", () => {
    const parsed = MarketResultSchema.safeParse(validMarket);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(validMarket);
    }
  });

  it("accepts each supported signal (BUY, SELL, HOLD)", () => {
    for (const signal of ["BUY", "SELL", "HOLD"] as const) {
      const parsed = MarketResultSchema.safeParse({ ...validMarket, signal });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects invalid signals", () => {
    for (const signal of ["STRONG_BUY", "WAIT", "", "buy"]) {
      const parsed = MarketResultSchema.safeParse({ ...validMarket, signal });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(MarketResultSchema.safeParse({ ...validMarket, confidence: -0.1 }).success).toBe(false);
    expect(MarketResultSchema.safeParse({ ...validMarket, confidence: 1.05 }).success).toBe(false);
  });

  it("rejects empty marketConditions or empty reason", () => {
    expect(MarketResultSchema.safeParse({ ...validMarket, marketConditions: "" }).success).toBe(false);
    expect(MarketResultSchema.safeParse({ ...validMarket, marketConditions: "   " }).success).toBe(false);
    expect(MarketResultSchema.safeParse({ ...validMarket, reason: "" }).success).toBe(false);
    expect(MarketResultSchema.safeParse({ ...validMarket, reason: "   " }).success).toBe(false);
  });

  it("rejects unknown fields (strict contract)", () => {
    const candidate = { ...validMarket, extraField: "not allowed" };
    expect(MarketResultSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("RiskResult Contract", () => {
  const validApproved: RiskResult = {
    status: "APPROVED",
    reasons: ["Exposure within 5% limits."],
    riskFactors: ["Moderate market volatility"],
    topRisks: ["Sudden intraday dip"],
  };

  const validRejected: RiskResult = {
    status: "REJECTED",
    reasons: ["Exposure exceeds max capital threshold."],
    riskFactors: ["Extreme volatility", "High slippage"],
    topRisks: ["Capital depletion"],
  };

  it("accepts valid APPROVED and REJECTED results", () => {
    expect(RiskResultSchema.safeParse(validApproved).success).toBe(true);
    expect(RiskResultSchema.safeParse(validRejected).success).toBe(true);
  });

  it("rejects invalid status", () => {
    for (const status of ["PENDING", "HOLD", "approved", "rejected", ""]) {
      expect(RiskResultSchema.safeParse({ ...validApproved, status }).success).toBe(false);
    }
  });

  it("rejects non-array collections for reasons, riskFactors, topRisks", () => {
    expect(RiskResultSchema.safeParse({ ...validApproved, reasons: "a string" }).success).toBe(false);
    expect(RiskResultSchema.safeParse({ ...validApproved, riskFactors: null }).success).toBe(false);
    expect(RiskResultSchema.safeParse({ ...validApproved, topRisks: 42 }).success).toBe(false);
  });

  it("rejects unknown fields (strict contract)", () => {
    const candidate = { ...validApproved, score: 95 };
    expect(RiskResultSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("PortfolioResult Contract", () => {
  const validPortfolio: PortfolioResult = {
    currentExposure: 15000,
    tradeAmount: 2500,
    portfolioImpact: "Increases BTC allocation from 15% to 17.5%.",
    relevantHistory: ["Executed 2 prior BTC buys in profit."],
    confidence: 0.9,
    reason: "Sufficient liquidity available and allocation within targets.",
  };

  it("accepts a valid PortfolioResult", () => {
    const parsed = PortfolioResultSchema.safeParse(validPortfolio);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(validPortfolio);
    }
  });

  it("rejects negative tradeAmount", () => {
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, tradeAmount: -100 }).success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, confidence: -0.01 }).success).toBe(false);
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, confidence: 1.1 }).success).toBe(false);
  });

  it("rejects empty portfolioImpact or reason", () => {
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, portfolioImpact: "  " }).success).toBe(false);
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, reason: "" }).success).toBe(false);
  });

  it("rejects non-array relevantHistory", () => {
    expect(PortfolioResultSchema.safeParse({ ...validPortfolio, relevantHistory: "some history" }).success).toBe(false);
  });

  it("rejects unknown fields (strict contract)", () => {
    const candidate = { ...validPortfolio, unneededField: true };
    expect(PortfolioResultSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("CombinedAnalysis Contract", () => {
  const validMarket: MarketResult = {
    marketConditions: "BULLISH",
    externalFactors: ["Positive ETF inflows"],
    signal: "BUY",
    confidence: 0.8,
    reason: "Breakout",
  };

  const validRisk: RiskResult = {
    status: "APPROVED",
    reasons: ["Risk is acceptable"],
    riskFactors: ["Volatility"],
    topRisks: ["Flash crash"],
  };

  const validPortfolio: PortfolioResult = {
    currentExposure: 10000,
    tradeAmount: 1000,
    portfolioImpact: "Minor risk increase",
    relevantHistory: ["Recent profitable trades"],
    confidence: 0.85,
    reason: "Well-balanced",
  };

  it("accepts a valid COMPLETE CombinedAnalysis", () => {
    const complete: CombinedAnalysis = {
      status: "COMPLETE",
      executionAllowed: true,
      market: validMarket,
      risk: validRisk,
      portfolio: validPortfolio,
      failures: [],
      reasons: ["All analyses approved."],
      summary: "Execution allowed.",
      action: "BUY",
    };

    const parsed = CombinedAnalysisSchema.safeParse(complete);
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid INCOMPLETE CombinedAnalysis with null analysts and failures", () => {
    const incomplete: CombinedAnalysis = {
      status: "INCOMPLETE",
      executionAllowed: false,
      market: null,
      risk: validRisk,
      portfolio: validPortfolio,
      failures: [{ analyst: "market", reason: "Market service unreachable" }],
      reasons: ["Market Analyst failed or is missing."],
      summary: "Analysis incomplete.",
      action: null,
    };

    const parsed = CombinedAnalysisSchema.safeParse(incomplete);
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown fields (strict contract)", () => {
    const candidate = {
      status: "COMPLETE",
      executionAllowed: true,
      market: validMarket,
      risk: validRisk,
      portfolio: validPortfolio,
      failures: [],
      reasons: [],
      action: "BUY",
      bypassSecurity: true,
    };

    expect(CombinedAnalysisSchema.safeParse(candidate).success).toBe(false);
  });
});
