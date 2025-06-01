import { TickerInfo, TradeInfo } from "../types/market-data-types";
import { StrategyContext } from "../price-strategies/types";

export async function getTradesAndTickers(
  context: StrategyContext,
  symbolBase: string,
  options?: {
    withTrades?: boolean;
    withTickers?: boolean;
    maxAgeMs?: number;
    usdtToUsdRate?: number;
  }
): Promise<{
  trades: Record<string, TradeInfo[]>;
  tickers: Record<string, TickerInfo | undefined>;
}> {
  const symbolUSD = symbolBase.toLowerCase();
  const symbolUSDT = symbolUSD.replace("/usd", "/usdt");
  const rate = options?.usdtToUsdRate ?? 1.0;
  const now = Date.now();

  const trades: Record<string, TradeInfo[]> = {};
  const tickers: Record<string, TickerInfo | undefined> = {};

  if (options?.withTrades) {
    for (const sym of [symbolUSD, symbolUSDT]) {
      const map = context.tradeMap.get(sym);
      if (!map) continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_exchange, tradeList] of map.entries()) {
        const filtered = (
          options.maxAgeMs ? tradeList.filter(t => now - t.timestamp < options.maxAgeMs!) : tradeList
        ).map(t => (sym === symbolUSDT ? { ...t, price: t.price * rate } : t));

        trades[symbolUSD] = trades[symbolUSD] || [];
        trades[symbolUSD].push(...filtered);
      }
    }
  }

  if (options?.withTickers) {
    for (const sym of [symbolUSD, symbolUSDT]) {
      const map = context.tickerMap.get(sym);
      if (!map) continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_exchange, ticker] of map.entries()) {
        tickers[symbolUSD] =
          sym === symbolUSDT
            ? {
                ...ticker,
                last: ticker.last * rate,
                bid: ticker.bid * rate,
                ask: ticker.ask * rate,
                vol_24h: ticker.vol_24h * rate,
              }
            : ticker;
      }
    }
  }

  return { trades, tickers };
}
