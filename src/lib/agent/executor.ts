import { z } from "zod";
import { AgentContext, AgentTool, ToolResult, Permission } from "./types";

/**
 * Checks whether an agent has been granted a specific permission.
 */
export function hasPermission(agent: AgentContext, permission: Permission): boolean {
  return agent.permissions.includes(permission);
}

/**
 * Centralized tool execution dispatcher enforcing permission checks BEFORE tool.execute().
 *
 * If the agent lacks the required permission:
 * - Immediately returns { success: false, error: { code: "PERMISSION_DENIED", ... } }
 * - Schema validation, database operations, and side effects are completely bypassed.
 */
export async function executeTool<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = unknown>(
  tool: AgentTool<TInput, TOutput>,
  agent: AgentContext,
  args: unknown
): Promise<ToolResult<TOutput>> {
  if (!hasPermission(agent, tool.requiredPermission)) {
    return {
      success: false,
      error: {
        code: "PERMISSION_DENIED",
        message: `Agent "${agent.name}" (${agent.id}) lacks required permission "${tool.requiredPermission}" for tool "${tool.name}".`,
        details: [
          `Required: ${tool.requiredPermission}`,
          `Granted: ${agent.permissions.join(", ") || "none"}`,
        ],
      },
    };
  }

  return await tool.execute(args);
}
