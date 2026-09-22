import { z } from "zod";
import { AgentTool, ToolResult } from "../types";
import { triggerTick } from "@/app/actions/trading";

export const AdvanceMarketInput = z.object({}).strict();

export class AdvanceMarketTool implements AgentTool<typeof AdvanceMarketInput, Record<string, number>> {
  readonly name = "advance_market";
  readonly description = "Advance simulated market prices by one deterministic tick and persist new rates.";
  readonly inputSchema = AdvanceMarketInput;
  readonly isReadOnly = false;
  readonly riskLevel = "MEDIUM" as const;
  readonly requiredPermission = "market.advance" as const;

  async execute(args: unknown = {}): Promise<ToolResult<Record<string, number>>> {
    const parsed = this.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input validation failed for advance_market.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      };
    }

    try {
      const data = await triggerTick();
      return {
        success: true,
        data,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to advance market.";
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
