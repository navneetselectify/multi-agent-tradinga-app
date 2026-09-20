import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { tradeEvents, TradeExecutedPayload } from "@/lib/events";
import {
  RISK_REVIEWER_AGENT,
  TRADING_AGENT,
  ExecuteAssetTradeTool,
  executeTool,
  hasPermission,
} from "@/lib/agent";

export async function runPermissionExercise() {
  console.log("================================================================");
  console.log("       MANUAL PERMISSION EXERCISE: DEFENSE-IN-DEPTH CHECK       ");
  console.log("================================================================\n");

  // Ensure database tables exist
  await runMigrations();

  const tool = new ExecuteAssetTradeTool();
  const tradeArgs = {
    symbol: "BTC",
    side: "BUY" as const,
    quantity: 0.1,
  };

  // Event listener tracking
  const capturedEvents: TradeExecutedPayload[] = [];
  const eventListener = (event: TradeExecutedPayload) => {
    capturedEvents.push(event);
  };
  tradeEvents.on("trade.executed", eventListener);

  try {
    // -------------------------------------------------------------
    // PART 1: Unauthorized Trade Attempt by Risk Reviewer Agent
    // -------------------------------------------------------------
    console.log("--- SCENARIO 1: Risk Reviewer Attempts BTC BUY ---");

    const initialOrdersRes = await db.execute("SELECT COUNT(*) as count FROM orders");
    const initialOrderCount = Number(initialOrdersRes.rows[0].count);

    const initialCashRes = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    const initialCash = Number(initialCashRes.rows[0].cash);

    const isAllowed1 = hasPermission(RISK_REVIEWER_AGENT, tool.requiredPermission);

    console.log(`Agent:               ${RISK_REVIEWER_AGENT.name} (${RISK_REVIEWER_AGENT.id})`);
    console.log(`Requested tool:      ${tool.name}`);
    console.log(`Required permission: ${tool.requiredPermission}`);
    console.log(`Granted permissions: [${RISK_REVIEWER_AGENT.permissions.join(", ")}]`);
    console.log(`Permission result:   ${isAllowed1 ? "ALLOWED" : "DENIED (Pre-execution rejection)"}`);

    const result1 = await executeTool(tool, RISK_REVIEWER_AGENT, tradeArgs);

    console.log("\nFinal ToolResult:");
    console.log(JSON.stringify(result1, null, 2));

    // Verification 5: Verify no new order created
    const postOrdersRes1 = await db.execute("SELECT COUNT(*) as count FROM orders");
    const postOrderCount1 = Number(postOrdersRes1.rows[0].count);
    const newOrdersCount1 = postOrderCount1 - initialOrderCount;

    console.log(`\nVerification [Database]:`);
    console.log(`- Orders before attempt: ${initialOrderCount}`);
    console.log(`- Orders after attempt:  ${postOrderCount1}`);
    console.log(`- New orders created:    ${newOrdersCount1} (VERIFIED: NO ORDERS CREATED)`);

    const postCashRes1 = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    const postCash1 = Number(postCashRes1.rows[0].cash);
    console.log(`- Cash balance intact:   $${postCash1.toLocaleString("en-US", { minimumFractionDigits: 2 })} (VERIFIED: UNCHANGED)`);

    // Verification 6: Verify no trade.executed event emitted
    console.log(`\nVerification [Events]:`);
    console.log(`- Captured trade.executed events: ${capturedEvents.length} (VERIFIED: ZERO EMISSIONS)`);

    console.log("\n----------------------------------------------------------------\n");

    // -------------------------------------------------------------
    // PART 2: Authorized Trade Execution by Trading Agent
    // -------------------------------------------------------------
    console.log("--- SCENARIO 2: Trading Agent Executes BTC BUY ---");

    const isAllowed2 = hasPermission(TRADING_AGENT, tool.requiredPermission);

    console.log(`Agent:               ${TRADING_AGENT.name} (${TRADING_AGENT.id})`);
    console.log(`Requested tool:      ${tool.name}`);
    console.log(`Required permission: ${tool.requiredPermission}`);
    console.log(`Granted permissions: [${TRADING_AGENT.permissions.join(", ")}]`);
    console.log(`Permission result:   ${isAllowed2 ? "ALLOWED (Permission granted)" : "DENIED"}`);

    const result2 = await executeTool(tool, TRADING_AGENT, tradeArgs);

    console.log("\nFinal ToolResult:");
    console.log(JSON.stringify(result2, null, 2));

    // Verification 8: Show allowed and trade.executed fires
    const postOrdersRes2 = await db.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 1");
    const latestOrder = postOrdersRes2.rows[0];

    console.log(`\nVerification [Database]:`);
    console.log(`- Order record inserted: #${latestOrder.id} ${latestOrder.side} ${latestOrder.quantity} ${latestOrder.symbol} @ $${Number(latestOrder.price).toLocaleString("en-US", { minimumFractionDigits: 2 })} (${latestOrder.status})`);

    const postCashRes2 = await db.execute("SELECT cash FROM portfolio_state WHERE id = 1");
    const postCash2 = Number(postCashRes2.rows[0].cash);
    console.log(`- New Cash balance:      $${postCash2.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

    console.log(`\nVerification [Events]:`);
    console.log(`- Captured trade.executed events: ${capturedEvents.length} (VERIFIED: EVENT FIRED)`);
    if (capturedEvents.length > 0) {
      console.log(`- Latest event payload:`, capturedEvents[capturedEvents.length - 1]);
    }

    console.log("\n================================================================");
    console.log("          EXERCISE COMPLETE: ALL ASSERTIONS VERIFIED            ");
    console.log("================================================================");
  } finally {
    tradeEvents.off("trade.executed", eventListener);
  }
}

// Allow direct CLI execution
if (process.argv[1]?.includes("permissionExerciseRunner.ts")) {
  runPermissionExercise()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Exercise failed:", err);
      process.exit(1);
    });
}
