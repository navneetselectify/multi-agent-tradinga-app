import { describe, it, expect } from "vitest";
import { TradeProposalSchema, RiskVerdictSchema } from "../contracts";

describe("TradeProposal handoff contract", () => {
  const validProposal = {
    action: "BUY",
    symbol: "BTC",
    quantity: 0.5,
    confidence: 0.8,
    reason: "Momentum breakout above recent resistance.",
  };

  it("should accept a valid TradeProposal", () => {
    const result = TradeProposalSchema.safeParse(validProposal);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validProposal);
    }
  });

  it("should accept a SELL proposal for every supported symbol", () => {
    for (const symbol of ["BTC", "ETH", "SOL"] as const) {
      const result = TradeProposalSchema.safeParse({
        ...validProposal,
        action: "SELL",
        symbol,
      });
      expect(result.success).toBe(true);
    }
  });

  it("should reject HOLD because the proposal contract only carries actionable trades", () => {
    const result = TradeProposalSchema.safeParse({ ...validProposal, action: "HOLD" });

    expect(result.success).toBe(false);
  });

  it("should reject an unsupported symbol", () => {
    const result = TradeProposalSchema.safeParse({ ...validProposal, symbol: "DOGE" });

    expect(result.success).toBe(false);
  });

  it("should reject a non-positive quantity", () => {
    expect(TradeProposalSchema.safeParse({ ...validProposal, quantity: 0 }).success).toBe(false);
    expect(TradeProposalSchema.safeParse({ ...validProposal, quantity: -1 }).success).toBe(false);
  });

  it("should reject confidence outside [0, 1]", () => {
    expect(TradeProposalSchema.safeParse({ ...validProposal, confidence: -0.1 }).success).toBe(false);
    expect(TradeProposalSchema.safeParse({ ...validProposal, confidence: 1.1 }).success).toBe(false);
  });

  it("should reject an empty, whitespace-only, or non-string reason", () => {
    expect(TradeProposalSchema.safeParse({ ...validProposal, reason: "" }).success).toBe(false);
    expect(TradeProposalSchema.safeParse({ ...validProposal, reason: "   " }).success).toBe(false);
    expect(TradeProposalSchema.safeParse({ ...validProposal, reason: 42 }).success).toBe(false);
  });

  it("should reject missing required fields", () => {
    for (const field of ["action", "symbol", "quantity", "confidence", "reason"] as const) {
      const candidate: Record<string, unknown> = { ...validProposal };
      delete candidate[field];
      expect(TradeProposalSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("should reject unknown fields (strict contract)", () => {
    const result = TradeProposalSchema.safeParse({
      ...validProposal,
      targetPrice: 65000,
      executeNow: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("RiskVerdict handoff contract", () => {
  it("should accept APPROVE with a reason", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "APPROVE",
      reason: "Position size is within exposure limits.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe("APPROVE");
    }
  });

  it("should accept REJECT with a reason", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "REJECT",
      reason: "Concentration limit would be exceeded.",
    });

    expect(result.success).toBe(true);
  });

  it("should accept ADJUST only with a positive adjustedQuantity", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "ADJUST",
      reason: "Reduce size to respect exposure limits.",
      adjustedQuantity: 0.25,
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.verdict === "ADJUST") {
      expect(result.data.adjustedQuantity).toBe(0.25);
    }
  });

  it("should reject ADJUST without adjustedQuantity", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "ADJUST",
      reason: "Reduce size to respect exposure limits.",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a non-positive adjustedQuantity", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "ADJUST",
      reason: "Reduce size to respect exposure limits.",
      adjustedQuantity: 0,
    });

    expect(result.success).toBe(false);
  });

  it("should reject adjustedQuantity on APPROVE and REJECT", () => {
    expect(
      RiskVerdictSchema.safeParse({
        verdict: "APPROVE",
        reason: "Looks fine.",
        adjustedQuantity: 0.5,
      }).success
    ).toBe(false);

    expect(
      RiskVerdictSchema.safeParse({
        verdict: "REJECT",
        reason: "Too risky.",
        adjustedQuantity: 0.5,
      }).success
    ).toBe(false);
  });

  it("should reject unknown verdicts", () => {
    for (const verdict of ["HOLD", "approve", "MAYBE", ""]) {
      expect(RiskVerdictSchema.safeParse({ verdict, reason: "Some reason." }).success).toBe(false);
    }
  });

  it("should reject an empty, whitespace-only, or non-string reason", () => {
    expect(RiskVerdictSchema.safeParse({ verdict: "APPROVE", reason: "" }).success).toBe(false);
    expect(RiskVerdictSchema.safeParse({ verdict: "APPROVE", reason: "   " }).success).toBe(false);
    expect(RiskVerdictSchema.safeParse({ verdict: "APPROVE", reason: null }).success).toBe(false);
  });

  it("should reject unknown fields (strict contract)", () => {
    const result = RiskVerdictSchema.safeParse({
      verdict: "APPROVE",
      reason: "Looks fine.",
      authorized: true,
    });

    expect(result.success).toBe(false);
  });

  it("should reject a non-object payload", () => {
    for (const payload of [null, undefined, "APPROVE", 42, []]) {
      expect(RiskVerdictSchema.safeParse(payload).success).toBe(false);
    }
  });
});
