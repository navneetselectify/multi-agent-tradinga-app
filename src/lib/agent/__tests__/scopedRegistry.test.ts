import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../registry";
import { AgentTool, ToolResult } from "../types";
import { AgentRole } from "../roles";

function createTool(name: string, isReadOnly: boolean) {
  const execute = vi.fn(
    async (): Promise<ToolResult<string>> => ({ success: true, data: `${name} executed` })
  );
  const tool: AgentTool<any, string> = {
    name,
    description: `Mock tool for ${name}.`,
    inputSchema: z.object({}).strict(),
    isReadOnly,
    riskLevel: isReadOnly ? "LOW" : "HIGH",
    execute,
  };
  return { tool, execute };
}

describe("Scoped Tool Registry (Least Privilege)", () => {
  let registry: ToolRegistry;
  let portfolio: ReturnType<typeof createTool>;
  let tick: ReturnType<typeof createTool>;
  let trade: ReturnType<typeof createTool>;

  beforeEach(() => {
    registry = new ToolRegistry();
    portfolio = createTool("get_portfolio_and_market_state", true);
    tick = createTool("advance_market_tick", false);
    trade = createTool("execute_asset_trade", false);

    registry.register(portfolio.tool);
    registry.register(tick.tool);
    registry.register(trade.tool);
  });

  it("should expose only allowed tools through getAll() in declared order", () => {
    const scope = registry.scoped(["advance_market_tick", "get_portfolio_and_market_state"]);

    expect(scope.getAll().map((tool) => tool.name)).toEqual([
      "advance_market_tick",
      "get_portfolio_and_market_state",
    ]);
  });

  it("should return allowed tool instances and hide disallowed and unknown tools from get()", () => {
    const scope = registry.scoped(["get_portfolio_and_market_state"]);

    expect(scope.get("get_portfolio_and_market_state")).toBe(portfolio.tool);
    expect(scope.get("advance_market_tick")).toBeUndefined();
    expect(scope.get("execute_asset_trade")).toBeUndefined();
    expect(scope.get("unknown_tool")).toBeUndefined();
  });

  it("should share tool implementations with the parent without duplication", () => {
    const scope = registry.scoped(["execute_asset_trade"]);

    expect(scope.get("execute_asset_trade")).toBe(registry.get("execute_asset_trade"));
  });

  it("should execute allowed tools through the shared parent implementation", async () => {
    const scope = registry.scoped(["get_portfolio_and_market_state"]);

    const result = await scope.executeTool("get_portfolio_and_market_state", {});

    expect(result.success).toBe(true);
    expect(result.data).toBe("get_portfolio_and_market_state executed");
    expect(portfolio.execute).toHaveBeenCalledTimes(1);
  });

  it("should reject disallowed tools with TOOL_NOT_ALLOWED and never execute them", async () => {
    const scope = registry.scoped(["get_portfolio_and_market_state"]);

    const result = await scope.executeTool("execute_asset_trade", {
      symbol: "BTC",
      side: "BUY",
      quantity: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
    expect(result.error?.message).toContain('Tool "execute_asset_trade" is not allowed for this agent role.');
    expect(result.error?.details?.[0]).toBe("Allowed tools: get_portfolio_and_market_state");
    expect(trade.execute).not.toHaveBeenCalled();
  });

  it("should never disclose disallowed tool names in scoped error details", async () => {
    const scope = registry.scoped(["get_portfolio_and_market_state"]);

    const denied = await scope.executeTool("execute_asset_trade", {});
    const notFound = await scope.executeTool("nonexistent_tool", {});

    const details = JSON.stringify([denied.error?.details, notFound.error?.details]);
    expect(details).not.toContain("advance_market_tick");
    expect(details).not.toContain("execute_asset_trade");
  });

  it("should keep existing TOOL_NOT_FOUND behavior for unknown tools", async () => {
    const scope = registry.scoped(["get_portfolio_and_market_state"]);

    const result = await scope.executeTool("unregistered_tool", {});

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
    expect(result.error?.message).toContain('Requested tool "unregistered_tool" does not exist.');
    expect(result.error?.details?.[0]).toBe("Available tools: get_portfolio_and_market_state");
  });

  it("should treat a role-allowed name that is not registered as TOOL_NOT_FOUND", async () => {
    const scope = registry.scoped(["ghost_tool"]);

    const result = await scope.executeTool("ghost_tool", {});

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("should support an empty scope that allows nothing", async () => {
    const scope = registry.scoped([]);

    expect(scope.getAll()).toEqual([]);
    const result = await scope.executeTool("get_portfolio_and_market_state", {});
    expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
  });

  it("should not mutate the parent registry when creating a scope", () => {
    registry.scoped(["get_portfolio_and_market_state"]);

    expect(registry.getAll().map((tool) => tool.name)).toEqual([
      "get_portfolio_and_market_state",
      "advance_market_tick",
      "execute_asset_trade",
    ]);
    expect(registry.get("execute_asset_trade")).toBe(trade.tool);
  });

  it("should enforce least privilege for role definitions", async () => {
    const analystRole: AgentRole = {
      name: "analyst",
      systemInstruction: "You are a read-only market analyst.",
      allowedToolNames: ["get_portfolio_and_market_state"],
    };
    const executorRole: AgentRole = {
      name: "executor",
      systemInstruction: "You may only execute approved trades.",
      allowedToolNames: ["execute_asset_trade"],
    };

    const analystScope = registry.scoped(analystRole.allowedToolNames);
    const executorScope = registry.scoped(executorRole.allowedToolNames);

    expect(analystScope.getAll().map((tool) => tool.name)).toEqual(["get_portfolio_and_market_state"]);
    expect(executorScope.getAll().map((tool) => tool.name)).toEqual(["execute_asset_trade"]);

    const analystTradeAttempt = await analystScope.executeTool("execute_asset_trade", {});
    expect(analystTradeAttempt.error?.code).toBe("TOOL_NOT_ALLOWED");
    expect(trade.execute).not.toHaveBeenCalled();

    const executorReadAttempt = await executorScope.executeTool("get_portfolio_and_market_state", {});
    expect(executorReadAttempt.error?.code).toBe("TOOL_NOT_ALLOWED");
    expect(portfolio.execute).not.toHaveBeenCalled();
  });
});
