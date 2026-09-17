import { ToolRegistry } from "./registry";
import { AgentExecutor } from "./executor";
import {
  GetPortfolioAndMarketStateTool,
  AdvanceMarketTickTool,
  ExecuteAssetTradeTool,
} from "./tools";

async function main() {
  console.log("==================================================");
  console.log("   AGENT ↔ TOOL LOOP VALIDATION (REAL API CALL)   ");
  console.log("==================================================");

  // 1. Verify GEMINI_API_KEY is present
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Configuration Error: GEMINI_API_KEY is not defined in your environment.");
    console.error("Please export GEMINI_API_KEY before running this script.");
    process.exit(1);
  }

  // Mask and print API key for verification
  const maskedKey = apiKey.substring(0, 6) + "..." + apiKey.substring(apiKey.length - 4);
  console.log(`Detected GEMINI_API_KEY: ${maskedKey}`);

  // 2. Enable real-time step logging
  process.env.DEBUG_AGENT = "true";

  // 3. Initialize ToolRegistry and register our three tools
  const registry = new ToolRegistry();
  registry.register(new GetPortfolioAndMarketStateTool());
  registry.register(new AdvanceMarketTickTool());
  registry.register(new ExecuteAssetTradeTool());

  console.log("\nRegistered Tools in Registry:");
  registry.getAll().forEach((tool) => {
    console.log(`- ${tool.name} (ReadOnly: ${tool.isReadOnly}, Risk: ${tool.riskLevel})`);
  });

  // 4. Instantiate AgentExecutor
  const executor = new AgentExecutor(registry);

  // 5. Scenario Query (Purely read-only)
  const instruction = "Check my current portfolio and market prices, then summarize the current portfolio state.";
  console.log(`\nUser Instruction: "${instruction}"`);
  console.log("Sending request to Gemini and starting Agent Loop...");

  try {
    const start = Date.now();
    const result = await executor.execute(instruction, 5);
    const duration = Date.now() - start;

    console.log("\n==================================================");
    console.log("                 AGENT LOOP RESULT                ");
    console.log("==================================================");
    console.log(`Success           : ${result.success}`);
    console.log(`Execution Steps   : ${result.steps.length}`);
    console.log(`Execution Time    : ${(duration / 1000).toFixed(2)}s`);
    console.log("\nFinal Natural-Language Response:\n");
    console.log(result.finalResponse);
    console.log("==================================================");

    if (result.success && result.steps.length > 0) {
      console.log("\nValidation Succeeded! The Agent ↔ Tool loop is fully verified with the real Gemini API.");
    } else {
      console.log("\nValidation Completed, but either no steps were taken or the agent did not complete successfully.");
    }
  } catch (error: any) {
    console.error("\nUnexpected Validation Crash:", error?.message || error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal exception:", err);
  process.exit(1);
});
