import {
  CombinedAnalysis,
  CombinedAnalysisSchema,
} from "./contracts";
import { FanInResults } from "./parallelAnalysis";

/**
 * Interface or function for aggregating collected fan-in results.
 *
 * ARCHITECTURAL RULE: Aggregators aggregate data and produce CombinedAnalysis.
 * An Aggregator must NEVER execute trades, modify accounts, or place orders.
 */
export class AnalysisAggregator {
  /**
   * Aggregates collected analyst results into a CombinedAnalysis verdict.
   *
   * Rules:
   * 1. If all mandatory analyses (Market, Risk, Portfolio) succeed:
   *    - Combined result is COMPLETE.
   *    - If Risk Analyst approves and signal is actionable, executionAllowed = true.
   *    - If Risk Analyst rejects or signal is HOLD, executionAllowed = false.
   * 2. If any mandatory analysis (Risk, Market, or Portfolio) fails or is missing:
   *    - Combined result is marked INCOMPLETE.
   *    - executionAllowed = false.
   *    - Trading decision is blocked.
   * 3. Successful results are strictly preserved alongside failure reasons.
   */
  public static aggregate(fanIn: FanInResults): CombinedAnalysis {
    const market = fanIn.market ?? null;
    const risk = fanIn.risk ?? null;
    const portfolio = fanIn.portfolio ?? null;
    const failures = [...(fanIn.failures ?? [])];

    const hasMarket = market !== null;
    const hasRisk = risk !== null;
    const hasPortfolio = portfolio !== null;
    const allMandatorySucceeded = hasMarket && hasRisk && hasPortfolio;

    if (!allMandatorySucceeded) {
      const reasons: string[] = [];

      if (!hasRisk) {
        reasons.push("Risk Analyst failed or is missing.");
      }
      if (!hasMarket) {
        reasons.push("Market Analyst failed or is missing.");
      }
      if (!hasPortfolio) {
        reasons.push("Portfolio Analyst failed or is missing.");
      }

      reasons.push(
        "Final trading decision is blocked: all three analyses (Market, Risk, Portfolio) are mandatory."
      );

      for (const failure of failures) {
        const failureNote = `[${failure.analyst}] ${failure.reason}`;
        if (!reasons.includes(failureNote)) {
          reasons.push(failureNote);
        }
      }

      const incompleteResult: CombinedAnalysis = {
        status: "INCOMPLETE",
        executionAllowed: false,
        market,
        risk,
        portfolio,
        failures,
        reasons,
        summary:
          "Analysis incomplete: missing required analyst results. Trading decision blocked.",
        action: null,
      };

      return CombinedAnalysisSchema.parse(incompleteResult);
    }

    // All three mandatory analyses succeeded
    const reasons: string[] = [];
    let executionAllowed = false;
    let action: "BUY" | "SELL" | "HOLD" | null = null;
    let summary = "";

    if (risk.status === "APPROVED") {
      if (market.signal === "HOLD") {
        executionAllowed = false;
        action = "HOLD";
        reasons.push("Market signal is HOLD; no trade execution required.");
        summary =
          "All analyses complete. Market signal is HOLD; trade execution is not allowed.";
      } else {
        executionAllowed = true;
        action = market.signal;
        reasons.push(
          "All mandatory analyses succeeded.",
          "Risk assessment approved the trade proposal."
        );
        summary = `All analyses complete. Execution allowed for ${market.signal} signal with confidence ${market.confidence}.`;
      }
    } else {
      // Risk Analyst rejected the proposal
      executionAllowed = false;
      action = null;
      reasons.push("Risk Analyst rejected the trade proposal.", ...risk.reasons);
      summary =
        "All analyses complete. Risk assessment rejected the trade proposal; execution blocked.";
    }

    const completeResult: CombinedAnalysis = {
      status: "COMPLETE",
      executionAllowed,
      market,
      risk,
      portfolio,
      failures,
      reasons,
      summary,
      action,
    };

    return CombinedAnalysisSchema.parse(completeResult);
  }
}

/**
 * Functional convenience wrapper for AnalysisAggregator.aggregate.
 */
export function aggregateAnalysis(fanIn: FanInResults): CombinedAnalysis {
  return AnalysisAggregator.aggregate(fanIn);
}
