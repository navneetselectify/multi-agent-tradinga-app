import { z } from "zod";

/**
 * Granular permissions governing tool access across agent roles.
 */
export type Permission = "portfolio.read" | "market.advance" | "trade.execute";

export const PERMISSIONS = [
  "portfolio.read",
  "market.advance",
  "trade.execute",
] as const;

/**
 * Minimal context representing an executing agent's identity and granted permissions.
 */
export interface AgentContext {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/**
 * Predefined minimal agent roles.
 */
export const RISK_REVIEWER_AGENT: AgentContext = {
  id: "risk-reviewer",
  name: "Risk Reviewer",
  permissions: ["portfolio.read"],
};

export const TRADING_AGENT: AgentContext = {
  id: "trading-agent",
  name: "Trading Agent",
  permissions: ["portfolio.read", "market.advance", "trade.execute"],
};

export const AGENT_ROLES = {
  riskReviewer: RISK_REVIEWER_AGENT,
  tradingAgent: TRADING_AGENT,
} as const;

/**
 * Metadata contract that an Agent consumes to understand and discover capabilities.
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodObject<any>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInput;
  readonly isReadOnly: boolean;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly requiredPermission?: Permission;
}

/**
 * Execution payload wrapper returned to the Agent cognitive layer.
 */
export interface ToolResult<TOutput = any> {
  success: boolean;
  data?: TOutput;
  error?: {
    code: string;       // e.g., "VALIDATION_ERROR" | "BUSINESS_RULE_VIOLATION" | "SYSTEM_ERROR" | "TOOL_NOT_FOUND" | "TOOL_NOT_ALLOWED" | "PERMISSION_DENIED"
    message: string;    // Human-readable message
    details?: string[]; // Nested schema validation fields or rules violated
  };
}

/**
 * Complete Agent Tool contract containing both declaration and runtime execution handler.
 */
export interface AgentTool<TInput extends z.ZodTypeAny = z.ZodObject<any>, TOutput = any>
  extends ToolDefinition<TInput> {
  /**
   * Safe execution entry point. Ensures typed arguments are passed after schema validation.
   */
  execute(args: unknown): Promise<ToolResult<TOutput>>;
}
