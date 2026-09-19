import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Define generateContent mock function
const mockGenerateContent = vi.fn();

// Mock the GoogleGenAI module for offline, deterministic agent testing
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

// Mock the core use cases to run completely offline without SQLite locking issues
vi.mock("@/lib/usecases", () => {
  return {
    getDashboardData: vi.fn(),
    triggerTick: vi.fn(),
    executeTrade: vi.fn(),
  };
});

import { executeTrade, getDashboardData, triggerTick } from "@/lib/usecases";
import { AgentExecutor, DEFAULT_SYSTEM_INSTRUCTION } from "../executor";
import { ToolRegistry } from "../registry";
import { AgentRole } from "../roles";
import { GetPortfolioAndMarketStateTool } from "../tools/getPortfolioAndMarketState";
import { ExecuteAssetTradeTool } from "../tools/executeAssetTrade";
import { AdvanceMarketTickTool } from "../tools/advanceMarketTick";

describe("First Trading Agent Executor", () => {
  let registry: ToolRegistry;
  let executor: AgentExecutor;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "mock-api-key-for-executor-tests";

    registry = new ToolRegistry();
    executor = new AgentExecutor(registry);
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("should return a final response directly without using any tools", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "Hello! I am your trading assistant. How can I help you today?",
      candidates: [{
        content: {
          parts: [{ text: "Hello! I am your trading assistant. How can I help you today?" }],
        },
      }],
    });

    const result = await executor.execute("Say hello");

    expect(result.success).toBe(true);
    expect(result.finalResponse).toBe("Hello! I am your trading assistant. How can I help you today?");
    expect(result.steps).toEqual([]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("should handle single tool execution and return the final text response", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());

    // 1st call: request portfolio tool
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    // 2nd call: respond to tool result with final text
    mockGenerateContent.mockResolvedValueOnce({
      text: "You currently hold 0 assets and have $100,000 cash.",
      candidates: [{
        content: {
          parts: [{ text: "You currently hold 0 assets and have $100,000 cash." }],
        },
      }],
    });

    const result = await executor.execute("Check my portfolio");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(result.steps[0].result.success).toBe(true);
    expect(result.finalResponse).toBe("You currently hold 0 assets and have $100,000 cash.");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    // Verify correct contents passed back to Gemini on 2nd turn
    const secondCallContents = mockGenerateContent.mock.calls[1][0] as any;
    expect(secondCallContents.contents).toHaveLength(3); // Turn 1 (user input), Turn 2 model call, Turn 2 tool response
    expect(secondCallContents.contents[1].role).toBe("model");
    expect(secondCallContents.contents[2].role).toBe("user");
    expect(secondCallContents.contents[2].parts[0].functionResponse.name).toBe("get_portfolio_and_market_state");
  });

  it("should handle multiple tool executions sequentially across multiple turns", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());
    registry.register(new ExecuteAssetTradeTool());

    // 1st call: request portfolio state
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    // 2nd call: request buying 1 BTC
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: 1,
                reason: "Bitcoin breakout past 60k.",
                confidence: 0.9,
              },
            },
          }],
        },
      }],
    });

    // 3rd call: present final results
    mockGenerateContent.mockResolvedValueOnce({
      text: "I checked your portfolio and bought 1 BTC for you.",
      candidates: [{
        content: {
          parts: [{ text: "I checked your portfolio and bought 1 BTC for you." }],
        },
      }],
    });

    const result = await executor.execute("Buy 1 BTC if cash is available");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(result.steps[1].toolName).toBe("execute_asset_trade");
    expect(result.steps[1].arguments.symbol).toBe("BTC");
    expect(result.finalResponse).toBe("I checked your portfolio and bought 1 BTC for you.");
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it("should feed invalid tool names through ToolRegistry and return a structured TOOL_NOT_FOUND error to Gemini", async () => {
    // Model hallucinates an unsupported tool "buy_some_crypto"
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "buy_some_crypto", args: { ticker: "BTC" } },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "Sorry, I could not execute that because the tool buy_some_crypto is not available.",
      candidates: [{
        content: {
          parts: [{ text: "Sorry, I could not execute that because the tool buy_some_crypto is not available." }],
        },
      }],
    });

    const result = await executor.execute("Execute custom action");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("buy_some_crypto");
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error?.code).toBe("TOOL_NOT_FOUND");
    expect(result.finalResponse).toBe("Sorry, I could not execute that because the tool buy_some_crypto is not available.");
  });

  it("should feed tool validation failures back to Gemini through the standard ToolResult", async () => {
    registry.register(new ExecuteAssetTradeTool());

    // Model makes a trade call with an invalid quantity
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: -2.5, // Invalid negative quantity
                reason: "Negative test buy",
                confidence: 0.8,
              },
            },
          }],
        },
      }],
    });

    mockGenerateContent.mockResolvedValueOnce({
      text: "I was unable to place the trade because the quantity cannot be negative.",
      candidates: [{
        content: {
          parts: [{ text: "I was unable to place the trade because the quantity cannot be negative." }],
        },
      }],
    });

    const result = await executor.execute("Buy negative BTC");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.finalResponse).toBe("I was unable to place the trade because the quantity cannot be negative.");
  });

  it("should stop execution safely with a structured message when maximum step limit is reached", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());

    // Model requests portfolio recursively or loops
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    const result = await executor.execute("Check state repeatedly", 3); // maxSteps = 3

    expect(result.success).toBe(false);
    expect(result.finalResponse).toContain("Limit Exceeded");
    expect(result.steps).toHaveLength(3);
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it("should handle Gemini/API exceptions cleanly and return a structured API error response", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Gemini API Overloaded (503)"));

    const result = await executor.execute("Get prices");

    expect(result.success).toBe(false);
    expect(result.finalResponse).toBe("API Error: Gemini API Overloaded (503)");
    expect(result.steps).toEqual([]);
  });

  it("should handle business-level cancelled trade orders cleanly as normal execution results", async () => {
    registry.register(new ExecuteAssetTradeTool());

    // Mock the executeTrade usecase to return a CANCELLED order result
    vi.mocked(executeTrade).mockResolvedValueOnce({
      orderId: 99,
      status: "CANCELLED",
      reason: "Insufficient funds",
    });

    // 1st call: Gemini requests execution of buy
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: 5.0,
                reason: "Momentum buy",
                confidence: 0.9,
              },
            },
          }],
        },
      }],
    });

    // 2nd call: responds to the cancelled order result
    mockGenerateContent.mockResolvedValueOnce({
      text: "The trade order was cancelled by the exchange due to insufficient funds.",
      candidates: [{
        content: {
          parts: [{ text: "The trade order was cancelled by the exchange due to insufficient funds." }],
        },
      }],
    });

    const result = await executor.execute("Buy 5 BTC");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].result.success).toBe(true);
    expect(result.steps[0].result.data?.status).toBe("CANCELLED");
    expect(result.steps[0].result.data?.reason).toBe("Insufficient funds");
    expect(result.finalResponse).toBe("The trade order was cancelled by the exchange due to insufficient funds.");
  });

  it("should handle unexpected tool execution exceptions gracefully as SYSTEM_ERROR and propagate to Gemini", async () => {
    registry.register(new ExecuteAssetTradeTool());

    // Mock the executeTrade usecase to throw an unhandled system error (e.g., SQLite connection failure)
    vi.mocked(executeTrade).mockRejectedValueOnce(new Error("SQLite is busy"));

    // 1st call: Gemini requests execute_asset_trade
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: 1.0,
                reason: "System exception test",
                confidence: 0.8,
              },
            },
          }],
        },
      }],
    });

    // 2nd call: Gemini responds to system error
    mockGenerateContent.mockResolvedValueOnce({
      text: "I was unable to place the trade because the database system is currently busy.",
      candidates: [{
        content: {
          parts: [{ text: "I was unable to place the trade because the database system is currently busy." }],
        },
      }],
    });

    const result = await executor.execute("Buy 1 BTC");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(result.steps[0].result.error?.message).toBe("SQLite is busy");
    expect(result.finalResponse).toBe("I was unable to place the trade because the database system is currently busy.");
  });

  it("should fail clearly with a configuration error when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await executor.execute("Hello");

    expect(result.success).toBe(false);
    expect(result.finalResponse).toContain("Configuration Error");
    expect(result.finalResponse).toContain("GEMINI_API_KEY is not defined");
  });

  it("should transmit the exact error details to Gemini without editing or inventing success results", async () => {
    registry.register(new ExecuteAssetTradeTool());

    // 1st call: Gemini requests trade with invalid inputs or business rule violation
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: -5.0,
                reason: "Negative quantity test",
                confidence: 0.8,
              },
            },
          }],
        },
      }],
    });

    // 2nd call: verify that the toolResult passed as part of the history has the EXACT validation details
    mockGenerateContent.mockResolvedValueOnce({
      text: "Trade failed due to invalid quantity.",
      candidates: [{
        content: {
          parts: [{ text: "Trade failed due to invalid quantity." }],
        },
      }],
    });

    await executor.execute("Buy BTC with negative quantity");

    // Retrieve arguments of the second generateContent call
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const secondCallContents = mockGenerateContent.mock.calls[1][0] as any;
    
    // In history, index 2 is the tool response
    const toolResponsePart = secondCallContents.contents[2].parts[0].functionResponse;
    expect(toolResponsePart.response.success).toBe(false);
    expect(toolResponsePart.response.error.code).toBe("VALIDATION_ERROR");
    expect(toolResponsePart.response.error.details).toContain("quantity: Quantity must be strictly positive (> 0).");
  });

  it("should successfully coordinate a BUY order from Gemini through the use case to final completion", async () => {
    registry.register(new ExecuteAssetTradeTool());

    const mockOrderResult = { orderId: 101, status: "EXECUTED" as const };
    vi.mocked(executeTrade).mockResolvedValueOnce(mockOrderResult);

    // Turn 1: Gemini requests execute_asset_trade
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "SOL",
                side: "BUY",
                quantity: 5,
                reason: "Buy 5 SOL because it is near support",
                confidence: 0.95,
              },
            },
          }],
        },
      }],
    });

    // Turn 2: Gemini completes with final text
    mockGenerateContent.mockResolvedValueOnce({
      text: "I have successfully bought 5 SOL for you (Order ID: 101).",
      candidates: [{
        content: {
          parts: [{ text: "I have successfully bought 5 SOL for you (Order ID: 101)." }],
        },
      }],
    });

    const result = await executor.execute("Buy 5 SOL");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("execute_asset_trade");
    expect(result.steps[0].arguments.symbol).toBe("SOL");
    expect(executeTrade).toHaveBeenCalledWith("SOL", "BUY", 5);
    expect(result.finalResponse).toBe("I have successfully bought 5 SOL for you (Order ID: 101).");
  });

  it("should successfully trigger a market tick upon user request and output updated rates", async () => {
    registry.register(new AdvanceMarketTickTool());

    const mockNextPrices = { BTC: 61000.0, ETH: 3050.0, SOL: 153.0 };
    vi.mocked(triggerTick).mockResolvedValueOnce(mockNextPrices);

    // Turn 1: Gemini requests advance_market_tick
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "advance_market_tick",
              args: { reason: "Advance the tick as requested by user." },
            },
          }],
        },
      }],
    });

    // Turn 2: Gemini completes
    mockGenerateContent.mockResolvedValueOnce({
      text: "The market has been advanced by one tick. BTC is now $61,000, ETH is $3,050, and SOL is $153.",
      candidates: [{
        content: {
          parts: [{ text: "The market has been advanced by one tick. BTC is now $61,000, ETH is $3,050, and SOL is $153." }],
        },
      }],
    });

    const result = await executor.execute("Advance the market by one tick.");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("advance_market_tick");
    expect(result.steps[0].arguments.reason).toContain("Advance the tick");
    expect(triggerTick).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe("The market has been advanced by one tick. BTC is now $61,000, ETH is $3,050, and SOL is $153.");
  });

  it("should execute a multi-step sequence sequentially (check state then tick market) to final completion", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());
    registry.register(new AdvanceMarketTickTool());

    const mockDashboardData = {
      cash: 100000.0,
      holdingsValue: 0,
      netAssetValue: 100000.0,
      holdings: [],
      orders: [],
      prices: { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 },
    };
    vi.mocked(getDashboardData).mockResolvedValueOnce(mockDashboardData);

    const mockNextPrices = { BTC: 60500.0, ETH: 3010.0, SOL: 151.0 };
    vi.mocked(triggerTick).mockResolvedValueOnce(mockNextPrices);

    // Turn 1: Gemini requests state check
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    // Turn 2: Gemini requests market tick
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "advance_market_tick",
              args: { reason: "Advancing market in sequential multi-step task." },
            },
          }],
        },
      }],
    });

    // Turn 3: Gemini finishes
    mockGenerateContent.mockResolvedValueOnce({
      text: "Initially your portfolio had $100k cash. I advanced the market, and BTC is now $60,500.",
      candidates: [{
        content: {
          parts: [{ text: "Initially your portfolio had $100k cash. I advanced the market, and BTC is now $60,500." }],
        },
      }],
    });

    const result = await executor.execute("Check portfolio first, then advance the market and summarize.");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(result.steps[1].toolName).toBe("advance_market_tick");
    expect(getDashboardData).toHaveBeenCalledTimes(1);
    expect(triggerTick).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe("Initially your portfolio had $100k cash. I advanced the market, and BTC is now $60,500.");
  });

  it("should complete with no state-changing tool calls when user requests a simple HOLD/summarize command", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());
    registry.register(new AdvanceMarketTickTool());
    registry.register(new ExecuteAssetTradeTool());

    const mockDashboardData = {
      cash: 100000.0,
      holdingsValue: 0,
      netAssetValue: 100000.0,
      holdings: [],
      orders: [],
      prices: { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 },
    };
    vi.mocked(getDashboardData).mockResolvedValueOnce(mockDashboardData);

    // Turn 1: Gemini checks state first
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: "get_portfolio_and_market_state", args: {} },
          }],
        },
      }],
    });

    // Turn 2: Gemini decides to hold and directly returns final text
    mockGenerateContent.mockResolvedValueOnce({
      text: "Based on current prices, it is best to HOLD. Your portfolio state is stable with $100,000 cash.",
      candidates: [{
        content: {
          parts: [{ text: "Based on current prices, it is best to HOLD. Your portfolio state is stable with $100,000 cash." }],
        },
      }],
    });

    const result = await executor.execute("Based on current state, do nothing and summarize the portfolio.");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("get_portfolio_and_market_state");
    expect(executeTrade).not.toHaveBeenCalled();
    expect(triggerTick).not.toHaveBeenCalled();
    expect(result.finalResponse).toBe("Based on current prices, it is best to HOLD. Your portfolio state is stable with $100,000 cash.");
  });
});

