import { vi, describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Must run before static imports are resolved: db/client.ts opens the database
// eagerly, so the isolated file is removed and selected before it is imported.
vi.hoisted(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dbPath = path.resolve(process.cwd(), "agent-test.db");
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-journal`, { force: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
});

const testDbPath = path.resolve(process.cwd(), "agent-test.db");

const mockGenerateContent = vi.fn();
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

import { db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { askAgent } from "../agent";

describe("Agent Server Action Transport Boundary", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const journalPath = `${testDbPath}-journal`;
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
  });

  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "mock-api-key-for-agent-tests";
    vi.clearAllMocks();

    await db.execute("DELETE FROM orders");
    await db.execute("DELETE FROM portfolio_holdings");
    await db.execute("DELETE FROM market_history");
    await db.execute("UPDATE portfolio_state SET cash = 100000.0, updated_at = ? WHERE id = 1", [new Date().toISOString()]);
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("should reject empty or whitespace-only instructions", async () => {
    const result = await askAgent("");
    expect(result.success).toBe(false);
    expect(result.finalResponse).toContain("non-empty");
    expect(result.steps).toEqual([]);
  });

  it("should reject null instruction", async () => {
    const nullResult = await askAgent(null as any);
    expect(nullResult.success).toBe(false);
    expect(nullResult.finalResponse).toContain("non-empty");
    expect(nullResult.steps).toEqual([]);
  });

  it("should reject undefined instruction", async () => {
    const undefinedResult = await askAgent(undefined as any);
    expect(undefinedResult.success).toBe(false);
    expect(undefinedResult.finalResponse).toContain("non-empty");
    expect(undefinedResult.steps).toEqual([]);
  });

  it("should execute a read-only portfolio query and return structured steps", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "Your portfolio shows $100,000 cash and no holdings.",
      candidates: [{
        content: {
          parts: [{ text: "Your portfolio shows $100,000 cash and no holdings." }],
        },
      }],
    });

    const result = await askAgent("Check my portfolio");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].arguments).toEqual({});
    expect(result.finalResponse).toBe("Your portfolio shows $100,000 cash and no holdings.");
  });

  it("should handle unknown tool names gracefully with TOOL_NOT_FOUND", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "nonexistent_tool", args: { ticker: "BTC" } },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "Tool not available.",
      candidates: [{
        content: {
          parts: [{ text: "Tool not available." }],
        },
      }],
    });

    const result = await askAgent("Use unknown tool");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("nonexistent_tool");
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].resultSummary).toContain("TOOL_NOT_FOUND");
  });

  it("should return max steps exceeded when agent loops", async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    const result = await askAgent("Loop check");

    expect(result.success).toBe(false);
    expect(result.finalResponse).toContain("Limit Exceeded");
    expect(result.steps).toHaveLength(5);
  });

  it("should handle a multi-step agent execution", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "You have $100,000 cash.",
      candidates: [{
        content: {
          parts: [{ text: "You have $100,000 cash." }],
        },
      }],
    });

    const result = await askAgent("Check my balance");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].stepNumber).toBe(1);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(result.finalResponse).toBe("You have $100,000 cash.");
  });

  it("should format trade tool results in agent activity", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: { symbol: "BTC", side: "BUY", quantity: 0.5, reason: "Testing trade execution boundary.", confidence: 0.8 },
            },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "Trade submitted.",
      candidates: [{
        content: {
          parts: [{ text: "Trade submitted." }],
        },
      }],
    });

    const result = await askAgent("Buy 0.5 BTC");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("execute_asset_trade");
    expect(result.steps[0].arguments.symbol).toBe("BTC");
    expect(result.steps[0].arguments.side).toBe("BUY");
    expect(result.finalResponse).toBe("Trade submitted.");
  });
});
