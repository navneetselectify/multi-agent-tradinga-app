import { z } from "zod";
import { AgentTool, ToolResult } from "../types";
import { getDashboardData, DashboardData } from "@/lib/usecases";

export const GetPortfolioAndMarketStateInput = z.object({}).strict();

export class GetPortfolioAndMarketStateTool implements AgentTool<typeof GetPortfolioAndMarketStateInput, DashboardData> {
  readonly name = "get_portfolio_and_market_state";
  readonly description = "Retrieve current portfolio cash, active holdings, latest asset prices, and recent order history.";
  readonly inputSchema = GetPortfolioAndMarketStateInput;
  readonly isReadOnly = true;
  readonly riskLevel = "LOW" as const;

  async execute(args: unknown): Promise<ToolResult<DashboardData>> {
    const parsed = this.inputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input validation failed for get_portfolio_and_market_state.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      };
    }

    try {
      const data = await getDashboardData();
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: error?.message || "Failed to retrieve portfolio and market state.",
        },
      };
    }
  }
}