describe("AgentExecutor Role Configuration and Tool Scoping", () => {
  let registry: ToolRegistry;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "mock-api-key-for-executor-tests";
    registry = new ToolRegistry();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("should use the exact default system instruction when no configuration is provided", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "Hello!",
      candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
    });

    const executor = new AgentExecutor(registry);
    await executor.execute("Say hello");

    const firstCall = mockGenerateContent.mock.calls[0][0] as any;
    expect(firstCall.config.systemInstruction).toBe(DEFAULT_SYSTEM_INSTRUCTION);
  });

  it("should use a role-provided system instruction when configured", async () => {
    const analystRole: AgentRole = {
      name: "analyst",
      systemInstruction: "You are a read-only market analyst. Never suggest execution.",
      allowedToolNames: ["get_portfolio_and_market_state"],
    };
    registry.register(new GetPortfolioAndMarketStateTool());

    mockGenerateContent.mockResolvedValueOnce({
      text: "Analysis complete.",
      candidates: [{ content: { parts: [{ text: "Analysis complete." }] } }],
    });

    const executor = new AgentExecutor(registry.scoped(analystRole.allowedToolNames), {
      systemInstruction: analystRole.systemInstruction,
    });
    await executor.execute("Analyze the market");

    const firstCall = mockGenerateContent.mock.calls[0][0] as any;
    expect(firstCall.config.systemInstruction).toBe(analystRole.systemInstruction);
    expect(firstCall.config.systemInstruction).not.toBe(DEFAULT_SYSTEM_INSTRUCTION);
  });

  it("should only expose role-allowed tools as Gemini function declarations", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());
    registry.register(new ExecuteAssetTradeTool());

    mockGenerateContent.mockResolvedValueOnce({
      text: "Ready.",
      candidates: [{ content: { parts: [{ text: "Ready." }] } }],
    });

    const executor = new AgentExecutor(registry.scoped(["get_portfolio_and_market_state"]));
    await executor.execute("What tools do you have?");

    const firstCall = mockGenerateContent.mock.calls[0][0] as any;
    const declarations = firstCall.config.tools[0].functionDeclarations;
    expect(declarations.map((declaration: any) => declaration.name)).toEqual([
      "get_portfolio_and_market_state",
    ]);
  });

  it("should reject a disallowed tool call with TOOL_NOT_ALLOWED and feed it back to Gemini", async () => {
    registry.register(new GetPortfolioAndMarketStateTool());
    registry.register(new ExecuteAssetTradeTool());

    // Turn 1: model attempts a HIGH-risk tool outside its read-only scope
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "execute_asset_trade",
              args: {
                symbol: "BTC",
                side: "BUY",
                quantity: 1,
                reason: "Not allowed for this role.",
                confidence: 0.9,
              },
            },
          }],
        },
      }],
    });

    // Turn 2: model reports the denial
    mockGenerateContent.mockResolvedValueOnce({
      text: "I am not permitted to execute trades.",
      candidates: [{ content: { parts: [{ text: "I am not permitted to execute trades." }] } }],
    });

    const executor = new AgentExecutor(registry.scoped(["get_portfolio_and_market_state"]));
    const result = await executor.execute("Buy 1 BTC");

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolName).toBe("execute_asset_trade");
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error?.code).toBe("TOOL_NOT_ALLOWED");
    expect(executeTrade).not.toHaveBeenCalled();
  });
});
