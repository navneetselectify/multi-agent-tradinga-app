import {
  AnalysisCollaborators,
  buildTradingCycleDependencies,
  OrchestratedRunInput,
  OrchestratedTradingReport,
  OrchestratedTradingReportSchema,
  TradeProposal,
  synthesizeProposal,
} from "@/lib/agent";
import { RiskAssessment, RiskState } from "@/lib/exchange/riskService";
import { OrderResult } from "@/lib/exchange/service";
import { runParallelTradingAnalysis } from "./runParallelTradingAnalysis";
import { runTradingCycle } from "./runTradingCycle";

/**
 * Injected seams for an orchestrated run. Tests inject deterministic
 * collaborators, reviewer, state, and executor; production uses the defaults.
 */
export interface OrchestratedRunDependencies {
  collaborators?: AnalysisCollaborators;
  review?: (proposal: TradeProposal, hardRisk: RiskAssessment) => Promise<unknown>;
  getState?: () => Promise<RiskState>;
  execute?: (symbol: string, side: "BUY" | "SELL", quantity: number) => Promise<OrderResult>;
  reviewTimeoutMs?: number;
}

/**
 * Epic 6 orchestrator use case:
 * Epic 4 parallel analysis -> deterministic synthesis -> Epic 5 guarded trading cycle.
 *
 * ARCHITECTURAL RULE: analyst output is DATA, never execution authority. The
 * synthesizer can only veto; every trade still flows through the trading
 * cycle's contract validation, hard risk, reviewer, and policy gate.
 */
export async function runOrchestratedTradingRun(
  input: OrchestratedRunInput,
  deps: OrchestratedRunDependencies = {}
): Promise<OrchestratedTradingReport> {
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "BTC";
  const action: "BUY" | "SELL" = input.action === "SELL" ? "SELL" : "BUY";
  const quantity = typeof input.quantity === "number" && input.quantity > 0 ? input.quantity : 1;

  // 1. Epic 4: fan-out / fan-in / aggregation. Produces CombinedAnalysis only.
  const analysis = await runParallelTradingAnalysis(
    { symbol, action, quantity },
    deps.collaborators ? { collaborators: deps.collaborators } : {}
  );

  // 2. Deterministic synthesis: confirm or veto. Never authorizes execution.
  const synthesis = synthesizeProposal(analysis, { symbol, action, quantity }, input.minConfidence);

  if (synthesis.proposal === null) {
    return OrchestratedTradingReportSchema.parse({
      status: "SKIPPED",
      analysis,
      proposal: null,
      synthesisReason: synthesis.reason,
      cycleOutcome: null,
      reason: synthesis.reason,
    });
  }

  // 3. Epic 5: guarded cycle (validate -> hard risk -> review -> policy gate -> execute).
  const cycleDependencies = buildTradingCycleDependencies({
    propose: async () => synthesis.proposal,
    ...(deps.review ? { review: deps.review } : {}),
    ...(deps.getState ? { getState: deps.getState } : {}),
    ...(deps.execute ? { execute: deps.execute } : {}),
    ...(deps.reviewTimeoutMs !== undefined ? { reviewTimeoutMs: deps.reviewTimeoutMs } : {}),
  });

  const cycle = await runTradingCycle(cycleDependencies);

  return OrchestratedTradingReportSchema.parse({
    status: cycle.outcome,
    analysis,
    proposal: cycle.proposal,
    synthesisReason: synthesis.reason,
    cycleOutcome: cycle.outcome,
    reason: cycle.reason,
  });
}
