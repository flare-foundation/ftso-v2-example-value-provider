import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getTradesAndTickers, getVWAP, median } from "../helpers";
import { getFeedId, getPriceHistory } from "../utils/mysql";

export async function strategySmartBlend(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const symbol = feed.name.toLowerCase();
  const feedId = await getFeedId(feed.name);
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    context.logger.warn(`[strategySmartBlend] ⚠️ Keine Trades verfügbar für ${feed.name}, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "SmartBlend-NoTrades",
    };
  }

  const prices = tradeList.map(t => t.price);
  const vwap = getVWAP(tradeList);
  const med = median(prices);
  const history = await getPriceHistory(feedId, 5);
  const historyAvg = history.reduce((sum, h) => sum + h.ftso_price, 0) / history.length;

  const blended = 0.5 * vwap + 0.3 * med + 0.2 * historyAvg;

  if (DEBUG) {
    context.logger.debug(`[strategySmartBlend] 📊 Strategie für ${feed.name}`);
    context.logger.debug(`[strategySmartBlend] Trades: ${tradeList.length}`);
    context.logger.debug(`[strategySmartBlend] VWAP: ${vwap}`);
    context.logger.debug(`[strategySmartBlend] Median: ${med}`);
    context.logger.debug(`[strategySmartBlend] History (letzte 5): ${history.map(h => h.ftso_price).join(", ")}`);
    context.logger.debug(`[strategySmartBlend] HistoryAvg: ${historyAvg}`);
    context.logger.debug(`[strategySmartBlend] Formel: 0.5 * VWAP + 0.3 * Median + 0.2 * HistoryAvg`);
    context.logger.debug(`[strategySmartBlend] Ergebnis: ${blended}`);
  }

  return {
    value: blended,
    ccxt: vwap,
    onchain: onchainPrice,
    meta: [med, historyAvg, tradeList.length],
    strategyName: "SmartBlend",
  };
}
