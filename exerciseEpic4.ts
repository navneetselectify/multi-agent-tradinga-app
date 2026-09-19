import {
  executeParallelAnalysis,
  aggregateAnalysis,
  AnalysisCollaborators,
  AnalysisRequest,
  MarketResult,
  RiskResult,
  PortfolioResult,
} from "./src/lib/agent";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScenarioA() {
  console.log("\n=======================================================");
  console.log("  SCENARIO A: All 3 Analysts Succeed (Parallel Execution)");
  console.log("=======================================================\n");

  const request: AnalysisRequest = {
    symbol: "BTC",
    action: "BUY",
    quantity: 0.5,
  };

  const collaborators: AnalysisCollaborators = {
    marketAnalyst: async (req) => {
      const startTime = Date.now();
      console.log(`[Market Analyst]    ▶ STARTED at t=0ms (analyzing ${req.symbol})...`);
      await sleep(3000);
      console.log(`[Market Analyst]    ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        marketConditions: "BULLISH_TREND",
        externalFactors: ["Strong ETF inflows", "Declining exchange reserves"],
        signal: "BUY",
        confidence: 0.85,
        reason: "Breakout confirmed above 20-day moving average.",
      } satisfies MarketResult;
    },

    riskAnalyst: async (req) => {
      const startTime = Date.now();
      console.log(`[Risk Analyst]      ▶ STARTED at t=0ms (evaluating risk)...`);
      await sleep(150);
      console.log(`[Risk Analyst]      ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        status: "APPROVED",
        reasons: ["Risk score 18/100 is within acceptable conservative thresholds."],
        riskFactors: ["Moderate intraday volatility"],
        topRisks: ["Wick liquidation on high leverage"],
      } satisfies RiskResult;
    },

    portfolioAnalyst: async (req) => {
      const startTime = Date.now();
      console.log(`[Portfolio Analyst] ▶ STARTED at t=0ms (checking exposure)...`);
      await sleep(120);
      console.log(`[Portfolio Analyst] ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        currentExposure: 15000,
        tradeAmount: 32000,
        portfolioImpact: "Increases BTC allocation from 15% to 47%.",
        relevantHistory: ["3 prior BTC trades executed in profit."],
        confidence: 0.9,
        reason: "Adequate liquidity and cash reserve present.",
      } satisfies PortfolioResult;
    },
  };

  const overallStart = Date.now();
  console.log("🚀 Launching FAN-OUT via Promise.allSettled()...\n");

  const fanIn = await executeParallelAnalysis(request, collaborators);
  const totalDuration = Date.now() - overallStart;

  console.log(`\n⏱  Total Parallel Execution Time: ${totalDuration}ms`);
  console.log("   (Notice total time ≈ max(100, 150, 120)ms rather than serial sum 370ms)\n");

  console.log("📦 Fan-In Collected Results:");
  console.log(" - Market Result:   ", fanIn.market?.signal, `(Confidence: ${fanIn.market?.confidence})`);
  console.log(" - Risk Result:     ", fanIn.risk?.status);
  console.log(" - Portfolio Result: Trade Amount $", fanIn.portfolio?.tradeAmount);
  console.log(" - Failures:        ", fanIn.failures.length === 0 ? "None" : fanIn.failures);

  console.log("\n⚙  Running Aggregator...");
  const combined = aggregateAnalysis(fanIn);

  console.log("\n📊 CombinedAnalysis Output:");
  console.log(JSON.stringify(combined, null, 2));
}

async function runScenarioB() {
  console.log("\n=======================================================");
  console.log("  SCENARIO B: Risk Analyst Intentionally Fails (Fan-In Isolation)");
  console.log("=======================================================\n");

  const request: AnalysisRequest = {
    symbol: "ETH",
    action: "BUY",
    quantity: 2.0,
  };

  const collaborators: AnalysisCollaborators = {
    marketAnalyst: async (req) => {
      const startTime = Date.now();
      console.log(`[Market Analyst]    ▶ STARTED at t=0ms (analyzing ${req.symbol})...`);
      await sleep(110);
      console.log(`[Market Analyst]    ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        marketConditions: "CONSOLIDATING",
        externalFactors: ["Network upgrade scheduled", "Steady staking rate"],
        signal: "BUY",
        confidence: 0.78,
        reason: "Support level held firmly over 48 hours.",
      } satisfies MarketResult;
    },

    riskAnalyst: async () => {
      const startTime = Date.now();
      console.log(`[Risk Analyst]      ▶ STARTED at t=0ms (evaluating risk)...`);
      await sleep(80);
      console.log(`[Risk Analyst]      ✖ FAILED in ${Date.now() - startTime}ms: Simulated Risk Model Timeout/Exception!`);
      throw new Error("Simulated Error: Risk engine calculation failed due to upstream feed timeout.");
    },

    portfolioAnalyst: async () => {
      const startTime = Date.now();
      console.log(`[Portfolio Analyst] ▶ STARTED at t=0ms (checking exposure)...`);
      await sleep(140);
      console.log(`[Portfolio Analyst] ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        currentExposure: 8000,
        tradeAmount: 6000,
        portfolioImpact: "Increases ETH allocation from 8% to 14%.",
        relevantHistory: ["Recent ETH swing trade exited at +4.5%."],
        confidence: 0.88,
        reason: "Available cash is sufficient.",
      } satisfies PortfolioResult;
    },
  };

  const overallStart = Date.now();
  console.log("🚀 Launching FAN-OUT via Promise.allSettled()...\n");

  const fanIn = await executeParallelAnalysis(request, collaborators);
  const totalDuration = Date.now() - overallStart;

  console.log(`\n⏱  Total Parallel Execution Time: ${totalDuration}ms\n`);

  console.log("🔍 Promise.allSettled Verification:");
  console.log(` - Market Analyst Settled Status:    ${fanIn.settled.market.status} (Result preserved!)`);
  console.log(` - Risk Analyst Settled Status:      ${fanIn.settled.risk.status} (Failure isolated!)`);
  console.log(` - Portfolio Analyst Settled Status: ${fanIn.settled.portfolio.status} (Result preserved!)`);

  console.log("\n📦 Preserved Fan-In Data:");
  console.log(" - Market Data Preserved:   ", fanIn.market !== null ? "YES (" + fanIn.market.signal + ")" : "NO");
  console.log(" - Portfolio Data Preserved:", fanIn.portfolio !== null ? "YES ($" + fanIn.portfolio.tradeAmount + ")" : "NO");
  console.log(" - Risk Data:               ", fanIn.risk === null ? "null (as expected)" : "present");
  console.log(" - Captured Failures:       ", JSON.stringify(fanIn.failures, null, 2));

  console.log("\n⚙  Running Aggregator with Incomplete Results...");
  const combined = aggregateAnalysis(fanIn);

  console.log("\n📊 Aggregator CombinedAnalysis Output:");
  console.log(` - Status:           ${combined.status}`);
  console.log(` - ExecutionAllowed: ${combined.executionAllowed}`);
  console.log(` - Action:           ${combined.action}`);
  console.log(` - Reasons:          \n   * ${combined.reasons.join("\n   * ")}`);
  console.log(` - Failures:         \n${JSON.stringify(combined.failures, null, 4)}`);
  console.log(` - Preserved Market: ${combined.market?.signal} with confidence ${combined.market?.confidence}`);
  console.log(` - Preserved Portf:  $${combined.portfolio?.tradeAmount}`);
}

async function runScenarioC() {
  console.log("\n=======================================================");
  console.log("  SCENARIO C: 1000ms Timeout Enforced (Market Analyst at 3000ms)");
  console.log("=======================================================\n");

  const request: AnalysisRequest = {
    symbol: "SOL",
    action: "BUY",
    quantity: 10.0,
  };

  const TIMEOUT_MS = 1000;

  function withAnalystTimeout<T>(
    analystFn: (req: AnalysisRequest) => Promise<T>,
    timeoutMs: number,
    name: string
  ): (req: AnalysisRequest) => Promise<T> {
    return (req) => {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} exceeded timeout limit of ${timeoutMs}ms.`));
        }, timeoutMs);
      });
      return Promise.race([analystFn(req), timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };
  }

  const rawCollaborators: AnalysisCollaborators = {
    marketAnalyst: async (req) => {
      const startTime = Date.now();
      console.log(`[Market Analyst]    ▶ STARTED at t=0ms (slow external feed, delay: 3000ms)...`);
      await sleep(3000);
      console.log(`[Market Analyst]    ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        marketConditions: "EXTREME_VOLATILITY",
        externalFactors: ["Ecosystem network congestion"],
        signal: "BUY",
        confidence: 0.65,
        reason: "Long-term support bounce.",
      } satisfies MarketResult;
    },

    riskAnalyst: async () => {
      const startTime = Date.now();
      console.log(`[Risk Analyst]      ▶ STARTED at t=0ms (delay: 150ms)...`);
      await sleep(150);
      console.log(`[Risk Analyst]      ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        status: "APPROVED",
        reasons: ["Risk score acceptable for SOL tier."],
        riskFactors: ["Network outage history"],
        topRisks: ["Protocol halt"],
      } satisfies RiskResult;
    },

    portfolioAnalyst: async () => {
      const startTime = Date.now();
      console.log(`[Portfolio Analyst] ▶ STARTED at t=0ms (delay: 120ms)...`);
      await sleep(120);
      console.log(`[Portfolio Analyst] ✔ COMPLETED in ${Date.now() - startTime}ms`);
      return {
        currentExposure: 5000,
        tradeAmount: 1800,
        portfolioImpact: "Increases SOL allocation to 8%.",
        relevantHistory: ["Prior SOL trade closed flat."],
        confidence: 0.85,
        reason: "Portfolio liquidity is healthy.",
      } satisfies PortfolioResult;
    },
  };

  const timeoutCollaborators: AnalysisCollaborators = {
    marketAnalyst: withAnalystTimeout(
      rawCollaborators.marketAnalyst as (req: AnalysisRequest) => Promise<MarketResult>,
      TIMEOUT_MS,
      "Market Analyst"
    ),
    riskAnalyst: withAnalystTimeout(
      rawCollaborators.riskAnalyst as (req: AnalysisRequest) => Promise<RiskResult>,
      TIMEOUT_MS,
      "Risk Analyst"
    ),
    portfolioAnalyst: withAnalystTimeout(
      rawCollaborators.portfolioAnalyst as (req: AnalysisRequest) => Promise<PortfolioResult>,
      TIMEOUT_MS,
      "Portfolio Analyst"
    ),
  };

  const overallStart = Date.now();
  console.log(`🚀 Launching FAN-OUT with ${TIMEOUT_MS}ms timeout per analyst...\n`);

  const fanIn = await executeParallelAnalysis(request, timeoutCollaborators);
  const totalDuration = Date.now() - overallStart;

  console.log(`\n⏱  Total Parallel Execution Time: ${totalDuration}ms`);
  console.log(`   (Notice total time ≈ ${TIMEOUT_MS}ms; fan-in did NOT wait the full 3000ms!)\n`);

  console.log("🔍 Fan-In Isolation & Timeout Verification:");
  console.log(` - Market Analyst Settled Status:    ${fanIn.settled.market.status} (Timed out as expected!)`);
  console.log(` - Risk Analyst Settled Status:      ${fanIn.settled.risk.status} (Completed & preserved!)`);
  console.log(` - Portfolio Analyst Settled Status: ${fanIn.settled.portfolio.status} (Completed & preserved!)`);

  console.log("\n📦 Preserved Fan-In Data:");
  console.log(" - Market Data:             ", fanIn.market === null ? "null (timed out)" : "present");
  console.log(" - Risk Data Preserved:     ", fanIn.risk !== null ? `YES (${fanIn.risk.status})` : "NO");
  console.log(" - Portfolio Data Preserved:", fanIn.portfolio !== null ? `YES ($${fanIn.portfolio.tradeAmount})` : "NO");
  console.log(" - Captured Failures:       ", JSON.stringify(fanIn.failures, null, 2));

  console.log("\n⚙  Running Aggregator with Timed Out Analysis...");
  const combined = aggregateAnalysis(fanIn);

  console.log("\n📊 Aggregator CombinedAnalysis Output:");
  console.log(` - Status:           ${combined.status}`);
  console.log(` - ExecutionAllowed: ${combined.executionAllowed}`);
  console.log(` - Action:           ${combined.action}`);
  console.log(` - Reasons:          \n   * ${combined.reasons.join("\n   * ")}`);
  console.log(` - Preserved Risk:   ${combined.risk?.status}`);
  console.log(` - Preserved Portf:  $${combined.portfolio?.tradeAmount}`);
}

async function main() {
  await runScenarioA();
  await runScenarioB();
  await runScenarioC();
  console.log("\n=======================================================");
  console.log("  MANUAL EXERCISE COMPLETE");
  console.log("=======================================================\n");
}

main().catch(console.error);
