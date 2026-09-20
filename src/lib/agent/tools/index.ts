import { AgentContext, AgentTool } from "../types";
import { GetPortfolioAndMarketStateTool } from "./getPortfolioAndMarketState";
import { ExecuteTradeTool } from "./executeTrade";
import { AdvanceMarketTool } from "./advanceMarket";

export { GetPortfolioAndMarketStateTool, GetPortfolioAndMarketStateInput } from "./getPortfolioAndMarketState";
export { ExecuteTradeTool, ExecuteTradeInput, ExecuteAssetTradeTool } from "./executeTrade";
export { AdvanceMarketTool, AdvanceMarketInput } from "./advanceMarket";

/**
 * Standard catalog of all registered agent tools.
 */
export const ALL_TOOLS: readonly AgentTool[] = [
  new GetPortfolioAndMarketStateTool(),
  new AdvanceMarketTool(),
  new ExecuteTradeTool(),
] as const;

/**
 * Scoped tool architecture: returns the subset of registered tools permitted for a specific agent.
 */
export function getToolsForAgent(agent: AgentContext): AgentTool[] {
  return ALL_TOOLS.filter((tool) => agent.permissions.includes(tool.requiredPermission));
}
