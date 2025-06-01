import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getTradesAndTickers, median, mad } from "../helpers";

export async function strategyRollingMADFilter(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;
  const symbol = feed.name.toLowerCase();

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 2 * 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    context.logger.warn(`[strategyRollingMADFilter] ⚠️ Keine Trades für ${feed.name}, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0],
      strategyName: "RollingMAD-NoTrades",
    };
  }

  const prices = tradeList.map(t => t.price);
  const med = median(prices);
  const deviation = mad(prices);
  const distance = Math.abs(onchainPrice - med);

  if (DEBUG) {
    context.logger.debug(`[strategyRollingMADFilter] 📊 Strategie für ${feed.name}`);
    context.logger.debug(`[strategyRollingMADFilter] Anzahl Trades: ${tradeList.length}`);
    context.logger.debug(`[strategyRollingMADFilter] Onchain Preis: ${onchainPrice}`);
    context.logger.debug(`[strategyRollingMADFilter] Median: ${med}`);
    context.logger.debug(`[strategyRollingMADFilter] MAD: ${deviation}`);
    context.logger.debug(`[strategyRollingMADFilter] Distanz Onchain → Median: ${distance}`);
    context.logger.debug(`[strategyRollingMADFilter] Schwelle: 3 * MAD = ${(3 * deviation).toFixed(8)}`);
  }

  let adjusted = onchainPrice;
  let strategyName = "RollingMAD-OnchainOK";
  if (distance > 3 * deviation) {
    context.logger.warn(`[strategyRollingMADFilter] ⚠️ Abweichung zu hoch. Nutze Median: ${med}`);
    adjusted = med;
    strategyName = "RollingMAD-MedianUsed";
  }

  return {
    value: adjusted,
    ccxt: med,
    onchain: onchainPrice,
    meta: [deviation, tradeList.length],
    strategyName,
  };
}
