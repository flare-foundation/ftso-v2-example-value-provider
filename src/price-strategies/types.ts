import { Logger } from "@nestjs/common";

export type TradeInfo = {
  price: number;
  amount: number;
  timestamp: number;
  side: "buy" | "sell";
  exchange: string;
};

export interface TickerInfo {
  last: number;
  bid: number;
  ask: number;
  vol_24h: number;
  timestamp: number;
  exchange: string;
}

export interface OrderLevel {
  price: number;
  amount: number;
}

export interface OrderBook {
  asks: OrderLevel[];
  bids: OrderLevel[];
  timestamp: number;
  exchange: string;
}

export type TradeMap = Map<string, Map<string, TradeInfo[]>>;
export type TickerMap = Map<string, Map<string, TickerInfo>>;
export type OrderBookMap = Map<string, Map<string, OrderBook>>;

export interface StrategyContext {
  tradeMap: TradeMap;
  tickerMap: TickerMap;
  orderBookMap: OrderBookMap;
  fallbackMap: Map<string, { value: number; time: number }>;
  logger: Logger;
}

export type StrategyResult = {
  value: number; // Preis in Dezimalform → wird skaliert als submitted
  ccxt: number; // Pflicht: Dezimalpreis → skaliert als ccxt_price
  onchain: number; // Pflicht: Dezimalpreis → skaliert als onchain_price
  meta?: (number | undefined)[]; // Optional: bis zu 5 zusätzliche Felder
  strategyName?: string;
};
