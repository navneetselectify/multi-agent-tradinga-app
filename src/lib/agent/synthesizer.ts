import {
  CombinedAnalysis,
  TradeProposal,
  TradeProposalSchema,
} from "./contracts";

/**
 * Epic 6: candidate trade handed to the synthesizer for confirmation.
 */
export interface SynthesisCandidate {
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
}

/**
 * Result of a synthesis attempt: either a proposal for the guarded trading
 * cycle, or null plus a human-readable veto reason.
 */
export interface SynthesisResult {
  proposal: TradeProposal | null;
  reason: string;
}

/**
 * Default minimum market-analyst confidence required to synthesize a proposal.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

const SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL"] as const;
type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

function isSupportedSymbol(value: string): value is SupportedSymbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}

/**
 * Deterministically converts parallel-analysis output into a TradeProposal.
 *
 * ARCHITECTURAL RULE: this function can only VETO (return null). It never
 * authorizes execution; the guarded trading cycle (hard risk, reviewer, policy
 * gate) remains the sole execution authority. Pure and deterministic: no I/O,
 * no clock, no randomness, no LLM calls.
 */
export function synthesizeProposal(
  analysis: CombinedAnalysis,
  candidate: SynthesisCandidate,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE
): SynthesisResult {
  const symbol = candidate.symbol.trim().toUpperCase();

  if (!isSupportedSymbol(symbol)) {
    return {
      proposal: null,
      reason: `Unsupported symbol "${candidate.symbol}". Supported symbols: ${SUPPORTED_SYMBOLS.join(", ")}.`,
    };
  }

  if (!Number.isFinite(candidate.quantity) || candidate.quantity <= 0) {
    return {
      proposal: null,
      reason: "Candidate quantity must be a finite number greater than 0.",
    };
  }

  if (analysis.status !== "COMPLETE") {
    return {
      proposal: null,
      reason: `Analysis is INCOMPLETE: ${analysis.summary ?? analysis.reasons.join(" ")}`,
    };
  }

  if (analysis.failures.length > 0) {
    const failureSummary = analysis.failures
      .map((failure) => `${failure.analyst}: ${failure.reason}`)
      .join("; ");
    return {
      proposal: null,
      reason: `Analysis reported failures: ${failureSummary}`,
    };
  }

  const market = analysis.market;

  if (market === null) {
    return {
      proposal: null,
      reason: "Market analysis is missing; no proposal can be synthesized.",
    };
  }

  if (market.signal === "HOLD" || analysis.action === "HOLD") {
    return {
      proposal: null,
      reason: "Market signal is HOLD; no trade proposal is synthesized.",
    };
  }

  if (!analysis.executionAllowed) {
    return {
      proposal: null,
      reason:
        analysis.risk?.status === "REJECTED"
          ? `Risk analyst rejected the proposal: ${analysis.risk.reasons.join(" ")}`
          : `Analysis did not allow execution: ${analysis.reasons.join(" ")}`,
    };
  }

  if (analysis.action !== candidate.action) {
    return {
      proposal: null,
      reason: `Analysis signal ${String(analysis.action)} does not confirm the candidate action ${candidate.action}.`,
    };
  }

  const threshold =
    typeof minConfidence === "number" && Number.isFinite(minConfidence)
      ? minConfidence
      : DEFAULT_MIN_CONFIDENCE;

  if (market.confidence < threshold) {
    return {
      proposal: null,
      reason: `Market confidence ${market.confidence} is below the minimum threshold ${threshold}.`,
    };
  }

  const proposal: TradeProposal = {
    action: candidate.action,
    symbol,
    quantity: candidate.quantity,
    confidence: market.confidence,
    reason: market.reason,
  };

  const parsed = TradeProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return {
      proposal: null,
      reason: "Synthesized proposal failed contract validation.",
    };
  }

  return {
    proposal: parsed.data,
    reason: `Synthesized ${candidate.action} proposal for ${symbol} with confidence ${market.confidence}.`,
  };
}
