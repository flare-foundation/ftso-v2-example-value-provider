import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getTradesAndTickers } from "../helpers";

export async function strategyTrimmedMean(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const symbol = feed.name.toLowerCase();
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    if (DEBUG) {
      context.logger.debug(`[strategyTrimmedMean] Keine Trades für ${feed.name} – Rückgabe: ${fallbackPrice}`);
    }
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "TrimmedMean-NoTrades",
    };
  }

  const prices = tradeList.map(t => t.price).sort((a, b) => a - b);
  const cut = Math.floor(prices.length * 0.1);
  const trimmed = prices.slice(cut, prices.length - cut);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

  if (DEBUG) {
    context.logger.debug(`[strategyTrimmedMean] ${tradeList.length} Trades geladen`);
    context.logger.debug(`[strategyTrimmedMean] Preisbereich vor Trimming: ${prices[0]} ... ${prices[prices.length - 1]}`);
    context.logger.debug(`[strategyTrimmedMean] Anzahl verworfener Werte je Seite: ${cut}`);
    context.logger.debug(`[strategyTrimmedMean] Verbleibende Preise: ${trimmed.length}`);
    context.logger.debug(`[strategyTrimmedMean] Berechneter Trimmed Mean: ${avg}`);
  }

  return {
    value: avg,
    ccxt: avg,
    onchain: onchainPrice,
    meta: [cut, trimmed.length, tradeList.length],
    strategyName: "TrimmedMean",
  };
}
