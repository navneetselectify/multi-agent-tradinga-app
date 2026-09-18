import { describe, it, expect } from "vitest";
import { RiskService, RiskState } from "../riskService";
import { TradeProposal } from "@/lib/agent/contracts";

const baseState: RiskState = {
  cash: 100000,
  holdings: [
    { symbol: "BTC", quantity: 2 },
    { symbol: "ETH", quantity: 10 },
  ],
  prices: { BTC: 60000, ETH: 3000, SOL: 150 },
};

function proposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    action: "BUY",
    symbol: "BTC",
    quantity: 1,
    confidence: 0.8,
    reason: "Deterministic risk service test proposal.",
    ...overrides,
  };
}

describe("RiskService (deterministic hard rules)", () => {
  it("allows a valid BUY with sufficient cash and reports computed facts", () => {
    const result = RiskService.evaluate(proposal(), baseState);

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.executionPrice).toBe(60000);
    expect(result.estimatedValue).toBe(60000);
  });

  it("allows a BUY whose cost exactly equals available cash", () => {
    const result = RiskService.evaluate(proposal(), { ...baseState, cash: 60000 });

    expect(result.allowed).toBe(true);
  });

  it("rejects a BUY with insufficient cash but still reports the estimate", () => {
    const result = RiskService.evaluate(proposal(), { ...baseState, cash: 100 });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("Insufficient cash");
    expect(result.reasons[0]).toContain("required 60000");
    expect(result.reasons[0]).toContain("available 100");
    expect(result.estimatedValue).toBe(60000);
  });

  it("allows a valid SELL with sufficient holdings", () => {
    const result = RiskService.evaluate(proposal({ action: "SELL", quantity: 2 }), baseState);

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.estimatedValue).toBe(120000);
  });

  it("rejects a SELL that exceeds current holdings", () => {
    const result = RiskService.evaluate(proposal({ action: "SELL", quantity: 5 }), baseState);

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("Insufficient holdings: requested 5, available 2.");
  });

  it("rejects a SELL when no position is held", () => {
    const result = RiskService.evaluate(proposal({ action: "SELL", symbol: "SOL", quantity: 1 }), baseState);

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("Insufficient holdings: requested 1, available 0.");
  });

  it("rejects an unsupported symbol", () => {
    const unsupported = proposal({ symbol: "DOGE" as unknown as TradeProposal["symbol"] });
    const result = RiskService.evaluate(unsupported, baseState);

    expect(result.allowed).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('Unsupported symbol "DOGE"'))).toBe(true);
  });

  it("rejects a supported symbol with no valid market price", () => {
    const result = RiskService.evaluate(proposal(), { ...baseState, prices: {} });

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('No valid market price is available for "BTC"');
    expect(result.executionPrice).toBeNull();
    expect(result.estimatedValue).toBeNull();
  });

  it("rejects non-positive quantities", () => {
    for (const quantity of [0, -1]) {
      const result = RiskService.evaluate(proposal({ quantity }), baseState);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("Quantity must be a finite number greater than 0.");
    }
  });

  it("rejects non-finite quantities", () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = RiskService.evaluate(proposal({ quantity }), baseState);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("Quantity must be a finite number greater than 0.");
    }
  });

  it("rejects an unsupported action", () => {
    const invalid = proposal({ action: "HOLD" as unknown as TradeProposal["action"] });
    const result = RiskService.evaluate(invalid, baseState);

    expect(result.allowed).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('Unsupported action "HOLD"'))).toBe(true);
  });

  it("accumulates multiple independent violations", () => {
    const invalid = proposal({
      symbol: "DOGE" as unknown as TradeProposal["symbol"],
      quantity: -1,
    });
    const result = RiskService.evaluate(invalid, baseState);

    expect(result.allowed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
