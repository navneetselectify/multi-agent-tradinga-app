import { getGeminiClient } from "./client";
import { tradingDecisionSchema } from "./schemas";

export interface Holding {
  symbol: string;
  quantity: number;
}

export interface MarketPrice {
  symbol: string;
  price: number;
}

export interface HistoricalPrice {
  symbol: string;
  price: number;
  timestamp: string;
}

export interface TradingContext {
  cash: number;
  holdings: Holding[];
  currentPrices: MarketPrice[];
  recentHistory: HistoricalPrice[]; // Bounded window (e.g., last 10 entries)
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "HOLD";
  symbol: "BTC" | "ETH" | "SOL";
  quantity: number;
  confidence: number;
  reason: string;
}

export class AIService {
  /**
   * Generates an AI-driven trading decision based on current market and portfolio context.
   * Leverages Gemini with JSON Schema enforcement and performs strict semantic validation.
   */
  public static async generateDecision(context: TradingContext): Promise<TradingDecision> {
    const client = getGeminiClient();

    // 1. Build a highly structured and clear context string for the prompt
    const contextPrompt = `
You are an advanced, algorithmic trading agent. Your role is to analyze current portfolio states and price histories to output optimal trade actions (BUY, SELL, or HOLD) for three core assets: BTC, ETH, and SOL.

=== PORTFOLIO STATE ===
- Cash Balance (USD): $${context.cash.toFixed(2)}
- Current Holdings:
${
  context.holdings.length === 0
    ? "  None (You hold 0 assets. You can only BUY)."
    : context.holdings.map((h) => `  - ${h.symbol}: ${h.quantity}`).join("\n")
}

=== CURRENT TICK PRICES ===
${context.currentPrices.map((p) => `- ${p.symbol}: $${p.price.toFixed(2)}`).join("\n")}

=== RECENT PRICE HISTORIES (MAX 10 ENTRIES) ===
${
  context.recentHistory.length === 0
    ? "No historical data available yet."
    : context.recentHistory.map((h) => `- [${h.timestamp}] ${h.symbol}: $${h.price.toFixed(2)}`).join("\n")
}

=== TRADING CONSTRAINTS & RULES ===
1. You may only issue trade recommendations for BTC, ETH, or SOL.
2. BUY: You must have sufficient cash to execute the BUY (cash >= current_price * quantity). Quantity must be strictly greater than 0.
3. SELL: You must currently hold at least the requested quantity of that asset. Quantity must be strictly greater than 0.
4. HOLD: Do not recommend buying or selling. The quantity must be exactly 0.
5. Output your response strictly in the requested JSON structure. No formatting or preamble.
`;

    // 2. Invoke Gemini with strict JSON schema enforcement
    let response;
    try {
      response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contextPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: tradingDecisionSchema,
          temperature: 0.2, // Keep temperature low for deterministic analysis
        },
      });
    } catch (apiError: any) {
      throw new Error(`Gemini API Failure: ${apiError?.message || "Unknown error occurred during generateContent"}`);
    }

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("Malformed Response: Gemini returned an empty text field.");
    }

    // 3. Parse JSON Response
    let decision: any;
    try {
      decision = JSON.parse(jsonText);
    } catch (parseError: any) {
      throw new Error(`Malformed Response: Failed to parse Gemini response as JSON. Raw text: "${jsonText}". Error: ${parseError.message}`);
    }

    // 4. Semantic Validation & Constraint Integrity Checks
    const allowedActions = ["BUY", "SELL", "HOLD"];
    const allowedSymbols = ["BTC", "ETH", "SOL"];

    if (!decision || typeof decision !== "object") {
      throw new Error("Validation Failure: Gemini response is not a valid JSON object.");
    }

    // Validate Action
    if (!allowedActions.includes(decision.action)) {
      throw new Error(`Validation Failure: Unsupported trading action "${decision.action}". Allowed actions: ${allowedActions.join(", ")}`);
    }

    // Validate Symbol
    const uppercaseSymbol = String(decision.symbol || "").toUpperCase();
    if (!allowedSymbols.includes(uppercaseSymbol)) {
      throw new Error(`Validation Failure: Unsupported asset symbol "${decision.symbol}". Supported symbols: ${allowedSymbols.join(", ")}`);
    }
    decision.symbol = uppercaseSymbol; // Coerce to uppercase for consistency

    // Validate Confidence
    const confidence = Number(decision.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`Validation Failure: Confidence score "${decision.confidence}" is out of bounds [0.0 - 1.0].`);
    }
    decision.confidence = confidence;

    // Validate Quantity Semantics
    const quantity = Number(decision.quantity);
    if (isNaN(quantity) || quantity < 0) {
      throw new Error(`Validation Failure: Quantity "${decision.quantity}" cannot be negative.`);
    }

    if (decision.action === "HOLD") {
      if (quantity !== 0) {
        throw new Error(`Validation Failure: HOLD actions require a quantity of exactly 0. Received: ${quantity}.`);
      }
    } else {
      // action === 'BUY' or 'SELL'
      if (quantity <= 0) {
        throw new Error(`Validation Failure: ${decision.action} actions require a positive quantity (> 0). Received: ${quantity}.`);
      }
    }
    decision.quantity = quantity;

    // Validate Reason
    if (!decision.reason || typeof decision.reason !== "string" || decision.reason.trim() === "") {
      throw new Error("Validation Failure: Missing or empty justification in 'reason'.");
    }

    return decision as TradingDecision;
  }
}
