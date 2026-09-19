import {
  CombinedAnalysis,
  runParallelAnalysis,
  AnalysisCollaborators,
  AnalysisRequest,
  AnalystTimeouts,
  MarketResult,
  RiskResult,
  PortfolioResult,
} from "@/lib/agent";

export interface MockAnalystDelays {
  marketMs?: number;
  riskMs?: number;
  portfolioMs?: number;
}

export interface ParallelTradingAnalysisInput {
  symbol?: string;
  action?: "BUY" | "SELL";
  quantity?: number;
  timeouts?: AnalystTimeouts;
  delays?: MockAnalystDelays;
}

export interface ParallelTradingAnalysisDependencies {
  collaborators?: AnalysisCollaborators;
  defaultTimeouts?: AnalystTimeouts;
}

const MOCK_PRICES: Record<string, number> = {
  BTC: 65000,
  ETH: 3500,
  SOL: 150,
};

// Explicit demo/mock risk cap ($100k) strictly limited to the deterministic mock layer
const MOCK_DEMO_RISK_CAP = 100000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates deterministic mock analysts for the parallel analysis flow.
 * Respects symbol, action, quantity, and configurable simulated latency.
 * Keeps orchestration tested independently from real Gemini agents.
 */
export function createDefaultDeterministicAnalysts(
  delays?: MockAnalystDelays
): AnalysisCollaborators {
  return {
    marketAnalyst: async (req: AnalysisRequest): Promise<MarketResult> => {
      if (delays?.marketMs && delays.marketMs > 0) {
        await sleep(delays.marketMs);
      }

      const symbol = req.symbol ?? "BTC";
      const action = req.action === "SELL" ? "SELL" : "BUY";

      if (action === "SELL") {
        return {
          marketConditions: "BEARISH_REVERSAL",
          externalFactors: [
            `Profit taking pressure on ${symbol}`,
            "Macro risk-off sentiment",
          ],
          signal: "SELL",
          confidence: 0.81,
          reason: `Rejection at key overhead resistance level with bearish volume divergence on ${symbol}.`,
        };
      }

      return {
        marketConditions: "BULLISH_TREND",
        externalFactors: [
          `Institutional volume surge on ${symbol}`,
          "Positive macro rate outlook",
        ],
        signal: "BUY",
        confidence: 0.84,
        reason: `Strong upward momentum and sustained support for ${symbol}.`,
      };
    },

    riskAnalyst: async (req: AnalysisRequest): Promise<RiskResult> => {
      if (delays?.riskMs && delays.riskMs > 0) {
        await sleep(delays.riskMs);
      }

      const symbol = req.symbol ?? "BTC";
      const quantity = typeof req.quantity === "number" && req.quantity > 0 ? req.quantity : 1;
      const price = MOCK_PRICES[symbol] ?? 1000;
      const notional = quantity * price;

      if (notional > MOCK_DEMO_RISK_CAP) {
        return {
          status: "REJECTED",
          reasons: [
            `Notional trade value of $${Math.round(notional).toLocaleString()} exceeds mock single-order risk cap of $${MOCK_DEMO_RISK_CAP.toLocaleString()}.`,
          ],
          riskFactors: [
            "Extreme position concentration",
            "Potential portfolio drawdown exceeding 10%",
          ],
          topRisks: [
            "Severe capital depletion on adverse market move",
            "Excessive single-asset concentration",
          ],
        };
      }

      return {
        status: "APPROVED",
        reasons: [
          `Notional trade value of $${Math.round(notional).toLocaleString()} is within conservative risk limits.`,
        ],
        riskFactors: ["Moderate volatility during active trading hours"],
        topRisks: ["Intraday wick volatility"],
      };
    },

    portfolioAnalyst: async (req: AnalysisRequest): Promise<PortfolioResult> => {
      if (delays?.portfolioMs && delays.portfolioMs > 0) {
        await sleep(delays.portfolioMs);
      }

      const symbol = req.symbol ?? "BTC";
      const action = req.action === "SELL" ? "SELL" : "BUY";
      const quantity = typeof req.quantity === "number" && req.quantity > 0 ? req.quantity : 1;
      const price = MOCK_PRICES[symbol] ?? 1000;
      const tradeAmount = Math.round(quantity * price);

      if (action === "SELL") {
        return {
          currentExposure: 25000,
          tradeAmount,
          portfolioImpact: `Reduces ${symbol} exposure by $${tradeAmount.toLocaleString()}, increasing available cash balance.`,
          relevantHistory: [`Previous profitable swing trades on ${symbol} settled successfully.`],
          confidence: 0.86,
          reason: `De-risking position aligns with prudent portfolio capital preservation.`,
        };
      }

      return {
        currentExposure: 15000,
        tradeAmount,
        portfolioImpact: `Increases allocation in ${symbol} by $${tradeAmount.toLocaleString()} within portfolio risk limits.`,
        relevantHistory: [`Previous swing trades on ${symbol} settled with positive return.`],
        confidence: 0.88,
        reason: "Ample unallocated liquidity is available to accommodate position.",
      };
    },
  };
}

/**
 * Thin server-side use case executing parallel fan-out analysis for Market, Risk, and Portfolio.
 * ARCHITECTURAL RULE: This use case is pure analysis and must NEVER execute trades.
 */
export async function runParallelTradingAnalysis(
  input: ParallelTradingAnalysisInput = {},
  deps: ParallelTradingAnalysisDependencies = {}
): Promise<CombinedAnalysis> {
  const symbol = input.symbol?.toUpperCase() ?? "BTC";
  const action = input.action === "SELL" ? "SELL" : "BUY";
  const quantity = typeof input.quantity === "number" && input.quantity > 0 ? input.quantity : 1;

  const request: AnalysisRequest = {
    symbol,
    action,
    quantity,
  };

  const collaborators =
    deps.collaborators ?? createDefaultDeterministicAnalysts(input.delays);
  const timeouts = input.timeouts ?? deps.defaultTimeouts ?? {
    defaultTimeoutMs: 5000,
  };

  return await runParallelAnalysis(request, collaborators, { timeouts });
}
