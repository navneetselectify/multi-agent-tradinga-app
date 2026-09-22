import { describe, it, expect } from "vitest";
import { runOrchestratedTradingRunAction } from "../orchestrator";

describe("runOrchestratedTradingRunAction Server Action Boundary", () => {
  it("sanitizes input and vetoes a trade that exceeds the mock risk cap", async () => {
    const report = await runOrchestratedTradingRunAction({ symbol: "  btc  ", quantity: 5 });

    expect(report.status).toBe("SKIPPED");
    expect(report.proposal).toBeNull();
    expect(report.cycleOutcome).toBeNull();
    expect(report.analysis.status).toBe("COMPLETE");
    expect(report.analysis.risk?.status).toBe("REJECTED");
  });

  it("passes minConfidence through the boundary and vetoes low-confidence signals", async () => {
    const report = await runOrchestratedTradingRunAction({
      symbol: "BTC",
      quantity: 0.5,
      minConfidence: 0.99,
    });

    expect(report.status).toBe("SKIPPED");
    expect(report.proposal).toBeNull();
    expect(report.synthesisReason).toContain("below the minimum threshold 0.99");
  });
});
