import { z } from "zod";

/**
 * Metadata contract that an Agent consumes to understand and discover capabilities.
 */
export interface ToolDefinition<TInput extends z.ZodObject<any> = z.ZodObject<any>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInput;
  readonly isReadOnly: boolean;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Execution payload wrapper returned to the Agent cognitive layer.
 */
export interface ToolResult<TOutput = any> {
  success: boolean;
  data?: TOutput;
  error?: {
    code: string;       // e.g., "VALIDATION_ERROR" | "BUSINESS_RULE_VIOLATION" | "SYSTEM_ERROR" | "TOOL_NOT_FOUND" | "TOOL_NOT_ALLOWED"
    message: string;    // Human-readable message
    details?: string[]; // Nested schema validation fields or rules violated
  };
}

/**
 * Complete Agent Tool contract containing both declaration and runtime execution handler.
 */
export interface AgentTool<TInput extends z.ZodObject<any> = z.ZodObject<any>, TOutput = any> 
  extends ToolDefinition<TInput> {
  /**
   * Safe execution entry point. Ensures typed arguments are passed after schema validation.
   */
  execute(args: unknown): Promise<ToolResult<TOutput>>;
}
