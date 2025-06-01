import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult, TradeInfo } from "./types";
import { median, getTradesAndTickers } from "../helpers";

export async function strategyTop3ExchangeMedian(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const symbol = feed.name.toLowerCase();
  const logger = context.logger;
  const fallbackPrice = lastFtsoPrice || onchainPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    logger.warn(`[strategyTop3ExchangeMedian] ⚠️ Keine Trades für ${feed.name}, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "Top3ExchangeMedian-NoTrades",
    };
  }

  const grouped = new Map<string, TradeInfo[]>();
  for (const t of tradeList) {
    if (!grouped.has(t.exchange)) grouped.set(t.exchange, []);
    grouped.get(t.exchange)!.push(t);
  }

  const sorted = [...grouped.entries()]
    .map(([exchange, list]) => ({
      exchange,
      trades: list,
      volume: list.reduce((sum, t) => sum + t.amount * t.price, 0),
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);

  const prices = sorted.flatMap(e => e.trades.map(t => t.price));
  const result = prices.length > 0 ? median(prices) : fallbackPrice;
  const avgVol = sorted.reduce((s, e) => s + e.volume, 0) / sorted.length;

  if (DEBUG) {
    logger.debug(`[strategyTop3ExchangeMedian] 🔍 Strategie für ${feed.name}`);
    logger.debug(`[strategyTop3ExchangeMedian] Gesamt-Trades: ${tradeList.length}`);
    for (const entry of sorted) {
      logger.debug(
        `[strategyTop3ExchangeMedian] → ${entry.exchange}: Trades=${entry.trades.length}, Volumen=${entry.volume.toFixed(2)}`
      );
    }
    logger.debug(`[strategyTop3ExchangeMedian] ➤ Genutzte Exchanges: ${sorted.map(e => e.exchange).join(", ")}`);
    logger.debug(`[strategyTop3ExchangeMedian] ➤ Preise: [${prices.map(p => p.toFixed(6)).join(", ")}]`);
    logger.debug(`[strategyTop3ExchangeMedian] ➤ Median: ${result}`);
  }

  return {
    value: result,
    ccxt: result,
    onchain: onchainPrice,
    meta: [tradeList.length, prices.length, avgVol],
    strategyName: "Top3ExchangeMedian",
  };
}
