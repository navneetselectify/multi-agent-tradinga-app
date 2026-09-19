import {
  AnalysisFailure,
  CombinedAnalysis,
  MarketResult,
  MarketResultSchema,
  PortfolioResult,
  PortfolioResultSchema,
  RiskResult,
  RiskResultSchema,
} from "./contracts";
import { aggregateAnalysis } from "./aggregator";

/**
 * Request payload provided to each analyst during fan-out.
 */
export interface AnalysisRequest {
  symbol?: string;
  action?: "BUY" | "SELL";
  quantity?: number;
  [key: string]: unknown;
}

/**
 * Injected analyst functions or interfaces.
 * Using injected seams allows orchestration to be tested independently of LLM models.
 */
export type MarketAnalystFn = (request: AnalysisRequest) => Promise<MarketResult>;
export interface MarketAnalystInterface {
  analyze(request: AnalysisRequest): Promise<MarketResult>;
}
export type MarketAnalyst = MarketAnalystFn | MarketAnalystInterface;

export type RiskAnalystFn = (request: AnalysisRequest) => Promise<RiskResult>;
export interface RiskAnalystInterface {
  analyze(request: AnalysisRequest): Promise<RiskResult>;
}
export type RiskAnalyst = RiskAnalystFn | RiskAnalystInterface;

export type PortfolioAnalystFn = (request: AnalysisRequest) => Promise<PortfolioResult>;
export interface PortfolioAnalystInterface {
  analyze(request: AnalysisRequest): Promise<PortfolioResult>;
}
export type PortfolioAnalyst = PortfolioAnalystFn | PortfolioAnalystInterface;

export interface AnalysisCollaborators {
  marketAnalyst: MarketAnalyst;
  riskAnalyst: RiskAnalyst;
  portfolioAnalyst: PortfolioAnalyst;
}

/**
 * Configurable timeout thresholds (in milliseconds) per analyst.
 */
export interface AnalystTimeouts {
  marketMs?: number;
  riskMs?: number;
  portfolioMs?: number;
  defaultTimeoutMs?: number;
}

/**
 * Options for parallel analysis execution.
 */
export interface ParallelAnalysisOptions {
  timeouts?: AnalystTimeouts;
}

/**
 * Preserved fan-in collection representing both successes and failures.
 */
export interface FanInResults {
  market: MarketResult | null;
  risk: RiskResult | null;
  portfolio: PortfolioResult | null;
  failures: AnalysisFailure[];
  settled: {
    market: PromiseSettledResult<MarketResult>;
    risk: PromiseSettledResult<RiskResult>;
    portfolio: PromiseSettledResult<PortfolioResult>;
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || "Analyst execution failed with an empty error message.";
  }
  if (typeof error === "string") {
    return error.trim() || "Analyst execution failed with an empty error string.";
  }
  return String(error) || "Analyst execution failed with an unknown error.";
}

async function invokeAnalyst<T>(
  analyst: ((req: AnalysisRequest) => Promise<T>) | { analyze(req: AnalysisRequest): Promise<T> },
  request: AnalysisRequest
): Promise<T> {
  if (typeof analyst === "function") {
    return await analyst(request);
  }
  if (analyst && typeof analyst.analyze === "function") {
    return await analyst.analyze(request);
  }
  throw new Error("Invalid analyst provided: must be an executable function or object with analyze().");
}

function resolveTimeouts(
  options?: ParallelAnalysisOptions | AnalystTimeouts
): AnalystTimeouts {
  if (!options) return {};
  if ("timeouts" in options && options.timeouts !== undefined) {
    return options.timeouts;
  }
  return options as AnalystTimeouts;
}

