import { describe, it, expect, vi } from "vitest";
import { runTradingCycle, TradingCycleDependencies } from "../runTradingCycle";
import { RiskService, RiskState } from "@/lib/exchange/riskService";
import { OrderResult } from "@/lib/exchange/service";

type ReviewFn = NonNullable<TradingCycleDependencies["review"]>;

const state: RiskState = {
  cash: 100000,
  holdings: [{ symbol: "BTC", quantity: 2 }],
  prices: { BTC: 60000, ETH: 3000, SOL: 150 },
};

const validProposal = {
  action: "BUY" as const,
  symbol: "BTC" as const,
  quantity: 1,
  confidence: 0.8,
  reason: "Valid proposal for orchestrator tests.",
};

const approve = { verdict: "APPROVE" as const, reason: "Within exposure limits." };

function makeDeps(overrides: Partial<TradingCycleDependencies> = {}) {
  const propose = overrides.propose ?? vi.fn(async () => validProposal as unknown);
  const review = overrides.review ?? vi.fn<ReviewFn>(async () => approve as unknown);
  const getState = overrides.getState ?? vi.fn(async () => state);
  const execute =
    overrides.execute ?? vi.fn(async (): Promise<OrderResult> => ({ orderId: 1, status: "EXECUTED" }));

  const deps: TradingCycleDependencies = { propose, review, getState, execute, ...overrides };
  return { deps, spies: { propose: propose as ReturnType<typeof vi.fn>, review: review as ReturnType<typeof vi.fn>, getState: getState as ReturnType<typeof vi.fn>, execute: execute as ReturnType<typeof vi.fn> } };
}

