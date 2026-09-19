import { TradeProposal } from "@/lib/agent/contracts";

/**
 * Minimum portfolio/market state required for deterministic risk evaluation.
 * Structurally satisfied by the getDashboardData use case result.
 */
export interface RiskState {
  cash: number;
  holdings: Array<{ symbol: string; quantity: number }>;
  prices: Record<string, number>;
}

/**
 * Deterministic hard-rule assessment of a TradeProposal.
 * Agent verdicts never override this result.
 */
export interface RiskAssessment {
  allowed: boolean;
  reasons: string[];
  executionPrice: number | null;
  estimatedValue: number | null;
}

const SUPPORTED_SYMBOLS: readonly string[] = ["BTC", "ETH", "SOL"];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic hard-rule checks for trade proposals.
 *
 * Pure business logic: no I/O, no LLM, no trade execution. State is supplied by
 * the caller so the rules remain independently testable.
 */
export class RiskService {
  public static evaluate(proposal: TradeProposal, state: RiskState): RiskAssessment {
    const reasons: string[] = [];

    const symbol: string = proposal.symbol;
    const action: string = proposal.action;
    const rawQuantity: unknown = proposal.quantity;

    const quantity =
      typeof rawQuantity === "number" && Number.isFinite(rawQuantity) && rawQuantity > 0
        ? rawQuantity
        : null;

    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      reasons.push(`Unsupported symbol "${String(symbol)}".`);
    }
    if (action !== "BUY" && action !== "SELL") {
      reasons.push(`Unsupported action "${String(action)}".`);
    }
    if (quantity === null) {
      reasons.push("Quantity must be a finite number greater than 0.");
    }

    const rawPrice: unknown = state.prices[symbol];
    const executionPrice =
      typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;

    if (executionPrice === null) {
      reasons.push(`No valid market price is available for "${String(symbol)}".`);
    }

    const estimatedValue =
      executionPrice !== null && quantity !== null ? round2(executionPrice * quantity) : null;

    if (action === "BUY" && executionPrice !== null && quantity !== null) {
      const rawCash: unknown = state.cash;
      const cash = typeof rawCash === "number" && Number.isFinite(rawCash) ? rawCash : null;

      if (cash === null) {
        reasons.push("Portfolio cash balance is unavailable.");
      } else if (cash < executionPrice * quantity) {
        reasons.push(
          `Insufficient cash: required ${round2(executionPrice * quantity)}, available ${round2(cash)}.`
        );
      }
    }

    if (action === "SELL" && quantity !== null) {
      const holding = state.holdings.find((entry) => entry.symbol === symbol);
      const available =
        holding && typeof holding.quantity === "number" && Number.isFinite(holding.quantity)
          ? holding.quantity
          : 0;

      if (available < quantity) {
        reasons.push(`Insufficient holdings: requested ${quantity}, available ${available}.`);
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      executionPrice,
      estimatedValue,
    };
  }
}
