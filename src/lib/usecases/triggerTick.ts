import { MockExchangeEngine } from "@/lib/exchange/engine";
import { OrderService } from "@/lib/exchange/service";
import { getLatestPrices } from "./helpers";

/**
 * Use Case: Advance the market prices by one tick, save the values, and return them.
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
