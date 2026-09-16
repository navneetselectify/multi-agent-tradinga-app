import { Schema, Type } from "@google/genai";

/**
 * Enforces structured trading decision format from Gemini.
 */
export const tradingDecisionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["BUY", "SELL", "HOLD"],
      description: "The recommended trading action.",
    },
    symbol: {
      type: Type.STRING,
      enum: ["BTC", "ETH", "SOL"],
      description: "The cryptocurrency asset symbol.",
    },
    quantity: {
      type: Type.NUMBER,
      description: "The quantity to execute. This must be 0 for HOLD decisions, and strictly positive (> 0) for BUY or SELL decisions.",
    },
    confidence: {
      type: Type.NUMBER,
      description: "A confidence score between 0.0 and 1.0 (inclusive).",
    },
    reason: {
      type: Type.STRING,
      description: "A brief, high-level analysis or reason explaining the decision.",
    },
  },
  required: ["action", "symbol", "quantity", "confidence", "reason"],
};
