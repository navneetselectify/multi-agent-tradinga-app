import { describe, it, expect, vi } from "vitest";
import {
  RISK_REVIEWER_ROLE,
  createDefaultToolRegistry,
  createRiskReviewer,
  buildReviewerPrompt,
  parseReviewerOutput,
  buildTradingCycleDependencies,
} from "../index";
import { AgentExecutor, AgentExecutorConfig, DEFAULT_SYSTEM_INSTRUCTION } from "../executor";
import { ToolProvider } from "../registry";
import { TradeProposal } from "../contracts";
import { RiskAssessment } from "@/lib/exchange/riskService";
import { runTradingCycle } from "@/lib/usecases/runTradingCycle";

const mockProposal: TradeProposal = {
  symbol: "BTC",
  action: "BUY",
  quantity: 1,
  confidence: 0.85,
  reason: "Strong upward momentum above 200 EMA.",
};

const mockHardRisk: RiskAssessment = {
  allowed: true,
  reasons: [],
  executionPrice: 65000,
  estimatedValue: 65000,
};

describe("Risk Reviewer Agent & Role", () => {
  describe("Role Configuration & Least Privilege", () => {
    it("has name 'risk_reviewer' and empty allowedToolNames", () => {
      expect(RISK_REVIEWER_ROLE.name).toBe("risk_reviewer");
      expect(RISK_REVIEWER_ROLE.allowedToolNames).toEqual([]);
    });

    it("has a focused system instruction emphasizing RiskVerdict output and no trade execution", () => {
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("Risk Reviewer Agent");
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("RiskVerdict");
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("APPROVE");
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("REJECT");
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("ADJUST");
      expect(RISK_REVIEWER_ROLE.systemInstruction).toContain("do NOT execute trades");
    });

    it("scoped registry denies visibility to write tools", () => {
      const fullRegistry = createDefaultToolRegistry();
      const reviewerRegistry = fullRegistry.scoped(RISK_REVIEWER_ROLE.allowedToolNames);

      expect(reviewerRegistry.getAll()).toEqual([]);
      expect(reviewerRegistry.get("execute_asset_trade")).toBeUndefined();
      expect(reviewerRegistry.get("advance_market_tick")).toBeUndefined();
      expect(reviewerRegistry.get("get_portfolio_and_market_state")).toBeUndefined();
    });

    it("scoped registry rejects write tools with TOOL_NOT_ALLOWED", async () => {
      const fullRegistry = createDefaultToolRegistry();
      const reviewerRegistry = fullRegistry.scoped(RISK_REVIEWER_ROLE.allowedToolNames);

      const tradeResult = await reviewerRegistry.executeTool("execute_asset_trade", {
        symbol: "BTC",
        side: "BUY",
        quantity: 1,
      });
      expect(tradeResult.success).toBe(false);
      expect(tradeResult.error?.code).toBe("TOOL_NOT_ALLOWED");
      expect(tradeResult.error?.message).toContain("Tool \"execute_asset_trade\" is not allowed");

      const tickResult = await reviewerRegistry.executeTool("advance_market_tick", {});
      expect(tickResult.success).toBe(false);
      expect(tickResult.error?.code).toBe("TOOL_NOT_ALLOWED");
    });
  });

  describe("Reviewer Prompt Builder & Output Parser", () => {
    it("builds a clear prompt containing proposal details and hard-risk facts", () => {
      const prompt = buildReviewerPrompt(mockProposal, mockHardRisk);

      expect(prompt).toContain("Symbol: BTC");
      expect(prompt).toContain("Action: BUY");
      expect(prompt).toContain("Quantity: 1");
      expect(prompt).toContain("Confidence: 0.85");
      expect(prompt).toContain("Allowed by Hard Rules: true");
      expect(prompt).toContain("Execution Price: 65000");
      expect(prompt).toContain("Estimated Value: 65000");
    });

    it("parses pure JSON string", () => {
      const parsed = parseReviewerOutput('{"verdict": "APPROVE", "reason": "Healthy margin"}');
      expect(parsed).toEqual({ verdict: "APPROVE", reason: "Healthy margin" });
    });

    it("parses JSON enclosed in markdown code fences", () => {
      const input = "```json\n{\"verdict\": \"REJECT\", \"reason\": \"Market overextended\"}\n```";
      const parsed = parseReviewerOutput(input);
      expect(parsed).toEqual({ verdict: "REJECT", reason: "Market overextended" });
    });

    it("parses JSON embedded in conversational text by extracting outer braces", () => {
      const input = "Here is my evaluation:\n{\"verdict\": \"APPROVE\", \"reason\": \"Adequate cash\"}\nThank you.";
      const parsed = parseReviewerOutput(input);
      expect(parsed).toEqual({ verdict: "APPROVE", reason: "Adequate cash" });
    });

    it("throws when no JSON structure can be found", () => {
      expect(() => parseReviewerOutput("I approve of this trade because it looks good.")).toThrow(
        "Unable to parse reviewer response as JSON."
      );
    });
  });

  describe("Review Adapter with Mock Executor", () => {
    function makeMockExecutor(response: {
      success: boolean;
      finalResponse: string;
    }): AgentExecutor {
      return {
        execute: vi.fn().mockResolvedValue(response),
      } as unknown as AgentExecutor;
    }

    it("parses and returns a valid APPROVE verdict", async () => {
      const mockExecutor = makeMockExecutor({
        success: true,
        finalResponse: '{"verdict": "APPROVE", "reason": "Portfolio risk is well-balanced."}',
      });

      const reviewer = createRiskReviewer({ executor: mockExecutor });
      const verdict = await reviewer(mockProposal, mockHardRisk);

      expect(verdict).toEqual({
        verdict: "APPROVE",
        reason: "Portfolio risk is well-balanced.",
      });
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it("parses and returns a valid REJECT verdict", async () => {
      const mockExecutor = makeMockExecutor({
        success: true,
        finalResponse: '{"verdict": "REJECT", "reason": "Overexposure to crypto assets."}',
      });

      const reviewer = createRiskReviewer({ executor: mockExecutor });
      const verdict = await reviewer(mockProposal, mockHardRisk);

      expect(verdict).toEqual({
        verdict: "REJECT",
        reason: "Overexposure to crypto assets.",
      });
    });

    it("parses and returns a valid ADJUST verdict with adjustedQuantity", async () => {
      const mockExecutor = makeMockExecutor({
        success: true,
        finalResponse:
          '{"verdict": "ADJUST", "reason": "Position too large for current volatility.", "adjustedQuantity": 0.25}',
      });

      const reviewer = createRiskReviewer({ executor: mockExecutor });
      const verdict = await reviewer(mockProposal, mockHardRisk);

      expect(verdict).toEqual({
        verdict: "ADJUST",
        reason: "Position too large for current volatility.",
        adjustedQuantity: 0.25,
      });
    });

    it("handles garbage model output without silent APPROVE", async () => {
      const garbageResponses = [
        "I think buying 1 BTC is a great idea!",
        '{"verdict": "MAYBE", "reason": "Uncertain market"}',
        '{"verdict": "ADJUST", "reason": "Missing adjustedQuantity"}',
        '{"verdict": "ADJUST", "reason": "Negative quantity", "adjustedQuantity": -0.5}',
        '{ broken json }',
      ];

      for (const response of garbageResponses) {
        const mockExecutor = makeMockExecutor({
          success: true,
          finalResponse: response,
        });

        const reviewer = createRiskReviewer({ executor: mockExecutor });
        const result = (await reviewer(mockProposal, mockHardRisk)) as Record<string, unknown>;

        expect(result.verdict).toBeUndefined();
        expect(result.error).toBeDefined();
      }
    });

    it("handles executor execution failure gracefully", async () => {
      const mockExecutor = makeMockExecutor({
        success: false,
        finalResponse: "API Error: Resource exhausted",
      });

      const reviewer = createRiskReviewer({ executor: mockExecutor });
      const result = (await reviewer(mockProposal, mockHardRisk)) as Record<string, unknown>;

      expect(result).toEqual({
        error: "AGENT_EXECUTION_FAILED",
        message: "API Error: Resource exhausted",
      });
    });

    it("instantiates executor with reviewer system instruction, not default trading assistant prompt", () => {
      let capturedInstruction: string | undefined;

      class TestExecutor extends AgentExecutor {
        constructor(registry: ToolProvider, config?: AgentExecutorConfig) {
          super(registry, config);
          capturedInstruction = config?.systemInstruction;
        }
      }

      // Test default creation
      createRiskReviewer({
        executor: new TestExecutor(createDefaultToolRegistry().scoped([]), {
          systemInstruction: RISK_REVIEWER_ROLE.systemInstruction,
        }),
      });

      expect(capturedInstruction).toBe(RISK_REVIEWER_ROLE.systemInstruction);
      expect(capturedInstruction).not.toBe(DEFAULT_SYSTEM_INSTRUCTION);
    });

    it("aborts review when execution exceeds reviewTimeoutMs", async () => {
      const hangingExecutor: AgentExecutor = {
        execute: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve({ success: true, finalResponse: '{"verdict": "APPROVE", "reason": "Late"}' });
              }, 100);
            })
        ),
      } as unknown as AgentExecutor;

      const reviewer = createRiskReviewer({
        executor: hangingExecutor,
        reviewTimeoutMs: 20,
      });

      await expect(reviewer(mockProposal, mockHardRisk)).rejects.toThrow(
        "Risk review timed out after 20ms."
      );
    });

    it("aborts orchestrator trading cycle when review adapter encounters garbage output", async () => {
      const mockExecutor = makeMockExecutor({
        success: true,
        finalResponse: "Sure, let's go ahead and buy!",
      });

      const reviewer = createRiskReviewer({ executor: mockExecutor });

      const report = await runTradingCycle({
        propose: async () => mockProposal,
        review: reviewer,
        getState: async () => ({
          cash: 100000,
          holdings: [],
          prices: { BTC: 65000, ETH: 3000, SOL: 150 },
        }),
        execute: vi.fn(),
      });

      expect(report.outcome).toBe("ABORTED");
      expect(report.reason).toBe("Risk verdict failed contract validation.");
      expect(report.verdict).toBeNull();
    });
  });

  describe("buildTradingCycleDependencies wiring helper", () => {
    it("fails fast at construction if propose is missing (cannot invent trades on its own)", () => {
      expect(() =>
        buildTradingCycleDependencies({} as unknown as { propose: () => Promise<unknown> })
      ).toThrow("Missing proposal provider: 'propose' must be explicitly provided.");
    });

    it("wires injected propose and reviewer adapter correctly", async () => {
      const customPropose = vi.fn(async () => mockProposal);
      const customExecute = vi.fn();

      const deps = buildTradingCycleDependencies({
        propose: customPropose,
        execute: customExecute,
        reviewTimeoutMs: 1500,
      });

      expect(deps.propose).toBe(customPropose);
      expect(deps.execute).toBe(customExecute);
      expect(deps.reviewTimeoutMs).toBe(1500);
      expect(typeof deps.review).toBe("function");

      const proposal = await deps.propose();
      expect(proposal).toEqual(mockProposal);
    });
  });
});
