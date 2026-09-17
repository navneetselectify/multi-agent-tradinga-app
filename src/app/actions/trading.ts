"use server";

import { OrderResult } from "@/lib/exchange/service";
import { TradingDecision } from "@/lib/ai/service";
import {
  getDashboardData as getDashboardDataUseCase,
  DashboardData,
  triggerTick as triggerTickUseCase,
  executeTrade as executeTradeUseCase,
  getAIRecommendation as getAIRecommendationUseCase,
} from "@/lib/usecases";

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
