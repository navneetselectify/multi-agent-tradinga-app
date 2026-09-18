"use server";

import { OrderResult } from "@/lib/exchange/service";
import { TradingDecision } from "@/lib/ai/service";
import {
  getDashboardData as getDashboardDataUseCase,
  DashboardData,
  triggerTick as triggerTickUseCase,
  executeTrade as executeTradeUseCase,
  getAIRecommendation as getAIRecommendationUseCase,
  runTradingCycle,
  TradingCycleReport,
} from "@/lib/usecases";
import { TradeProposalSchema, createRiskReviewer } from "@/lib/agent";

export type { DashboardData };

/**
 * Use Case 1: Fetch all data required to render the main Dashboard view.
 * Server action acts as a thin transport wrapper delegating directly to getDashboardDataUseCase.
 */
export async function getDashboardData(): Promise<DashboardData> {
  return getDashboardDataUseCase();
}

/**
 * Use Case 2: Advance the market prices by one tick, save the values, and return them.
 * Server action acts as a thin transport wrapper delegating directly to triggerTickUseCase.
 */
export async function triggerTick(): Promise<Record<string, number>> {
  return triggerTickUseCase();
}

/**
 * Use Case 3: Execute a BUY or SELL trade, locking the price to the last database price.
 * Server action acts as a thin transport wrapper delegating directly to executeTradeUseCase.
 */
export async function executeTrade(
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number
): Promise<OrderResult> {
  return executeTradeUseCase(symbol, side, quantity);
}

/**
 * Use Case 4: Assemble market and portfolio metrics and retrieve an AI Trading Decision.
 * NOTE: The returned decision is strictly informative and is NOT automatically executed.
 * Server action acts as a thin transport wrapper delegating directly to getAIRecommendationUseCase.
 */
export async function getAIRecommendation(): Promise<TradingDecision> {
  return getAIRecommendationUseCase();
}

/**
 * Server Action: Run one full multi-agent trading cycle.
 * Leverages the deterministic RiskService, Risk Reviewer agent review, and policy gate.
 */
export async function runTeamTradingCycle(input: unknown): Promise<TradingCycleReport> {
  const emptyReport: TradingCycleReport = {
    outcome: "ABORTED",
    proposal: null,
    hardRisk: null,
    verdict: null,
    gate: null,
    order: null,
    reason: null,
  };

  // 1. Cleanly handle missing GEMINI_API_KEY without throwing unhandled exceptions
  if (!process.env.GEMINI_API_KEY) {
    const parsed = TradeProposalSchema.safeParse(input);
    return {
      ...emptyReport,
      proposal: parsed.success ? parsed.data : null,
      reason: "Configuration Error: GEMINI_API_KEY is not defined in the environment.",
    };
  }

  // 2. Validate input boundary constraints
  const parsed = TradeProposalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ...emptyReport,
      reason: "Proposal failed contract validation. Details: " + parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
    };
  }

  const proposal = parsed.data;

  // 3. Define the explicit proposal function (must not be a default)
  const propose = async () => proposal;

  // 4. Instantiate the Risk Reviewer with a safe, bounded timeout
  const review = createRiskReviewer({ reviewTimeoutMs: 15000 }); // 15s timeout

  // 5. Execute the cycle
  try {
    return await runTradingCycle({
      propose,
      review,
      reviewTimeoutMs: 15000,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred during the trading cycle.";
    return {
      ...emptyReport,
      proposal,
      reason: `System Error: ${message}`,
    };
  }
}
