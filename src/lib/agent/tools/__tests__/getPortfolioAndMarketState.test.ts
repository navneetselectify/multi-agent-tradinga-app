import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetPortfolioAndMarketStateTool } from "../getPortfolioAndMarketState";
import { runPortfolioCheck } from "../portfolioCheckRunner";

// Mock getDashboardData to isolate agent tool unit testing
vi.mock("@/app/actions/trading", () => {
  return {
    getDashboardData: vi.fn(),
  };
});

import { getDashboardData } from "@/app/actions/trading";

describe("GetPortfolioAndMarketStateTool Suite", () => {
  const mockDashboardData = {
    cash: 100000.0,
    holdingsValue: 60000.0,
    netAssetValue: 160000.0,
    holdings: [
      { symbol: "BTC", quantity: 1, currentPrice: 60000.0, totalValue: 60000.0 },
    ],
    orders: [],
    prices: { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata contracts", () => {
    const tool = new GetPortfolioAndMarketStateTool();
    expect(tool.name).toBe("get_portfolio_and_market_state");
    expect(tool.isReadOnly).toBe(true);
    expect(tool.riskLevel).toBe("LOW");
    expect(tool.requiredPermission).toBe("portfolio.read");
    expect(typeof tool.description).toBe("string");
  });

  it("should return portfolio and market data when executed with empty arguments", async () => {
    vi.mocked(getDashboardData).mockResolvedValueOnce(mockDashboardData);
    const tool = new GetPortfolioAndMarketStateTool();

    const res = await tool.execute({});
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockDashboardData);
    expect(getDashboardData).toHaveBeenCalledTimes(1);
  });

  it("should accept undefined arguments and default gracefully", async () => {
    vi.mocked(getDashboardData).mockResolvedValueOnce(mockDashboardData);
    const tool = new GetPortfolioAndMarketStateTool();

    const res = await tool.execute();
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockDashboardData);
  });

  it("should reject invalid arguments with a VALIDATION_ERROR", async () => {
    const tool = new GetPortfolioAndMarketStateTool();

    const res = await tool.execute({ unexpectedArg: "forbidden" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("VALIDATION_ERROR");
    expect(getDashboardData).not.toHaveBeenCalled();
  });

  it("should handle service layer failures gracefully with BUSINESS_RULE_VIOLATION", async () => {
    vi.mocked(getDashboardData).mockRejectedValueOnce(new Error("Database connection timeout"));
    const tool = new GetPortfolioAndMarketStateTool();

    const res = await tool.execute({});
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(res.error?.message).toBe("Database connection timeout");
  });

  it("should run portfolioCheckRunner successfully with optional symbol filtering", async () => {
    vi.mocked(getDashboardData).mockResolvedValue(mockDashboardData);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const allData = await runPortfolioCheck();
    expect(allData).toEqual(mockDashboardData);

    const btcData = await runPortfolioCheck("BTC");
    expect(btcData).toEqual(mockDashboardData);

    const ethData = await runPortfolioCheck("ETH");
    expect(ethData).toEqual(mockDashboardData);

    consoleSpy.mockRestore();
  });
});
