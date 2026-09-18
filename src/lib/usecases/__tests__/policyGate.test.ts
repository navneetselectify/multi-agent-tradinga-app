import { describe, it, expect } from "vitest";
import { applyPolicyGate } from "../policyGate";
import { RiskVerdict, TradeProposal } from "@/lib/agent/contracts";
import { RiskAssessment } from "@/lib/exchange/riskService";

const proposal: TradeProposal = {
  action: "BUY",
  symbol: "BTC",
  quantity: 1,
  confidence: 0.8,
  reason: "Policy gate test proposal.",
};

const hardPass: RiskAssessment = {
  allowed: true,
  reasons: [],
  executionPrice: 60000,
  estimatedValue: 60000,
};

const hardFail: RiskAssessment = {
  allowed: false,
  reasons: ["Insufficient cash: required 60000, available 100."],
  executionPrice: 60000,
  estimatedValue: 60000,
};

const approve: RiskVerdict = { verdict: "APPROVE", reason: "Within exposure limits." };
const reject: RiskVerdict = { verdict: "REJECT", reason: "Too concentrated." };
const adjust = (quantity: number): RiskVerdict => ({
  verdict: "ADJUST",
  reason: "Reduce position size.",
  adjustedQuantity: quantity,
});

const adjustedPass: RiskAssessment = {
  allowed: true,
  reasons: [],
  executionPrice: 60000,
  estimatedValue: 30000,
};

const adjustedFail: RiskAssessment = {
  allowed: false,
  reasons: ["Insufficient cash: required 300000, available 100000."],
  executionPrice: 60000,
  estimatedValue: 300000,
};

describe("Policy gate (deterministic execution policy)", () => {
  it("executes the original quantity on APPROVE with passing hard rules", () => {
    const decision = applyPolicyGate({ proposal, hardRisk: hardPass, verdict: approve });

    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.quantity).toBe(1);
    }
  });

  it("conflict rule: hard risk FAIL + verdict APPROVE => no trade (calculator wins)", () => {
    const decision = applyPolicyGate({ proposal, hardRisk: hardFail, verdict: approve });

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.reason).toContain("Hard risk rules failed");
      expect(decision.reason).toContain("Insufficient cash");
    }
  });

  it("conflict rule: hard risk PASS + verdict REJECT => no trade (stamp wins against execution)", () => {
    const decision = applyPolicyGate({ proposal, hardRisk: hardPass, verdict: reject });

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.reason).toContain("Risk review rejected");
    }
  });

  it("blocks REJECT when hard rules also fail", () => {
    const decision = applyPolicyGate({ proposal, hardRisk: hardFail, verdict: reject });

    expect(decision.execute).toBe(false);
  });

  it("executes the adjusted quantity on ADJUST with passing adjusted hard rules", () => {
    const decision = applyPolicyGate({
      proposal,
      hardRisk: hardPass,
      verdict: adjust(0.5),
      adjustedRisk: adjustedPass,
    });

    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.quantity).toBe(0.5);
    }
  });

  it("blocks ADJUST when the adjusted quantity fails hard rules", () => {
    const decision = applyPolicyGate({
      proposal,
      hardRisk: hardPass,
      verdict: adjust(5),
      adjustedRisk: adjustedFail,
    });

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.reason).toContain("Adjusted quantity failed hard risk rules");
    }
  });

  it("blocks ADJUST when no adjusted hard-risk evaluation is provided", () => {
    const decision = applyPolicyGate({
      proposal,
      hardRisk: hardPass,
      verdict: adjust(0.5),
      adjustedRisk: null,
    });

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.reason).toContain("not re-evaluated");
    }
  });

  it("blocks an unsupported verdict defensively", () => {
    const malformed = { verdict: "MAYBE", reason: "Unsupported." } as unknown as RiskVerdict;
    const decision = applyPolicyGate({ proposal, hardRisk: hardPass, verdict: malformed });

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.reason).toBe("Unsupported risk verdict.");
    }
  });
});
