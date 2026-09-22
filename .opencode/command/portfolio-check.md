---
description: Perform a read-only portfolio check using the get_portfolio_and_market_state capability
---

Execute the read-only portfolio-check workflow.

Target Asset Symbol: "$ARGUMENTS"

Instructions:
1. Re-use the existing agent/tool architecture by executing the `get_portfolio_and_market_state` capability.
2. Under no circumstances query SQLite directly (no raw SQL queries or direct sqlite3 access). All portfolio and market state must be retrieved via `get_portfolio_and_market_state`.
3. Execute the check using the tool runner:
   npx tsx src/lib/agent/tools/portfolioCheckRunner.ts $ARGUMENTS
4. Ensure this operation is strictly read-only:
   - Do NOT execute trades.
   - Do NOT trigger market ticks.
   - Do NOT mutate the database or portfolio state.
5. If an optional symbol argument was provided (e.g. BTC, ETH, SOL), filter and display details for that asset alongside cash balance and net asset value (NAV). If no symbol was provided, display all holdings.
