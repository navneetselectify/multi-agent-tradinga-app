import { db } from "@/lib/db/client";
import { getLatestPrices } from "./helpers";

export interface DashboardData {
  cash: number;
  holdingsValue: number;
  netAssetValue: number;
  holdings: Array<{ symbol: string; quantity: number; currentPrice: number; totalValue: number }>;
  orders: Array<{
    id: number;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    status: "PENDING" | "EXECUTED" | "CANCELLED";
    cancel_reason: string | null;
    created_at: string;
  }>;
  prices: Record<string, number>;
}

/**
 * Use Case: Fetch all data required to render the main Dashboard view.
 */
export async function getDashboardData(): Promise<DashboardData> {
  // 1. Fetch cash balance
  const cashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
  const cash = (cashRes.rows[0]?.cash as number) ?? 100000.0;

  // 2. Fetch current prices
  const prices = await getLatestPrices();

  // 3. Fetch active holdings and calculate current values
  const holdingsRes = await db.execute("SELECT symbol, quantity FROM portfolio_holdings");
  let holdingsValue = 0;
  
  const holdings = holdingsRes.rows.map((row) => {
    const symbol = row.symbol as string;
    const quantity = row.quantity as number;
    const currentPrice = prices[symbol] || 0;
    const totalValue = quantity * currentPrice;
    holdingsValue += totalValue;

    return {
      symbol,
      quantity,
      currentPrice,
      totalValue: Math.round(totalValue * 100) / 100,
    };
  });

  const netAssetValue = Math.round((cash + holdingsValue) * 100) / 100;

  // 4. Fetch recent orders log (limit to last 50)
  const ordersRes = await db.execute(`
    SELECT id, symbol, side, quantity, price, status, cancel_reason, created_at 
    FROM orders 
    ORDER BY created_at DESC 
    LIMIT 50
  `);
  
  const orders = ordersRes.rows.map((row) => ({
    id: row.id as number,
    symbol: row.symbol as string,
    side: row.side as "BUY" | "SELL",
    quantity: row.quantity as number,
    price: row.price as number,
    status: row.status as "PENDING" | "EXECUTED" | "CANCELLED",
    cancel_reason: row.cancel_reason as string | null,
    created_at: row.created_at as string,
  }));

  return {
    cash: Math.round(cash * 100) / 100,
    holdingsValue: Math.round(holdingsValue * 100) / 100,
    netAssetValue,
    holdings,
    orders,
    prices,
  };
}
