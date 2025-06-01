export interface TradeInfo {
  price: number;
  amount: number;
  timestamp: number;
  side: "buy" | "sell";
  exchange: string;
}

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