async function invokeAnalystWithTimeout<T>(
  analyst: ((req: AnalysisRequest) => Promise<T>) | { analyze(req: AnalysisRequest): Promise<T> },
  request: AnalysisRequest,
  timeoutMs: number | undefined,
  analystName: string
): Promise<T> {
  const executeCall = () => invokeAnalyst(analyst, request);

  if (timeoutMs === undefined || timeoutMs <= 0) {
    return await executeCall();
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${analystName} analysis timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });
    return await Promise.race([executeCall(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes three independent trading analysts (Market, Risk, Portfolio) in parallel.
 *
 * Uses Promise.allSettled() to guarantee that a failure in one analyst does not hide
 * or abort the results of the other analysts. Supports configurable per-analyst timeouts.
 */
export async function executeParallelAnalysis(
  request: AnalysisRequest,
  collaborators: AnalysisCollaborators,
  options?: ParallelAnalysisOptions | AnalystTimeouts
): Promise<FanInResults> {
  if (!collaborators) {
    throw new Error("Analysis collaborators must be provided.");
  }

  const timeouts = resolveTimeouts(options);
  const marketTimeout = timeouts.marketMs ?? timeouts.defaultTimeoutMs;
  const riskTimeout = timeouts.riskMs ?? timeouts.defaultTimeoutMs;
  const portfolioTimeout = timeouts.portfolioMs ?? timeouts.defaultTimeoutMs;

  // Fan-out execution using Promise.allSettled
  const [marketSettled, riskSettled, portfolioSettled] = await Promise.allSettled([
    Promise.resolve().then(() =>
      invokeAnalystWithTimeout(collaborators.marketAnalyst, request, marketTimeout, "Market Analyst")
    ),
    Promise.resolve().then(() =>
      invokeAnalystWithTimeout(collaborators.riskAnalyst, request, riskTimeout, "Risk Analyst")
    ),
    Promise.resolve().then(() =>
      invokeAnalystWithTimeout(collaborators.portfolioAnalyst, request, portfolioTimeout, "Portfolio Analyst")
    ),
  ]);

  const failures: AnalysisFailure[] = [];
  let market: MarketResult | null = null;
  let risk: RiskResult | null = null;
  let portfolio: PortfolioResult | null = null;

  // Fan-in: Market Analyst result processing
  if (marketSettled.status === "fulfilled") {
    const parse = MarketResultSchema.safeParse(marketSettled.value);
    if (parse.success) {
      market = parse.data;
    } else {
      failures.push({
        analyst: "market",
        reason: `Market analyst output failed contract validation: ${parse.error.issues.map((i) => i.message).join("; ")}`,
      });
    }
  } else {
    failures.push({
      analyst: "market",
      reason: formatErrorMessage(marketSettled.reason),
    });
  }

  // Fan-in: Risk Analyst result processing
  if (riskSettled.status === "fulfilled") {
    const parse = RiskResultSchema.safeParse(riskSettled.value);
    if (parse.success) {
      risk = parse.data;
    } else {
      failures.push({
        analyst: "risk",
        reason: `Risk analyst output failed contract validation: ${parse.error.issues.map((i) => i.message).join("; ")}`,
      });
    }
  } else {
    failures.push({
      analyst: "risk",
      reason: formatErrorMessage(riskSettled.reason),
    });
  }

  // Fan-in: Portfolio Analyst result processing
  if (portfolioSettled.status === "fulfilled") {
    const parse = PortfolioResultSchema.safeParse(portfolioSettled.value);
    if (parse.success) {
      portfolio = parse.data;
    } else {
      failures.push({
        analyst: "portfolio",
        reason: `Portfolio analyst output failed contract validation: ${parse.error.issues.map((i) => i.message).join("; ")}`,
      });
    }
  } else {
    failures.push({
      analyst: "portfolio",
      reason: formatErrorMessage(portfolioSettled.reason),
    });
  }

  return {
    market,
    risk,
    portfolio,
    failures,
    settled: {
      market: marketSettled,
      risk: riskSettled,
      portfolio: portfolioSettled,
    },
  };
}

/**
 * Convenience pipeline running the entire Fan-Out -> Fan-In -> Aggregation flow.
 */
export async function runParallelAnalysis(
  request: AnalysisRequest,
  collaborators: AnalysisCollaborators,
  options?: ParallelAnalysisOptions | AnalystTimeouts
): Promise<CombinedAnalysis> {
  const fanIn = await executeParallelAnalysis(request, collaborators, options);
  return aggregateAnalysis(fanIn);
}
