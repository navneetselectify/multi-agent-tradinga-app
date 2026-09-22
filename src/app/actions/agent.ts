"use server";

import { AgentExecutor } from "@/lib/agent/executor";
import { ToolRegistry } from "@/lib/agent/registry";
import {
  GetPortfolioAndMarketStateTool,
  AdvanceMarketTickTool,
  ExecuteAssetTradeTool,
} from "@/lib/agent/tools";

export interface AgentExecutionStep {
  stepNumber: number;
  toolName: string;
  arguments: any;
  success: boolean;
  resultSummary: string;
}

export interface AgentExecutionResult {
  success: boolean;
  finalResponse: string;
  steps: AgentExecutionStep[];
}

function summarizeResult(stepResult: { success: boolean; data?: any; error?: { code: string; message: string; details?: string[] } }): string {
  if (stepResult.success) {
    if (stepResult.data !== undefined) {
      try {
        const json = JSON.stringify(stepResult.data);
        return json.length > 300 ? json.substring(0, 300) + "…" : json;
      } catch {
        return String(stepResult.data);
      }
    }
    return "No data returned";
  }
  if (stepResult.error) {
    return `[${stepResult.error.code}] ${stepResult.error.message}`;
  }
  return "Unknown error";
}

/**
 * Server Action: Execute a natural-language instruction through the AgentExecutor.
 *
 * Boundary:
 *   Browser UI → Server Action (askAgent) → AgentExecutor → Gemini → ToolRegistry → Tools → Use Cases → DB/Services
 */
export async function askAgent(instruction: string): Promise<AgentExecutionResult> {
  if (!instruction || typeof instruction !== "string" || instruction.trim() === "") {
    return {
      success: false,
      finalResponse: "Invalid input: Please provide a non-empty instruction.",
      steps: [],
    };
  }

  const registry = new ToolRegistry();
  registry.register(new GetPortfolioAndMarketStateTool());
  registry.register(new AdvanceMarketTickTool());
  registry.register(new ExecuteAssetTradeTool());

  const executor = new AgentExecutor(registry);

  try {
    const result = await executor.execute(instruction.trim(), 5);

    return {
      success: result.success,
      finalResponse: result.finalResponse,
      steps: result.steps.map((step, index) => ({
        stepNumber: index + 1,
        toolName: step.toolName,
        arguments: step.arguments,
        success: step.result.success,
        resultSummary: summarizeResult(step.result),
      })),
    };
  } catch {
    return {
      success: false,
      finalResponse: "An error occurred while executing the agent. Please try again.",
      steps: [],
    };
  }
}
