import { OrderService, OrderResult } from "@/lib/exchange/service";
import { getLatestPrices } from "./helpers";

/**
 * Use Case: Execute a BUY or SELL trade, locking the price to the last database price.
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
