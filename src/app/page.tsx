"use client";

import { useState, useEffect, FormEvent } from "react";
import {
  getDashboardData,
  triggerTick,
  executeTrade,
  getAIRecommendation,
  DashboardData,
} from "./actions/trading";
import { TradingDecision } from "@/lib/ai/service";

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

export default function TradingWorkstation() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Market tick state
  const [tickLoading, setTickLoading] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);

  // Trade form state
  const [tradeSymbol, setTradeSymbol] = useState<"BTC" | "ETH" | "SOL">("BTC");
  const [tradeSide, setTradeSide] = useState<"BUY" | "SELL">("BUY");
  const [tradeQuantity, setTradeQuantity] = useState("");
  const [tradeResult, setTradeResult] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);

  // AI Recommendation state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDecision, setAiDecision] = useState<TradingDecision | null>(null);

  const loadDashboard = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const data = await getDashboardData();
      setDashboardData(data);
    } catch {
      setDataError("Failed to load dashboard data. Please verify database connection.");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const handleAdvanceTick = async () => {
    setTickLoading(true);
    setTickError(null);
    try {
      await triggerTick();
      await loadDashboard();
    } catch {
      setTickError("Failed to advance market tick.");
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
          `Order #${result.orderId} EXECUTED: ${tradeSide} ${quantity} ${tradeSymbol}`
        );
        setTradeQuantity("");
      } else {
        setTradeResult(
          `Order #${result.orderId} CANCELLED: ${result.reason || "Validation rejected"}`
        );
      }
      await loadDashboard();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Trade execution failed.";
      setTradeError(msg);
    } finally {
      setTradeLoading(false);
    }
  };

  const handleGetAIRecommendation = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const decision = await getAIRecommendation();
      setAiDecision(decision);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to obtain AI recommendation.";
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  };

  const applyRecommendationToTrade = () => {
    if (!aiDecision || aiDecision.action === "HOLD") return;
    setTradeSymbol(aiDecision.symbol);
    setTradeSide(aiDecision.action);
    setTradeQuantity(String(aiDecision.quantity));
  };

  const prices = dashboardData?.prices ?? { BTC: 60000.0, ETH: 3000.0, SOL: 150.0 };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">Trading Workstation</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              Live Mock Exchange
            </span>
          </div>
          <button
            onClick={loadDashboard}
            disabled={dataLoading}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {dataLoading ? "Refreshing..." : "Refresh State"}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {dataError && (
          <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-sm">
            {dataError}
          </div>
        )}

        {/* Top Metrics Row: Portfolio Summary & Market Rates */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolio Summary */}
          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              Portfolio Summary
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Cash Balance</p>
                <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {dashboardData ? formatCurrency(dashboardData.cash) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Holdings Value</p>
                <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {dashboardData ? formatCurrency(dashboardData.holdingsValue) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Net Asset Value (NAV)</p>
                <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {dashboardData ? formatCurrency(dashboardData.netAssetValue) : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Market Prices & Tick Action */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Market Rates
                </h2>
                <button
                  onClick={handleAdvanceTick}
                  disabled={tickLoading}
                  className="text-xs px-3 py-1 font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {tickLoading ? "Advancing..." : "Advance Tick"}
                </button>
              </div>
              {tickError && (
                <p className="text-xs text-rose-500 mb-2">{tickError}</p>
              )}
              <div className="grid grid-cols-3 gap-3">
                {(["BTC", "ETH", "SOL"] as const).map((sym) => (
                  <div key={sym} className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center border border-zinc-100 dark:border-zinc-800">
                    <span className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400">{sym}</span>
                    <span className="block text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {formatPrice(prices[sym] ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-3">
              Market prices advance deterministically using the exchange engine.
            </p>
          </div>
        </div>

        {/* Middle Row: Active Holdings & Trade Form */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Holdings Table */}
          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              Active Holdings
            </h2>
            {dashboardData && dashboardData.holdings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400 font-medium">
                      <th className="pb-3">Asset</th>
                      <th className="pb-3">Quantity</th>
                      <th className="pb-3">Current Price</th>
                      <th className="pb-3 text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {dashboardData.holdings.map((h) => (
                      <tr key={h.symbol} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="py-3 font-semibold">{h.symbol}</td>
                        <td className="py-3 font-mono">{h.quantity}</td>
                        <td className="py-3 font-mono">{formatPrice(h.currentPrice)}</td>
                        <td className="py-3 text-right font-mono font-medium">
                          {formatCurrency(h.totalValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-zinc-400">
                No active holdings in portfolio. Available cash is ready for deployment.
              </div>
            )}
          </div>

          {/* Trade Execution Panel */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              Execute Order
            </h2>
            <form onSubmit={handleExecuteTrade} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    Asset
                  </label>
                  <select
                    value={tradeSymbol}
                    onChange={(e) => setTradeSymbol(e.target.value as "BTC" | "ETH" | "SOL")}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-zinc-400"
                  >
                    <option value="BTC">BTC</option>
                    <option value="ETH">ETH</option>
                    <option value="SOL">SOL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    Side
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => setTradeSide("BUY")}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        tradeSide === "BUY"
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeSide("SELL")}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        tradeSide === "SELL"
                          ? "bg-rose-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={tradeQuantity}
                  onChange={(e) => setTradeQuantity(e.target.value)}
                  placeholder="e.g. 1.5"
                  disabled={tradeLoading}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-zinc-400 placeholder:text-zinc-400 font-mono"
                />
              </div>

              <div className="text-xs text-zinc-500 dark:text-zinc-400 flex justify-between">
                <span>Estimated Price:</span>
                <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                  {formatPrice(prices[tradeSymbol] ?? 0)}
                </span>
              </div>

              <button
                type="submit"
                disabled={tradeLoading || !tradeQuantity}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  tradeSide === "BUY"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {tradeLoading ? "Submitting Order..." : `Submit ${tradeSide} Order`}
              </button>
            </form>

            {tradeError && (
              <div className="mt-3 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
                {tradeError}
              </div>
            )}
            {tradeResult && (
              <div className="mt-3 p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 font-mono">
                {tradeResult}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Row: AI Recommendation & Recent Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* AI Trading Agent Panel */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  AI Agent Advisory
                </h2>
                <button
                  onClick={handleGetAIRecommendation}
                  disabled={aiLoading}
                  className="text-xs px-3 py-1 font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {aiLoading ? "Consulting AI..." : "Get Recommendation"}
                </button>
              </div>

              {aiError && (
                <div className="p-3 mb-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
                  {aiError}
                </div>
              )}

              {aiDecision ? (
                <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                          aiDecision.action === "BUY"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : aiDecision.action === "SELL"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200"
                        }`}
                      >
                        {aiDecision.action}
                      </span>
                      <span className="font-bold text-sm">{aiDecision.symbol}</span>
                      {aiDecision.action !== "HOLD" && (
                        <span className="text-xs font-mono text-zinc-500">
                          Qty: {aiDecision.quantity}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-400 font-mono">
                      Conf: {(aiDecision.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 italic leading-relaxed">
                    &quot;{aiDecision.reason}&quot;
                  </p>
                  {aiDecision.action !== "HOLD" && (
                    <button
                      onClick={applyRecommendationToTrade}
                      className="w-full text-xs py-1.5 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition-colors cursor-pointer"
                    >
                      Fill Trade Form
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 py-4">
                  Request algorithmic insights from Gemini based on real-time cash, portfolio holdings, and recent price ticks.
                </p>
              )}
            </div>
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
              Recommendations are informational and subject to user execution &amp; risk evaluator constraints.
            </div>
          </div>

          {/* Recent Orders Log */}
          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              Recent Orders Log
            </h2>
            {dashboardData && dashboardData.orders.length > 0 ? (
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 text-zinc-400">
                    <tr>
                      <th className="pb-2">ID</th>
                      <th className="pb-2">Asset</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2">Quantity</th>
                      <th className="pb-2">Price</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Reason</th>
                      <th className="pb-2 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {dashboardData.orders.map((o) => (
                      <tr key={o.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="py-2.5 font-mono text-zinc-400">#{o.id}</td>
                        <td className="py-2.5 font-semibold">{o.symbol}</td>
                        <td className="py-2.5">
                          <span
                            className={`font-semibold ${
                              o.side === "BUY" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {o.side}
                          </span>
                        </td>
                        <td className="py-2.5 font-mono">{o.quantity}</td>
                        <td className="py-2.5 font-mono">{formatPrice(o.price)}</td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              o.status === "EXECUTED"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            }`}
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-zinc-400 truncate max-w-[120px]">
                          {o.cancel_reason || "—"}
                        </td>
                        <td className="py-2.5 text-right font-mono text-zinc-400">
                          {new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-zinc-400">
                No orders recorded yet. Submit your first order above.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
