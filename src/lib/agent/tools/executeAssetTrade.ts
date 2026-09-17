import { z } from "zod";
import { AgentTool, ToolResult } from "../types";
import { executeTrade } from "@/lib/usecases";
import { OrderResult } from "@/lib/exchange/service";

export const ExecuteAssetTradeInput = z.object({
  symbol: z.enum(["BTC", "ETH", "SOL"], {
    errorMap: () => ({ message: "Symbol must be one of: BTC, ETH, SOL." }),
  }),
  side: z.enum(["BUY", "SELL"], {
    errorMap: () => ({ message: "Side must be one of: BUY, SELL." }),
  }),
  quantity: z.number().positive("Quantity must be strictly positive (> 0)."),
  reason: z.string().min(10, "A detailed reason of at least 10 characters is required for trade audits."),
  confidence: z.number().min(0).max(1, "Confidence must be between 0.0 and 1.0 inclusive."),
}).strict();

export class ExecuteAssetTradeTool implements AgentTool<typeof ExecuteAssetTradeInput, OrderResult> {
  readonly name = "execute_asset_trade";
  readonly description = "Execute a BUY or SELL order for BTC, ETH, or SOL at the current locked database price.";
  readonly inputSchema = ExecuteAssetTradeInput;
  readonly isReadOnly = false;
  readonly riskLevel = "HIGH" as const;

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

    const { symbol, side, quantity } = parsed.data;

    try {
      const orderResult = await executeTrade(symbol, side, quantity);
      return {
        success: true,
        data: orderResult,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: error?.message || "Trade execution failed.",
        },
      };
    }
  }
}
