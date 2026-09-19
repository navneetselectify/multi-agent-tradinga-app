import { z } from "zod";

/**
 * Handoff contracts for agent-to-agent data exchange.
 *
 * ARCHITECTURAL RULE: agent outputs are DATA, not authority. A valid
 * RiskVerdict of APPROVE is a review result only and must never authorize a
 * trade. Execution authority stays with deterministic policy/business logic.
 */

/**
 * Strict contract for a future Analyst -> Risk Reviewer handoff.
 */
export const TradeProposalSchema = z
  .object({
    action: z.enum(["BUY", "SELL"], {
      errorMap: () => ({ message: "Action must be one of: BUY, SELL." }),
    }),
    symbol: z.enum(["BTC", "ETH", "SOL"], {
      errorMap: () => ({ message: "Symbol must be one of: BTC, ETH, SOL." }),
    }),
    quantity: z.number().positive("Quantity must be strictly positive (> 0)."),
    confidence: z.number().min(0, "Confidence must be >= 0.").max(1, "Confidence must be <= 1."),
    reason: z.string().trim().min(1, "Reason must not be empty."),
  })
  .strict();

export type TradeProposal = z.infer<typeof TradeProposalSchema>;

const riskReasonSchema = z.string().trim().min(1, "Reason must not be empty.");

/**
 * Strict contract for a future Risk Reviewer result.
 * ADJUST carries only the adjusted quantity a future orchestrator would use.
 */
export const RiskVerdictSchema = z.discriminatedUnion("verdict", [
  z
    .object({
      verdict: z.literal("APPROVE"),
      reason: riskReasonSchema,
    })
    .strict(),
  z
    .object({
      verdict: z.literal("REJECT"),
      reason: riskReasonSchema,
    })
    .strict(),
  z
    .object({
      verdict: z.literal("ADJUST"),
      reason: riskReasonSchema,
      adjustedQuantity: z.number().positive("Adjusted quantity must be strictly positive (> 0)."),
    })
    .strict(),
]);

export type RiskVerdict = z.infer<typeof RiskVerdictSchema>;

/**
 * Strict contract for Market Analyst result.
 */
export const MarketResultSchema = z
  .object({
    marketConditions: z.string().trim().min(1, "Market conditions must not be empty."),
    externalFactors: z.array(z.string().trim().min(1)),
    signal: z.enum(["BUY", "SELL", "HOLD"], {
      errorMap: () => ({ message: "Signal must be one of: BUY, SELL, HOLD." }),
    }),
    confidence: z.number().min(0, "Confidence must be >= 0.").max(1, "Confidence must be <= 1."),
    reason: z.string().trim().min(1, "Reason must not be empty."),
  })
  .strict();

export type MarketResult = z.infer<typeof MarketResultSchema>;

/**
 * Strict contract for Risk Analyst result.
 */
export const RiskResultSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"], {
      errorMap: () => ({ message: "Status must be one of: APPROVED, REJECTED." }),
    }),
    reasons: z.array(z.string().trim().min(1)),
    riskFactors: z.array(z.string().trim().min(1)),
    topRisks: z.array(z.string().trim().min(1)),
  })
  .strict();

export type RiskResult = z.infer<typeof RiskResultSchema>;

/**
 * Strict contract for Portfolio Analyst result.
 */
export const PortfolioResultSchema = z
  .object({
    currentExposure: z.number(),
    tradeAmount: z.number().min(0, "tradeAmount must be >= 0."),
    portfolioImpact: z.string().trim().min(1, "portfolioImpact must not be empty."),
    relevantHistory: z.array(z.string()),
    confidence: z.number().min(0, "Confidence must be >= 0.").max(1, "Confidence must be <= 1."),
    reason: z.string().trim().min(1, "Reason must not be empty."),
  })
  .strict();

export type PortfolioResult = z.infer<typeof PortfolioResultSchema>;

/**
 * Analyst identifiers in the parallel fan-out architecture.
 */
export const AnalystIdSchema = z.enum(["market", "risk", "portfolio"]);
export type AnalystId = z.infer<typeof AnalystIdSchema>;

/**
 * Record of an analyst failure during parallel execution.
 */
export const AnalysisFailureSchema = z
  .object({
    analyst: AnalystIdSchema,
    reason: z.string().trim().min(1, "Failure reason must not be empty."),
  })
  .strict();

export type AnalysisFailure = z.infer<typeof AnalysisFailureSchema>;

/**
 * Strict contract for Aggregator combined analysis result.
 */
export const CombinedAnalysisSchema = z
  .object({
    status: z.enum(["COMPLETE", "INCOMPLETE"]),
    executionAllowed: z.boolean(),
    market: MarketResultSchema.nullable(),
    risk: RiskResultSchema.nullable(),
    portfolio: PortfolioResultSchema.nullable(),
    failures: z.array(AnalysisFailureSchema),
    reasons: z.array(z.string()),
    summary: z.string().optional(),
    action: z.enum(["BUY", "SELL", "HOLD"]).nullable().optional(),
  })
  .strict();

export type CombinedAnalysis = z.infer<typeof CombinedAnalysisSchema>;
