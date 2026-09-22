import { AgentContext, AgentTool } from "../types";
import { GetPortfolioAndMarketStateTool, GetPortfolioAndMarketStateInput } from "./getPortfolioAndMarketState";
import { AdvanceMarketTickTool, AdvanceMarketTickInput } from "./advanceMarketTick";
import { ExecuteAssetTradeTool, ExecuteAssetTradeInput } from "./executeAssetTrade";
import { ExecuteTradeTool, ExecuteTradeInput } from "./executeTrade";
import { AdvanceMarketTool, AdvanceMarketInput } from "./advanceMarket";

export {
  GetPortfolioAndMarketStateTool,
  GetPortfolioAndMarketStateInput,
  AdvanceMarketTickTool,
  AdvanceMarketTickInput,
  ExecuteTradeTool,
  ExecuteTradeInput,
  ExecuteTradeTool as ExecuteAssetTradeTool,
  ExecuteTradeInput as ExecuteAssetTradeInput,
  AdvanceMarketTool,
  AdvanceMarketInput,
};

let _tools: readonly AgentTool[] | null = null;
function getOrCreateAllTools(): readonly AgentTool[] {
  if (!_tools) {
    _tools = [
      new GetPortfolioAndMarketStateTool(),
      new AdvanceMarketTool(),
      new ExecuteTradeTool(),
    ];
  }
  return _tools;
}

/**
 * Standard catalog of all registered agent tools.
 */
export const ALL_TOOLS: readonly AgentTool[] = new Proxy([] as any, {
  get(target, prop, receiver) {
    const tools = getOrCreateAllTools();
    const val = Reflect.get(tools, prop, receiver);
    if (typeof val === "function") {
      return val.bind(tools);
    }
    return val;
  },
});

/**
 * Scoped tool architecture: returns the subset of registered tools permitted for a specific agent.
 */
export function getToolsForAgent(agent: AgentContext): AgentTool[] {
  return getOrCreateAllTools().filter(
    (tool) => tool.requiredPermission && agent.permissions.includes(tool.requiredPermission)
  ) as AgentTool[];
}
