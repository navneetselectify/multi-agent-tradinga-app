export class MockExchangeEngine {
  private seed: number;
  private currentPrices: Record<string, number>;

  constructor(seed = 12345, startingPrices?: Record<string, number>) {
    this.seed = seed;
    this.currentPrices = {
      BTC: 60000.0,
      ETH: 3000.0,
      SOL: 150.0,
    };
    if (startingPrices) {
      for (const [symbol, price] of Object.entries(startingPrices)) {
        const uppercaseSymbol = symbol.toUpperCase();
        if (uppercaseSymbol in this.currentPrices) {
          this.currentPrices[uppercaseSymbol] = price;
        }
      }
    }
  }

  // Linear Congruential Generator (LCG) for 100% reproducible pseudo-randomness
  private nextPRNG(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  /**
   * Returns the current simulated price of a symbol.
   * Throws an error if the symbol is not supported.
   */
  public getPrice(symbol: string): number {
    const uppercaseSymbol = symbol.toUpperCase();
    if (!(uppercaseSymbol in this.currentPrices)) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }
    return this.currentPrices[uppercaseSymbol];
  }

  /**
   * Advances the market by one tick, modifying prices deterministically.
   * Returns the updated prices object.
   */
  public tick(): Record<string, number> {
    const symbols = Object.keys(this.currentPrices);
    
    for (const symbol of symbols) {
      const prngValue = this.nextPRNG();
      // Generate percentage change between -2% and +2%
      const pctChange = (prngValue * 0.04) - 0.02;
      const oldPrice = this.currentPrices[symbol];
      const newPrice = oldPrice * (1 + pctChange);
      
      // Round to 2 decimal places to keep prices clean and readable
      this.currentPrices[symbol] = Math.round(newPrice * 100) / 100;
    }

    return { ...this.currentPrices };
  }

  /**
   * Reset the engine to starting conditions.
   */
  public reset(seed = 12345) {
    this.seed = seed;
    this.currentPrices = {
      BTC: 60000.0,
      ETH: 3000.0,
      SOL: 150.0,
    };
  }
}
