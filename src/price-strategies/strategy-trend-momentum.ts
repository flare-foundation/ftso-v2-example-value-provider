import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getFeedId, getPriceHistory } from "../utils/mysql";

export async function strategyTrendMomentum(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  _lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const feedId = await getFeedId(feed.name);
  const history = await getPriceHistory(feedId, 5);
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;

  if (history.length < 5) {
    if (DEBUG) {
      context.logger.debug(
        `[strategyTrendMomentum] Zu wenige Historien-Daten (${history.length}) – Rückgabe: ${fallbackPrice}`
      );
    }
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 1, history.length],
      strategyName: "TrendMomentum-NoTrades",
    };
  }

  const trend = history[0].ftso_price - history[4].ftso_price;
  const momentumBias = trend > 0 ? 1.001 : trend < 0 ? 0.999 : 1;
  const adjusted = onchainPrice * momentumBias;

  if (DEBUG) {
    context.logger.debug(
      `[strategyTrendMomentum] Vergangene FTSO-Preise: ${history.map(h => h.ftso_price.toFixed(8)).join(", ")}`
    );
    context.logger.debug(
      `[strategyTrendMomentum] Trend-Berechnung: Letzter - Ältester = ${history[0].ftso_price.toFixed(8)} - ${history[4].ftso_price.toFixed(8)} = ${trend.toFixed(8)}`
    );
    context.logger.debug(`[strategyTrendMomentum] Bias-Faktor: ${momentumBias}`);
    context.logger.debug(`[strategyTrendMomentum] Onchain-Preis: ${onchainPrice}`);
    context.logger.debug(`[strategyTrendMomentum] Angepasster Preis: ${adjusted}`);
  }

  return {
    value: adjusted,
    ccxt: adjusted, // oder 0, falls bewusst kein Marktpreis verwendet wird
    onchain: onchainPrice,
    meta: [trend, momentumBias, history.length],
    strategyName: "TrendMomentum",
  };
}
