import { RiskVerdict, TradeProposal } from "@/lib/agent/contracts";
import { RiskAssessment } from "@/lib/exchange/riskService";

/**
 * Outcome of the deterministic execution policy.
 */
export type GateDecision =
  | { execute: true; quantity: number; reason: string }
  | { execute: false; reason: string };

export interface PolicyGateInput {
  proposal: TradeProposal;
  hardRisk: RiskAssessment;
  verdict: RiskVerdict;
  adjustedRisk?: RiskAssessment | null;
}

/**
 * Deterministic execution policy. A RiskVerdict is DATA, never authority:
 * execution requires passing hard rules AND an APPROVE (or an ADJUST whose
 * quantity also passes hard rules). REJECT always blocks.
 *
 * Conflict Rules (designed as safety features, not bugs):
 * 1. Hard risk FAIL + verdict APPROVE => no trade (calculator wins).
 *    Even if the LLM reviewer enthusiastically approves, deterministic math
 *    and portfolio solvency constraints strictly veto execution.
 * 2. Hard risk PASS + verdict REJECT => no trade (stamp wins against execution).
 *    Even if the portfolio has adequate balance and market conditions allow it,
 *    an explicit human or reviewer agent stamp of REJECT halts execution.
 */
export function applyPolicyGate(input: PolicyGateInput): GateDecision {
  const { proposal, hardRisk, verdict, adjustedRisk } = input;

  if (!hardRisk.allowed) {
    return {
      execute: false,
      reason: `Hard risk rules failed: ${hardRisk.reasons.join(" ")}`,
    };
  }

  if (verdict.verdict === "REJECT") {
    return {
      execute: false,
      reason: `Risk review rejected the proposal: ${verdict.reason}`,
    };
  }

  if (verdict.verdict === "APPROVE") {
    return {
      execute: true,
      quantity: proposal.quantity,
      reason: "Risk review approved the proposal.",
    };
  }

  if (verdict.verdict === "ADJUST") {
    if (!adjustedRisk) {
      return {
        execute: false,
        reason: "Adjusted quantity was not re-evaluated against hard risk rules.",
      };
    }

    if (!adjustedRisk.allowed) {
      return {
        execute: false,
        reason: `Adjusted quantity failed hard risk rules: ${adjustedRisk.reasons.join(" ")}`,
      };
    }

    return {
      execute: true,
      quantity: verdict.adjustedQuantity,
      reason: `Risk review adjusted the quantity to ${verdict.adjustedQuantity}.`,
    };
  }

  return { execute: false, reason: "Unsupported risk verdict." };
}
