import { AgentTool, ToolResult } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<any, any>>();

  /**
   * Registers a tool. Throws if a tool with the same name is already registered.
   */
  public register(tool: AgentTool<any, any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Looks up a tool by its unique name.
   */
  public get(name: string): AgentTool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns a list of all registered tools.
   */
  public getAll(): AgentTool<any, any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Orchestrates tool lookup, input validation, execution, and error handling.
   * Returns a standardized ToolResult structure under all execution conditions.
   */
  public async executeTool(name: string, args: unknown): Promise<ToolResult<any>> {
    const tool = this.get(name);

    if (!tool) {
      return {
        success: false,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Requested tool "${name}" does not exist.`,
          details: [`Available tools: ${Array.from(this.tools.keys()).join(", ")}`],
        },
      };
    }

    try {
      return await tool.execute(args);
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "SYSTEM_ERROR",
          message: error?.message || "An unexpected system error occurred during execution.",
        },
      };
    }
  }
}
