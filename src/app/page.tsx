"use client";

import { useState, useEffect, FormEvent } from "react";
import {
  getDashboardData,
  triggerTick,
  executeTrade,
  DashboardData,
} from "./actions/trading";
import { askAgent, AgentExecutionResult } from "./actions/agent";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatPrice(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(2)}`;
}

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [agentInput, setAgentInput] = useState("");
  const [agentResult, setAgentResult] = useState<AgentExecutionResult | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [tickLoading, setTickLoading] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);

  const [tradeSymbol, setTradeSymbol] = useState("BTC");
  const [tradeSide, setTradeSide] = useState<"BUY" | "SELL">("BUY");
  const [tradeQuantity, setTradeQuantity] = useState("");
  const [tradeResult, setTradeResult] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);

  const loadDashboard = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const data = await getDashboardData();
      setDashboardData(data);
    } catch {
      setDataError("Failed to load dashboard data. Please try again.");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const handleAskAgent = async () => {
    setAgentLoading(true);
    setAgentError(null);
    setAgentResult(null);
    try {
      const result = await askAgent(agentInput);
      setAgentResult(result);
    } catch {
      setAgentError("An error occurred while communicating with the agent.");
    } finally {
      setAgentLoading(false);
    }
  };

  const handleAdvanceTick = async () => {
    setTickLoading(true);
    setTickError(null);
    try {
      await triggerTick();
      await loadDashboard();
    } catch {
      setTickError("Failed to advance market tick. Please try again.");
    } finally {
      setTickLoading(false);
    }
  };

  const handleExecuteTrade = async (e: FormEvent) => {
    e.preventDefault();
    setTradeLoading(true);
    setTradeError(null);
    setTradeResult(null);

    const quantity = parseFloat(tradeQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      setTradeError("Quantity must be a positive number.");
      setTradeLoading(false);
      return;
    }

    try {
      const result = await executeTrade(tradeSymbol, tradeSide, quantity);
      if (result.status === "EXECUTED") {
        setTradeResult(
          `${tradeSide} ${quantity} ${tradeSymbol} executed successfully. (Order ID: ${result.orderId})`
        );
      } else {
        setTradeResult(
          `${tradeSide} ${quantity} ${tradeSymbol} was ${result.status.toLowerCase()}: ${result.reason || "No reason provided."}`
        );
      }
      await loadDashboard();
    } catch {
      setTradeError("Trade execution failed. Please try again.");
    } finally {
      setTradeLoading(false);
    }
  };

  const prices = dashboardData?.prices ?? { BTC: 0, ETH: 0, SOL: 0 };

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            AI Trading Workstation
          </h1>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Local / Mock Exchange
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Portfolio Summary */}
        <section className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-black p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Portfolio Summary
          </h2>
          {dataLoading ? (
            <div className="text-sm text-gray-400">Loading portfolio…</div>
          ) : dataError ? (
            <div className="text-sm text-red-400">{dataError}</div>
          ) : dashboardData ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Cash</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(dashboardData.cash)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Holdings Value</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(dashboardData.holdingsValue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Net Asset Value</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(dashboardData.netAssetValue)}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {/* Market */}
        <section className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-black p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Market
          </h2>
          {dataLoading ? (
            <div className="text-sm text-gray-400">Loading market…</div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {(["BTC", "ETH", "SOL"] as const).map((symbol) => (
                <div key={symbol} className="text-center">
                  <p className="text-xs text-gray-500 mb-1">{symbol}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {formatPrice(prices[symbol] ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Agent Panel */}
        <section className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-black p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Agent Panel
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !agentLoading) {
                  handleAskAgent();
                }
              }}
              placeholder="Ask the agent, e.g. Check my current portfolio and market prices."
              disabled={agentLoading}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
            />
            <button
              onClick={handleAskAgent}
              disabled={agentLoading || !agentInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {agentLoading ? "Thinking…" : "Ask Agent"}
            </button>
          </div>

          {agentError && (
            <div className="mt-3 text-sm text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
              {agentError}
            </div>
          )}

          {agentResult && (
            <div className="mt-4 space-y-3">
              <div className="text-sm bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Agent:
                </span>{" "}
                <span className="text-gray-700 dark:text-gray-300">
                  {agentResult.finalResponse}
                </span>
              </div>

              {agentResult.steps.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Agent Activity
                  </p>
                  <div className="space-y-2">
                    {agentResult.steps.map((step) => (
                      <div
                        key={step.stepNumber}
                        className="border border-gray-200 dark:border-gray-800 rounded-md p-3 text-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            Step {step.stepNumber}: {step.toolName}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              step.success
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                          >
                            {step.success ? "Success" : "Failed"}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                          <p>
                            <span className="font-medium text-gray-600 dark:text-gray-300">
                              Arguments:
                            </span>{" "}
                            <code className="bg-gray-100 dark:bg-gray-900 px-1 rounded">
                              {JSON.stringify(step.arguments)}
                            </code>
                          </p>
                          <p>
                            <span className="font-medium text-gray-600 dark:text-gray-300">
                              Result:
                            </span>{" "}
                            <span className="text-gray-700 dark:text-gray-300">
                              {step.resultSummary}
                            </span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Market Action */}
        <section className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-black p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Market Action
          </h2>
          <button
            onClick={handleAdvanceTick}
            disabled={tickLoading}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {tickLoading ? "Advancing…" : "Advance Market Tick"}
          </button>
          {tickError && (
            <div className="mt-3 text-sm text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
              {tickError}
            </div>
          )}
        </section>

        {/* Trade Action */}
        <section className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-black p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Trade
          </h2>
          <form onSubmit={handleExecuteTrade} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Symbol</label>
              <select
                value={tradeSymbol}
                onChange={(e) => setTradeSymbol(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="SOL">SOL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Side</label>
              <select
                value={tradeSide}
                onChange={(e) => setTradeSide(e.target.value as "BUY" | "SELL")}
                className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                value={tradeQuantity}
                onChange={(e) => setTradeQuantity(e.target.value)}
                placeholder="0.0"
                disabled={tradeLoading}
                className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={tradeLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {tradeLoading ? "Executing…" : "Execute"}
            </button>
          </form>

          {tradeError && (
            <div className="mt-3 text-sm text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
              {tradeError}
            </div>
          )}
          {tradeResult && (
            <div className="mt-3 text-sm bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
              {tradeResult}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
