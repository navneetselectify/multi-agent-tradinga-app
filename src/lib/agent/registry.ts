import { AgentTool, ToolResult } from "./types";

/**
 * Read surface an Agent has over tools. AgentExecutor depends on this
 * interface so a full or role-scoped registry can be injected interchangeably.
 */
export interface ToolProvider {
  get(name: string): AgentTool<any, any> | undefined;
  getAll(): AgentTool<any, any>[];
  executeTool(name: string, args: unknown): Promise<ToolResult<any>>;
}

export class ToolRegistry implements ToolProvider {
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
   * Creates a restricted, read-only view containing only the named tools.
   * The parent registry is never mutated. Unknown names are ignored here and
   * surface as TOOL_NOT_FOUND when executed through the scope.
   */
  public scoped(allowedToolNames: readonly string[]): ScopedToolRegistry {
    return new ScopedToolRegistry(this, allowedToolNames);
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

/**
 * Least-privilege view over a parent tool registry.
 *
 * Tools outside the allowed set are invisible to get()/getAll() and rejected
 * by executeTool() with TOOL_NOT_ALLOWED. Tool implementations are shared with
 * the parent registry, never duplicated. Error details only ever disclose the
 * tools this scope allows.
 */
export class ScopedToolRegistry implements ToolProvider {
  private readonly parent: ToolProvider;
  private readonly allowedToolNames: ReadonlySet<string>;

  constructor(parent: ToolProvider, allowedToolNames: Iterable<string>) {
    this.parent = parent;
    this.allowedToolNames = new Set(allowedToolNames);
  }

  public get(name: string): AgentTool<any, any> | undefined {
    if (!this.allowedToolNames.has(name)) {
      return undefined;
    }
    return this.parent.get(name);
  }

  public getAll(): AgentTool<any, any>[] {
    const tools: AgentTool<any, any>[] = [];
    for (const name of this.allowedToolNames) {
      const tool = this.parent.get(name);
      if (tool) {
        tools.push(tool);
      }
    }
    return tools;
  }

  public async executeTool(name: string, args: unknown): Promise<ToolResult<any>> {
    if (this.get(name)) {
      return this.parent.executeTool(name, args);
    }

    if (this.parent.get(name)) {
      return {
        success: false,
        error: {
          code: "TOOL_NOT_ALLOWED",
          message: `Tool "${name}" is not allowed for this agent role.`,
          details: [`Allowed tools: ${this.allowedToolNames.size > 0 ? Array.from(this.allowedToolNames).join(", ") : "none"}`],
        },
      };
    }

    return {
      success: false,
      error: {
        code: "TOOL_NOT_FOUND",
        message: `Requested tool "${name}" does not exist.`,
        details: [`Available tools: ${Array.from(this.allowedToolNames).join(", ")}`],
      },
    };
  }
}