describe("runTradingCycle orchestrator", () => {
  it("executes an approved proposal that passes hard rules", async () => {
    const { deps, spies } = makeDeps();
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("EXECUTED");
    expect(report.proposal).toEqual(validProposal);
    expect(report.hardRisk?.allowed).toBe(true);
    expect(report.verdict).toEqual(approve);
    expect(report.gate).toEqual({
      execute: true,
      quantity: 1,
      reason: "Risk review approved the proposal.",
    });
    expect(report.order).toEqual({ orderId: 1, status: "EXECUTED" });
    expect(report.reason).toBeNull();
    expect(spies.execute).toHaveBeenCalledWith("BTC", "BUY", 1);
  });

  it("passes the proposal and hard-risk assessment to the injected reviewer", async () => {
    const { deps, spies } = makeDeps();
    await runTradingCycle(deps);

    expect(spies.review).toHaveBeenCalledTimes(1);
    const [reviewedProposal, hardRisk] = spies.review.mock.calls[0];
    expect(reviewedProposal).toEqual(validProposal);
    expect(hardRisk.allowed).toBe(true);
    expect(hardRisk.estimatedValue).toBe(60000);
  });

  it("conflict rule: hard risk FAIL + verdict APPROVE => no trade (calculator wins)", async () => {
    const { deps, spies } = makeDeps({ getState: vi.fn(async () => ({ ...state, cash: 100 })) });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("SKIPPED");
    expect(report.hardRisk?.allowed).toBe(false);
    expect(report.gate?.execute).toBe(false);
    expect(report.reason).toContain("Hard risk rules failed");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("conflict rule: hard risk PASS + verdict REJECT => no trade (stamp wins against execution)", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => ({ verdict: "REJECT", reason: "Too concentrated." })),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("SKIPPED");
    expect(report.hardRisk?.allowed).toBe(true);
    expect(report.reason).toContain("Risk review rejected");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("executes the adjusted quantity when ADJUST passes hard rules", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => ({ verdict: "ADJUST", reason: "Reduce size.", adjustedQuantity: 0.5 })),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("EXECUTED");
    expect(report.gate).toEqual({
      execute: true,
      quantity: 0.5,
      reason: "Risk review adjusted the quantity to 0.5.",
    });
    expect(spies.execute).toHaveBeenCalledWith("BTC", "BUY", 0.5);
  });

  it("blocks execution when the adjusted quantity fails hard rules", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => ({ verdict: "ADJUST", reason: "Reduce size.", adjustedQuantity: 5 })),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("SKIPPED");
    expect(report.reason).toContain("Adjusted quantity failed hard risk rules");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("revalidates adjusted quantity with deterministic RiskService before execution", async () => {
    const evaluateSpy = vi.spyOn(RiskService, "evaluate");
    try {
      const { deps, spies } = makeDeps({
        review: vi.fn(async () => ({ verdict: "ADJUST", reason: "Scale down position.", adjustedQuantity: 0.25 })),
      });
      const report = await runTradingCycle(deps);

      expect(report.outcome).toBe("EXECUTED");
      expect(evaluateSpy).toHaveBeenCalledTimes(2);
      expect(evaluateSpy.mock.calls[0][0].quantity).toBe(1);
      expect(evaluateSpy.mock.calls[1][0].quantity).toBe(0.25);
      expect(spies.execute).toHaveBeenCalledWith("BTC", "BUY", 0.25);
    } finally {
      evaluateSpy.mockRestore();
    }
  });

  it("aborts on a malformed proposal before review or execution", async () => {
    const { deps, spies } = makeDeps({
      propose: vi.fn(async () => ({
        action: "HOLD",
        symbol: "BTC",
        quantity: 1,
        confidence: 0.8,
        reason: "Malformed proposal.",
      })),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.proposal).toBeNull();
    expect(report.reason).toBe("Proposal failed contract validation.");
    expect(spies.getState).not.toHaveBeenCalled();
    expect(spies.review).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("aborts on a malformed verdict before execution", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => ({ verdict: "MAYBE", reason: "Unsupported." })),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.verdict).toBeNull();
    expect(report.reason).toBe("Risk verdict failed contract validation.");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("reports a proposal provider failure without leaking error details", async () => {
    const secret = "GEMINI_API_KEY=super-secret-value";
    const { deps } = makeDeps({
      propose: vi.fn(async () => {
        throw new Error(secret);
      }),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toBe("Proposal provider failed.");
    expect(JSON.stringify(report)).not.toContain("super-secret-value");
    expect(JSON.stringify(report)).not.toContain("GEMINI_API_KEY");
  });

  it("reports a review provider failure", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(async () => {
        throw new Error("Reviewer crashed.");
      }),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toBe("Risk review provider failed.");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("reports an exchange-cancelled order as skipped", async () => {
    const execute = vi.fn(
      async (): Promise<OrderResult> => ({
        orderId: 9,
        status: "CANCELLED",
        reason: "Insufficient funds",
      })
    );
    const { deps } = makeDeps({ execute });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("SKIPPED");
    expect(report.order).toEqual({ orderId: 9, status: "CANCELLED", reason: "Insufficient funds" });
    expect(report.reason).toBe("Insufficient funds");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("aborts when portfolio state is unavailable", async () => {
    const { deps, spies } = makeDeps({
      getState: vi.fn(async () => {
        throw new Error("Database unavailable.");
      }),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toBe("Portfolio state is unavailable.");
    expect(spies.review).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("reports trade execution failure without leaking internal errors", async () => {
    const { deps, spies } = makeDeps({
      execute: vi.fn(async () => {
        throw new Error("DB connection reset / secret leak");
      }),
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toBe("Trade execution failed.");
    expect(JSON.stringify(report)).not.toContain("secret leak");
    expect(spies.execute).toHaveBeenCalledTimes(1);
  });

  it("aborts when review exceeds reviewTimeoutMs", async () => {
    const { deps, spies } = makeDeps({
      review: vi.fn(() => new Promise(() => {})), // Never resolves
      reviewTimeoutMs: 25,
    });
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toBe("Risk review timed out after 25ms.");
    expect(spies.execute).not.toHaveBeenCalled();
  });

  it("aborts fast at start of cycle if propose is missing or not a function (cannot invent trades)", async () => {
    const deps = {
      propose: undefined as unknown as () => Promise<unknown>,
      review: vi.fn(),
      execute: vi.fn(),
    };
    const report = await runTradingCycle(deps);

    expect(report.outcome).toBe("ABORTED");
    expect(report.reason).toContain("Proposal provider (propose) is required");
    expect(deps.review).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("uses only injected collaborators and exposes no extra report fields", async () => {
    const { deps, spies } = makeDeps();
    const report = await runTradingCycle(deps);

    expect(spies.propose).toHaveBeenCalledTimes(1);
    expect(spies.review).toHaveBeenCalledTimes(1);
    expect(spies.execute).toHaveBeenCalledTimes(1);
    expect(Object.keys(report).sort()).toEqual(
      ["gate", "hardRisk", "order", "outcome", "proposal", "reason", "verdict"].sort()
    );
  });
});
