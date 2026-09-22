import { z } from "zod";
import { AgentTool, ToolResult } from "../types";
import { executeTrade } from "@/app/actions/trading";
import { OrderResult } from "@/lib/exchange/service";

export const ExecuteTradeInput = z.object({
  symbol: z.enum(["BTC", "ETH", "SOL"]),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive("Quantity must be strictly positive."),
}).strict();

export class ExecuteTradeTool implements AgentTool<typeof ExecuteTradeInput, OrderResult> {
  readonly name = "execute_asset_trade";
  readonly description = "Execute a BUY or SELL order for a supported cryptocurrency (BTC, ETH, SOL) at the current market price.";
  readonly inputSchema = ExecuteTradeInput;
  readonly isReadOnly = false;
  readonly riskLevel = "HIGH" as const;
  readonly requiredPermission = "trade.execute" as const;

  async execute(args: unknown): Promise<ToolResult<OrderResult>> {
    const parsed = this.inputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input validation failed for execute_asset_trade.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      };
    }

    try {
      const { symbol, side, quantity } = parsed.data;
      const data = await executeTrade(symbol, side, quantity);

      if (data.status === "CANCELLED") {
        return {
          success: false,
          error: {
            code: "ORDER_CANCELLED",
            message: data.reason || "Order was cancelled.",
          },
          data,
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to execute trade.";
      return {
        success: false,
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message,
        },
      };
    }
  }
}

export { ExecuteTradeTool as ExecuteAssetTradeTool };
