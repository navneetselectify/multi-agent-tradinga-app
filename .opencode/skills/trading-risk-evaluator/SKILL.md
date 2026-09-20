---
name: trading-risk-evaluator
description: Use when evaluating the financial and execution risk of proposed trades (BUY or SELL) for assets like BTC, ETH, and SOL against current portfolio cash, active holdings, and market prices.
---

# Trading Risk Evaluator

Standard operating procedure and rules for evaluating the financial, exposure, and execution risks of a proposed trade in the trading dashboard without executing the trade.

## Risk Assessment Rules

1. **Asset Eligibility:**
   - Supported assets: `BTC`, `ETH`, `SOL`. Any other asset is unsupported and rejected.

2. **Action Validation:**
   - Supported actions: `BUY`, `SELL`.
   - Proposed quantity must be a positive finite number (> 0).

3. **Capital & Liquidity Constraint (BUY):**
   - Calculate required capital: `Required Cash = Quantity × Current Market Price`.
   - Verify: `Current Cash Balance >= Required Cash`.
   - If `Current Cash Balance < Required Cash`, the trade violates hard risk limits (insufficient cash).

4. **Inventory & Position Constraint (SELL):**
   - Check current holdings for the target symbol.
   - Verify: `Available Quantity >= Proposed Quantity`.
   - If `Available Quantity < Proposed Quantity`, the trade violates hard risk limits (insufficient holdings / naked shorting disallowed).

5. **Concentration & Allocation Risk:**
   - Assess post-trade allocation: `Post-Trade Asset Value / Post-Trade Net Asset Value (NAV)`.
   - Highlight portfolio concentration if a single position represents > 50% of NAV.

6. **Safety Mandate:**
   - Evaluation is strictly read-only.
   - Do NOT execute orders or mutate state during evaluation.
