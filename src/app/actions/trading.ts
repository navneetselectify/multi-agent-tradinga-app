"use server";

import { db } from "@/lib/db/client";
import { MockExchangeEngine } from "@/lib/exchange/engine";
import { OrderService, OrderResult } from "@/lib/exchange/service";
import { AIService, TradingDecision, TradingContext } from "@/lib/ai/service";

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
 * Helper to fetch the latest prices from the market_history table.
 * Falls back to MockExchangeEngine's starting prices if market_history is empty.
 */
async function getLatestPrices(): Promise<Record<string, number>> {
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

/**
 * Use Case 1: Fetch all data required to render the main Dashboard view.
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

/**
 * Use Case 2: Advance the market prices by one tick, save the values, and return them.
 */
export async function triggerTick(): Promise<Record<string, number>> {
  // 1. Fetch latest prices to hydrate the engine
  const currentPrices = await getLatestPrices();
  
  // 2. Initialize engine and perform a tick
  const engine = new MockExchangeEngine(Date.now(), currentPrices);
  const nextPrices = engine.tick();

  // 3. Persist the prices atomically
  await OrderService.recordTickPrices(nextPrices);

  return nextPrices;
}

/**
 * Use Case 3: Execute a BUY or SELL trade, locking the price to the last database price.
 */
export async function executeTrade(
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number
): Promise<OrderResult> {
  const uppercaseSymbol = symbol.toUpperCase();
  const allowedSymbols = ["BTC", "ETH", "SOL"];

  // Transport Parameter Validations
  if (!allowedSymbols.includes(uppercaseSymbol)) {
    throw new Error(`Transport Error: Unsupported trade asset "${symbol}".`);
  }
  if (quantity <= 0) {
    throw new Error("Transport Error: Quantity must be strictly positive.");
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(`Transport Error: Unsupported transaction side "${side}".`);
  }

  // 1. Resolve current market price from database (ensuring execution locks to the last tick)
  const prices = await getLatestPrices();
  const executionPrice = prices[uppercaseSymbol];

  if (!executionPrice) {
    throw new Error(`Transport Error: No price tick exists for asset "${symbol}".`);
  }

  // 2. Delegate to Business Service Layer
  return await OrderService.executeTrade(uppercaseSymbol, side, quantity, executionPrice);
}

/**
 * Use Case 4: Assemble market and portfolio metrics and retrieve an AI Trading Decision.
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
