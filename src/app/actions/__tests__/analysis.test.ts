import { describe, it, expect } from "vitest";
import { runParallelAnalysisAction } from "../analysis";

describe("runParallelAnalysisAction Server Action Boundary", () => {
  it("executes parallel analysis with default arguments", async () => {
    const result = await runParallelAnalysisAction({});

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
    expect(result.action).toBe("BUY");
    expect(result.market).not.toBeNull();
    expect(result.risk).not.toBeNull();
    expect(result.portfolio).not.toBeNull();
    expect(result.failures).toEqual([]);
    // Pure analysis: no order details
    expect(result).not.toHaveProperty("orderId");
  });

  it("sanitizes input and executes with provided symbol and action", async () => {
    const result = await runParallelAnalysisAction({
      symbol: "  eth  ",
      action: "SELL",
      quantity: 5,
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
    expect(result.market?.reason).toContain("ETH");
  });

  it("applies configurable timeouts correctly", async () => {
    const result = await runParallelAnalysisAction({
      symbol: "BTC",
      timeouts: {
        defaultTimeoutMs: 10000,
      },
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(true);
  });

  it("handles quantity exceeding mock risk cap through action boundary", async () => {
    const result = await runParallelAnalysisAction({
      symbol: "BTC",
      quantity: 5.0, // $325,000 > $100,000 cap
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.risk?.status).toBe("REJECTED");
  });

  it("handles simulated delays exceeding timeout through action boundary", async () => {
    const result = await runParallelAnalysisAction({
      symbol: "SOL",
      timeouts: {
        defaultTimeoutMs: 20,
      },
      delays: {
        marketMs: 80,
      },
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.executionAllowed).toBe(false);
    expect(result.failures[0].analyst).toBe("market");
  });
});
