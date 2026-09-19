"use server";

import {
  runParallelTradingAnalysis,
  ParallelTradingAnalysisInput,
} from "@/lib/usecases";
import { CombinedAnalysis } from "@/lib/agent";

export interface RunParallelAnalysisActionInput {
  symbol?: string;
  action?: "BUY" | "SELL";
  quantity?: number;
  timeouts?: {
    marketMs?: number;
    riskMs?: number;
    portfolioMs?: number;
    defaultTimeoutMs?: number;
  };
  delays?: {
    marketMs?: number;
    riskMs?: number;
    portfolioMs?: number;
  };
}

/**
 * Server Action: Execute parallel analysis flow for Market, Risk, and Portfolio analysts.
 *
 * ARCHITECTURAL RULE: This action provides purely analytical data and never executes trades.
 */
export async function runParallelAnalysisAction(
  input: RunParallelAnalysisActionInput = {}
): Promise<CombinedAnalysis> {
  const sanitizedInput: ParallelTradingAnalysisInput = {
    symbol: typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "BTC",
    action: input.action === "SELL" ? "SELL" : "BUY",
    quantity: typeof input.quantity === "number" && input.quantity > 0 ? input.quantity : 1,
    timeouts: input.timeouts,
    delays: input.delays,
  };

  return await runParallelTradingAnalysis(sanitizedInput);
}
