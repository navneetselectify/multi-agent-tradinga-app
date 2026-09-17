import { db } from "@/lib/db/client";

/**
 * Helper to fetch the latest prices from the market_history table.
 * Falls back to MockExchangeEngine's starting prices if market_history is empty.
 */
export async function getLatestPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 };
  
  for (const symbol of Object.keys(prices)) {
    const res = await db.execute({
      sql: "SELECT price FROM market_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1",
      args: [symbol],
    });
    if (res.rows.length > 0) {
      prices[symbol] = res.rows[0].price as number;
    }
  }
  
  return prices;
}
