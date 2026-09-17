import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "../registry";
import { AgentTool, ToolResult } from "../types";
import { z } from "zod";

describe("Tool Registry Unit Tests", () => {
  let registry: ToolRegistry;

  // Mock tools for isolated registry tests
  class MockReadTool implements AgentTool<any, string> {
    readonly name = "mock_read_tool";
    readonly description = "A simple read-only tool.";
    readonly inputSchema = z.object({}).strict();
    readonly isReadOnly = true;
    readonly riskLevel = "LOW" as const;

    async execute(args: unknown): Promise<ToolResult<string>> {
      return { success: true, data: "read success" };
    }
  }

  class MockWriteTool implements AgentTool<any, string> {
    readonly name = "mock_write_tool";
    readonly description = "A state-changing high-risk tool.";
    readonly inputSchema = z.object({ value: z.string() }).strict();
    readonly isReadOnly = false;
    readonly riskLevel = "HIGH" as const;

    async execute(args: any): Promise<ToolResult<string>> {
      return { success: true, data: `write success with ${args.value}` };
    }
  }

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should successfully register a unique tool", () => {
    const tool = new MockReadTool();
    registry.register(tool);

    expect(registry.get("mock_read_tool")).toBe(tool);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("should reject duplicate tool registration with an error", () => {
    const tool1 = new MockReadTool();
    const tool2 = new MockReadTool();

    registry.register(tool1);
    expect(() => registry.register(tool2)).toThrow(
      'Duplicate tool registration: A tool named "mock_read_tool" is already registered.'
    );
  });

  it("should discover all registered tools and their metadata correctly", () => {
    const readTool = new MockReadTool();
    const writeTool = new MockWriteTool();

    registry.register(readTool);
    registry.register(writeTool);

    const tools = registry.getAll();
    expect(tools).toHaveLength(2);

    const matchRead = tools.find((t) => t.name === "mock_read_tool");
    expect(matchRead).toBeDefined();
    expect(matchRead?.isReadOnly).toBe(true);
    expect(matchRead?.riskLevel).toBe("LOW");

    const matchWrite = tools.find((t) => t.name === "mock_write_tool");
    expect(matchWrite).toBeDefined();
    expect(matchWrite?.isReadOnly).toBe(false);
    expect(matchWrite?.riskLevel).toBe("HIGH");
  });

  it("should return TOOL_NOT_FOUND error when executing an unknown tool name", async () => {
    const res = await registry.executeTool("unregistered_tool", {});

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("TOOL_NOT_FOUND");
    expect(res.error?.message).toContain('Requested tool "unregistered_tool" does not exist.');
    expect(res.error?.details).toHaveLength(1);
    expect(res.error?.details?.[0]).toContain("Available tools:");
  });

  it("should catch unexpected handler throws and format them as SYSTEM_ERROR", async () => {
    const brokenTool: AgentTool<any, any> = {
      name: "broken_tool",
      description: "Threw an unhandled error.",
      inputSchema: z.object({}).strict(),
      isReadOnly: false,
      riskLevel: "MEDIUM" as const,
      execute: async () => {
        throw new Error("Unhandled stack crash!");
      },
    };

    registry.register(brokenTool);
    const res = await registry.executeTool("broken_tool", {});

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("SYSTEM_ERROR");
    expect(res.error?.message).toBe("Unhandled stack crash!");
  });
});
