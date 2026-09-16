import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Define a module-level mock variable for generateContent
const mockGenerateContent = vi.fn();

// Mock the GoogleGenAI module
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

import { AIService, TradingContext } from "../service";

describe("Gemini AI Integration", () => {
  const dummyContext: TradingContext = {
    cash: 100000.0,
    holdings: [],
    currentPrices: [
      { symbol: "BTC", price: 60000.0 },
      { symbol: "ETH", price: 3000.0 },
      { symbol: "SOL", price: 150.0 },
    ],
    recentHistory: [],
  };

  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "mock-api-key-for-tests";
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("should successfully parse and validate a structured BUY decision", async () => {
    // Mock the raw JSON response text returned from Gemini
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "BUY",
        symbol: "BTC",
        quantity: 0.5,
        confidence: 0.85,
        reason: "Bitcoin shows strong support at 60k with high buying volume.",
      }),
    });

    const result = await AIService.generateDecision(dummyContext);

    expect(result).toEqual({
      action: "BUY",
      symbol: "BTC",
      quantity: 0.5,
      confidence: 0.85,
      reason: "Bitcoin shows strong support at 60k with high buying volume.",
    });

    // Verify the mock SDK was called correctly
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("should successfully parse and validate a structured SELL decision", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "SELL",
        symbol: "ETH",
        quantity: 2.0,
        confidence: 0.75,
        reason: "Ethereum is hitting dynamic overhead resistance.",
      }),
    });

    const contextWithHoldings: TradingContext = {
      ...dummyContext,
      holdings: [{ symbol: "ETH", quantity: 5.0 }],
    };

    const result = await AIService.generateDecision(contextWithHoldings);

    expect(result.action).toBe("SELL");
    expect(result.symbol).toBe("ETH");
    expect(result.quantity).toBe(2.0);
    expect(result.confidence).toBe(0.75);
    expect(result.reason).toContain("resistance");
  });

  it("should successfully parse and validate a HOLD decision (requiring exactly 0 quantity)", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "HOLD",
        symbol: "SOL",
        quantity: 0,
        confidence: 0.9,
        reason: "Solana is consolidating sideways; waiting for a breakout confirmation.",
      }),
    });

    const result = await AIService.generateDecision(dummyContext);

    expect(result.action).toBe("HOLD");
    expect(result.quantity).toBe(0);
  });

  it("should reject decisions recommending unsupported symbols", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "BUY",
        symbol: "DOGE", // Doge is not supported!
        quantity: 100,
        confidence: 0.8,
        reason: "Meme sentiment is high.",
      }),
    });

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      'Validation Failure: Unsupported asset symbol "DOGE"'
    );
  });

  it("should reject decisions with an invalid out-of-bounds confidence score", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "BUY",
        symbol: "BTC",
        quantity: 1.0,
        confidence: 1.5, // Invalid! Range must be [0.0 - 1.0]
        reason: "Ultra confident.",
      }),
    });

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Validation Failure: Confidence score"
    );
  });

  it("should reject BUY actions recommending a non-positive quantity", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "BUY",
        symbol: "BTC",
        quantity: 0, // Invalid for BUY! Must be > 0
        confidence: 0.8,
        reason: "Wants to buy nothing.",
      }),
    });

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Validation Failure: BUY actions require a positive quantity (> 0)."
    );
  });

  it("should reject HOLD actions recommending a non-zero quantity", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        action: "HOLD",
        symbol: "BTC",
        quantity: 1.5, // Invalid for HOLD! Must be exactly 0
        confidence: 0.8,
        reason: "Holding but holding with a non-zero quantity.",
      }),
    });

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Validation Failure: HOLD actions require a quantity of exactly 0."
    );
  });

  it("should reject malformed or non-JSON model responses", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "Not a JSON response. I recommend BUY BTC.",
    });

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Malformed Response: Failed to parse Gemini response as JSON"
    );
  });

  it("should propagate native Gemini API content generation failures", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Quota Exceeded"));

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Gemini API Failure: Quota Exceeded"
    );
  });

  it("should throw an explicit configuration error if GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(AIService.generateDecision(dummyContext)).rejects.toThrow(
      "Configuration Error: GEMINI_API_KEY is not defined in the environment."
    );
  });
});
