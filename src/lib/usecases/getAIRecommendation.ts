import { db } from "@/lib/db/client";
import { AIService, TradingDecision, TradingContext } from "@/lib/ai/service";
import { getLatestPrices } from "./helpers";

/**
 * Use Case: Assemble market and portfolio metrics and retrieve an AI Trading Decision.
 * NOTE: The returned decision is strictly informative and is NOT automatically executed.
 */
export async function getAIRecommendation(): Promise<TradingDecision> {
  // 1. Query current portfolio balances
  const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
  const cash = (cashRes.rows[0]?.cash as number) ?? 100000.0;

  const holdingsRes = await db.execute("SELECT symbol, quantity FROM portfolio_holdings");
  const holdings = holdingsRes.rows.map((row) => ({
    symbol: row.symbol as string,
    quantity: row.quantity as number,
  }));

  // 2. Query current pricing ticks
  const currentPricesMap = await getLatestPrices();
  const currentPrices = Object.entries(currentPricesMap).map(([symbol, price]) => ({
    symbol,
    price,
  }));

  // 3. Query a bounded history window (last 10 ticks per asset, total max 30)
  const historyRes = await db.execute(`
    SELECT symbol, price, timestamp 
    FROM market_history 
    ORDER BY timestamp DESC 
    LIMIT 30
  `);
  const recentHistory = historyRes.rows.map((row) => ({
    symbol: row.symbol as string,
    price: row.price as number,
    timestamp: row.timestamp as string,
  }));

  const context: TradingContext = {
    cash,
    holdings,
    currentPrices,
    recentHistory,
  };

  // 4. Delegate to AI Service Layer
  return await AIService.generateDecision(context);
}
