import { GetPortfolioAndMarketStateTool } from "./getPortfolioAndMarketState";

export async function runPortfolioCheck(symbol?: string) {
  const tool = new GetPortfolioAndMarketStateTool();
  const result = await tool.execute({});

  if (!result.success || !result.data) {
    console.error("Failed to retrieve portfolio state:", result.error);
    throw new Error(result.error?.message || "Failed to retrieve portfolio state");
  }

  const data = result.data;
  const targetSymbol = symbol?.trim().toUpperCase();

  console.log("\n=== PORTFOLIO CHECK (READ-ONLY) ===");
  console.log(`Cash Balance:        $${data.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Holdings Value:      $${data.holdingsValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Net Asset Value:     $${data.netAssetValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log("-----------------------------------");

  console.log("Market Prices:");
  for (const [s, p] of Object.entries(data.prices)) {
    console.log(`  - ${s}: $${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  console.log("-----------------------------------");

  if (targetSymbol) {
    console.log(`Filtered Holding [${targetSymbol}]:`);
    const holding = data.holdings.find((h) => h.symbol.toUpperCase() === targetSymbol);
    if (holding) {
      console.log(`  Quantity:      ${holding.quantity}`);
      console.log(`  Current Price: $${holding.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`  Total Value:   $${holding.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    } else {
      console.log(`  No active holding found for ${targetSymbol} (Quantity: 0)`);
    }
  } else {
    console.log("Holdings:");
    if (data.holdings.length === 0) {
      console.log("  No active holdings.");
    } else {
      for (const h of data.holdings) {
        console.log(`  - ${h.symbol}: ${h.quantity} units @ $${h.currentPrice.toFixed(2)} = $${h.totalValue.toFixed(2)}`);
      }
    }
  }
  console.log("===================================\n");
  return data;
}

// Allow direct CLI execution
if (process.argv[1]?.includes("portfolioCheckRunner.ts")) {
  const symbolArg = process.argv[2];
  runPortfolioCheck(symbolArg).catch((err) => {
    console.error("Error executing portfolio check:", err);
    process.exit(1);
  });
}
