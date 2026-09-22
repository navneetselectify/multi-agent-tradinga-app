import { EventEmitter } from "node:events";

export interface TradeExecutedPayload {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export type TradeExecutedEvent = TradeExecutedPayload;

export const tradeEvents = new EventEmitter();

// Simple listener that logs the event
tradeEvents.on("trade.executed", (event: TradeExecutedPayload) => {
  console.log("[trade.executed]", event);
});
