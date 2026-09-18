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
