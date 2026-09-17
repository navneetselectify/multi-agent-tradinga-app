import { z } from "zod";
import { AgentTool, ToolResult } from "../types";
import { triggerTick } from "@/lib/usecases";

export const AdvanceMarketTickInput = z.object({
  reason: z.string().min(5, "A descriptive reason of at least 5 characters is required to tick the market."),
}).strict();

export class AdvanceMarketTickTool implements AgentTool<typeof AdvanceMarketTickInput, Record<string, number>> {
  readonly name = "advance_market_tick";
  readonly description = "Advance the market prices of BTC, ETH, and SOL by one deterministic tick.";
  readonly inputSchema = AdvanceMarketTickInput;
  readonly isReadOnly = false;
  readonly riskLevel = "LOW" as const;

  async execute(args: unknown): Promise<ToolResult<Record<string, number>>> {
    const parsed = this.inputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input validation failed for advance_market_tick.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      };
    }

    try {
      const nextPrices = await triggerTick();
      return {
        success: true,
        data: nextPrices,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: error?.message || "Failed to advance the market tick.",
        },
      };
    }
  }
}
