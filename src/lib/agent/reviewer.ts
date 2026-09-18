import { RiskVerdictSchema, TradeProposal } from "./contracts";
import { RiskAssessment, RiskState } from "@/lib/exchange/riskService";
import { OrderResult } from "@/lib/exchange/service";
import { AgentRole, RISK_REVIEWER_ROLE } from "./roles";
import { AgentExecutor } from "./executor";
import { ToolRegistry } from "./registry";
import {
  GetPortfolioAndMarketStateTool,
  AdvanceMarketTickTool,
  ExecuteAssetTradeTool,
} from "./tools";
import { TradingCycleDependencies } from "@/lib/usecases/runTradingCycle";

export interface ReviewAdapterOptions {
  executor?: AgentExecutor;
  parentRegistry?: ToolRegistry;
  role?: AgentRole;
  reviewTimeoutMs?: number;
}

/**
 * Creates a standard full ToolRegistry containing the system's tools.
 * Scoped registries derive from this instance to enforce role permissions.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new GetPortfolioAndMarketStateTool());
  registry.register(new AdvanceMarketTickTool());
  registry.register(new ExecuteAssetTradeTool());
  return registry;
}

/**
 * Builds a clear reviewer prompt from the proposed trade and hard-risk facts.
 */
export function buildReviewerPrompt(
  proposal: TradeProposal,
  hardRisk: RiskAssessment
): string {
  return [
    "Review the following proposed trade against deterministic hard risk facts.",
    "",
    "Trade Proposal:",
    `- Symbol: ${proposal.symbol}`,
    `- Action: ${proposal.action}`,
    `- Quantity: ${proposal.quantity}`,
    `- Confidence: ${proposal.confidence}`,
    `- Reason: ${proposal.reason}`,
    "",
    "Hard Risk Assessment Facts:",
    `- Allowed by Hard Rules: ${hardRisk.allowed}`,
    `- Execution Price: ${hardRisk.executionPrice !== null ? hardRisk.executionPrice : "N/A"}`,
    `- Estimated Value: ${hardRisk.estimatedValue !== null ? hardRisk.estimatedValue : "N/A"}`,
    `- Issues / Failure Reasons: ${hardRisk.reasons.length > 0 ? hardRisk.reasons.join("; ") : "None"}`,
    "",
    "Respond with ONLY a valid JSON object matching the RiskVerdict contract (APPROVE, REJECT, or ADJUST).",
  ].join("\n");
}

/**
 * Extracts and parses JSON from the model's text response.
 * Strips optional markdown formatting if present.
 */
export function parseReviewerOutput(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Unable to parse reviewer response as JSON.");
  }
}

/**
 * Adapter producing a review function conforming to deps.review(proposal, hardRisk).
 * Runs AgentExecutor configured with the reviewer role and a scoped registry.
 * Malformed responses return a structured failure that triggers an orchestrator abort.
 * Supports an optional reviewTimeoutMs to abort runaway reviewer executions.
 */
export function createRiskReviewer(
  options: ReviewAdapterOptions = {}
): (proposal: TradeProposal, hardRisk: RiskAssessment) => Promise<unknown> {
  const role = options.role ?? RISK_REVIEWER_ROLE;
  const parentRegistry = options.parentRegistry ?? createDefaultToolRegistry();
  const scopedRegistry = parentRegistry.scoped(role.allowedToolNames);
  const executor =
    options.executor ??
    new AgentExecutor(scopedRegistry, {
      systemInstruction: role.systemInstruction,
    });
  const timeoutMs = options.reviewTimeoutMs;

  return async (proposal: TradeProposal, hardRisk: RiskAssessment): Promise<unknown> => {
    const prompt = buildReviewerPrompt(proposal, hardRisk);

    const executeReview = async (): Promise<unknown> => {
      const agentResult = await executor.execute(prompt, 3);

      if (!agentResult.success) {
        return {
          error: "AGENT_EXECUTION_FAILED",
          message: agentResult.finalResponse,
        };
      }

      let parsedJson: unknown;
      try {
        parsedJson = parseReviewerOutput(agentResult.finalResponse);
      } catch {
        return {
          error: "INVALID_JSON",
          message: "Risk reviewer output could not be parsed as JSON.",
          raw: agentResult.finalResponse,
        };
      }

      const verdictResult = RiskVerdictSchema.safeParse(parsedJson);
      if (!verdictResult.success) {
        return {
          error: "SCHEMA_VALIDATION_FAILED",
          message: "Risk reviewer output does not conform to RiskVerdict schema.",
          details: verdictResult.error.issues,
          raw: parsedJson,
        };
      }

      return verdictResult.data;
    };

    if (timeoutMs !== undefined && timeoutMs > 0) {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Risk review timed out after ${timeoutMs}ms.`));
          }, timeoutMs);
        });
        return await Promise.race([executeReview(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return await executeReview();
  };
}

export interface BuildTradingCycleDependenciesOptions {
  propose: () => Promise<unknown>;
  review?: (proposal: TradeProposal, hardRisk: RiskAssessment) => Promise<unknown>;
  getState?: () => Promise<RiskState>;
  execute?: (symbol: string, side: "BUY" | "SELL", quantity: number) => Promise<OrderResult>;
  reviewerOptions?: ReviewAdapterOptions;
  reviewTimeoutMs?: number;
}

/**
 * Factory creating TradingCycleDependencies with the Risk Reviewer adapter wired.
 * Callers MUST explicitly provide `propose`; trading cycle cannot invent trades.
 */
export function buildTradingCycleDependencies(
  options: BuildTradingCycleDependenciesOptions
): TradingCycleDependencies {
  if (!options || typeof options.propose !== "function") {
    throw new Error(
      "Missing proposal provider: 'propose' must be explicitly provided. The trading cycle cannot invent trades."
    );
  }

  const timeout = options.reviewTimeoutMs ?? options.reviewerOptions?.reviewTimeoutMs;
  const review =
    options.review ??
    createRiskReviewer({
      ...options.reviewerOptions,
      ...(timeout !== undefined ? { reviewTimeoutMs: timeout } : {}),
    });

  return {
    propose: options.propose,
    review,
    ...(options.getState ? { getState: options.getState } : {}),
    ...(options.execute ? { execute: options.execute } : {}),
    ...(timeout !== undefined ? { reviewTimeoutMs: timeout } : {}),
  };
}
