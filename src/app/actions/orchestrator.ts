"use server";

import { OrchestratedRunInput, OrchestratedTradingReport } from "@/lib/agent";
import { runOrchestratedTradingRun } from "@/lib/usecases";

export interface RunOrchestratedTradingRunActionInput {
  symbol?: string;
  action?: "BUY" | "SELL";
  quantity?: number;
  minConfidence?: number;
}

/**
 * Server Action: run one analysis-driven, policy-guarded trading cycle.
 *
 * Flow: Epic 4 parallel analysis -> deterministic synthesis -> Epic 5 guarded
 * trading cycle. Analyst output is data only; the policy gate remains the sole
 * execution authority. A missing GEMINI_API_KEY fails closed at the reviewer
 * step (no trade is executed).
 */
export async function runOrchestratedTradingRunAction(
  input: RunOrchestratedTradingRunActionInput = {}
): Promise<OrchestratedTradingReport> {
  const sanitizedInput: OrchestratedRunInput = {
    symbol: typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "BTC",
    action: input.action === "SELL" ? "SELL" : "BUY",
    quantity: typeof input.quantity === "number" && input.quantity > 0 ? input.quantity : 1,
    ...(typeof input.minConfidence === "number" && Number.isFinite(input.minConfidence)
      ? { minConfidence: input.minConfidence }
      : {}),
  };

  return await runOrchestratedTradingRun(sanitizedInput, { reviewTimeoutMs: 15000 });
}
