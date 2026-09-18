import {
  RiskVerdict,
  RiskVerdictSchema,
  TradeProposal,
  TradeProposalSchema,
} from "@/lib/agent/contracts";
import { RiskAssessment, RiskService, RiskState } from "@/lib/exchange/riskService";
import { OrderResult } from "@/lib/exchange/service";
import { getDashboardData } from "./getDashboardData";
import { executeTrade } from "./executeTrade";
import { applyPolicyGate, GateDecision } from "./policyGate";

/**
 * Injected collaborators for a trading cycle.
 *
 * propose/review are the future Analyst and Risk Reviewer seams. Today tests
 * inject plain functions; the orchestrator never constructs an agent itself.
 */
export interface TradingCycleDependencies {
  propose: () => Promise<unknown>;
  review: (proposal: TradeProposal, hardRisk: RiskAssessment) => Promise<unknown>;
  getState?: () => Promise<RiskState>;
  execute?: (symbol: string, side: "BUY" | "SELL", quantity: number) => Promise<OrderResult>;
  reviewTimeoutMs?: number;
}

export type TradingCycleOutcome = "EXECUTED" | "SKIPPED" | "ABORTED";

/**
 * Structured, secret-free report of one trading cycle.
 */
export interface TradingCycleReport {
  outcome: TradingCycleOutcome;
  proposal: TradeProposal | null;
  hardRisk: RiskAssessment | null;
  verdict: RiskVerdict | null;
  gate: GateDecision | null;
  order: OrderResult | null;
  reason: string | null;
}

/**
 * Plain-code trading cycle pipeline:
 * propose -> validate -> hard risk -> review -> validate -> policy gate -> execute.
 *
 * No database access, no financial formulas, no LLM calls, no agent construction.
 */
export async function runTradingCycle(deps: TradingCycleDependencies): Promise<TradingCycleReport> {
  const emptyReport: TradingCycleReport = {
    outcome: "ABORTED",
    proposal: null,
    hardRisk: null,
    verdict: null,
    gate: null,
    order: null,
    reason: null,
  };

  // a. Obtain a proposal from the injected provider (fail fast if missing).
  if (!deps || typeof deps.propose !== "function") {
    return { ...emptyReport, reason: "Proposal provider (propose) is required and cannot be omitted." };
  }

  let rawProposal: unknown;
  try {
    rawProposal = await deps.propose();
  } catch {
    return { ...emptyReport, reason: "Proposal provider failed." };
  }

  // b. Validate the proposal contract; malformed data never proceeds.
  const proposalParse = TradeProposalSchema.safeParse(rawProposal);
  if (!proposalParse.success) {
    return { ...emptyReport, reason: "Proposal failed contract validation." };
  }
  const proposal = proposalParse.data;

  // c. Deterministic hard-rule assessment against current state.
  const getState = deps.getState ?? getDashboardData;
  let state: RiskState;
  try {
    state = await getState();
  } catch {
    return { ...emptyReport, proposal, reason: "Portfolio state is unavailable." };
  }
  const hardRisk = RiskService.evaluate(proposal, state);

  // d. Obtain a review verdict from the injected provider (with optional timeout).
  let rawVerdict: unknown;
  try {
    if (deps.reviewTimeoutMs !== undefined && deps.reviewTimeoutMs > 0) {
      let timeoutId: NodeJS.Timeout | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Risk review timed out after ${deps.reviewTimeoutMs}ms.`));
          }, deps.reviewTimeoutMs);
        });
        rawVerdict = await Promise.race([
          deps.review(proposal, hardRisk),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } else {
      rawVerdict = await deps.review(proposal, hardRisk);
    }
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message.includes("timed out");
    return {
      ...emptyReport,
      outcome: "ABORTED",
      proposal,
      hardRisk,
      reason: isTimeout ? (err as Error).message : "Risk review provider failed.",
    };
  }

  // e. Validate the verdict contract; malformed data never proceeds.
  const verdictParse = RiskVerdictSchema.safeParse(rawVerdict);
  if (!verdictParse.success) {
    return { ...emptyReport, proposal, hardRisk, reason: "Risk verdict failed contract validation." };
  }
  const verdict = verdictParse.data;

  // ADJUST quantities are re-evaluated by hard rules, never trusted directly.
  const adjustedRisk =
    verdict.verdict === "ADJUST"
      ? RiskService.evaluate({ ...proposal, quantity: verdict.adjustedQuantity }, state)
      : null;

  // f. Deterministic policy gate: verdict is data, hard rules are authority.
  const gate = applyPolicyGate({ proposal, hardRisk, verdict, adjustedRisk });

  if (!gate.execute) {
    return {
      ...emptyReport,
      outcome: "SKIPPED",
      proposal,
      hardRisk,
      verdict,
      gate,
      reason: gate.reason,
    };
  }

  // g. Execute through the existing use case.
  const execute = deps.execute ?? executeTrade;
  let order: OrderResult;
  try {
    order = await execute(proposal.symbol, proposal.action, gate.quantity);
  } catch {
    return { ...emptyReport, proposal, hardRisk, verdict, gate, reason: "Trade execution failed." };
  }

  const executed = order.status === "EXECUTED";
  return {
    outcome: executed ? "EXECUTED" : "SKIPPED",
    proposal,
    hardRisk,
    verdict,
    gate,
    order,
    reason: executed ? null : order.reason ?? "Order was not executed.",
  };
}
