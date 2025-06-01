import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import {
  getTradesAndTickers,
  applyDecayWeighting,
  normalizeAndSort,
  computeWeightedAverageAndStdDev,
} from "../helpers";

export async function strategyVolatilityWeighted(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const symbol = feed.name.toLowerCase();
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;
  const LAMBDA = parseFloat(process.env.MEDIAN_DECAY ?? "0.00005");
  const now = Date.now();

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 2 * 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    if (DEBUG) {
      context.logger.debug(`[strategyVolatilityWeighted] Keine Trades für ${feed.name} – Rückgabe: ${fallbackPrice}`);
    }
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "VolatilityWeighted-NoTrades",
    };
  }

  if (DEBUG) {
    context.logger.debug(`[strategyVolatilityWeighted] ${tradeList.length} Trades geladen`);
    context.logger.debug(`[strategyVolatilityWeighted] Decay-Faktor Lambda = ${LAMBDA}`);
    context.logger.debug(`[strategyVolatilityWeighted] Fallback/Onchain Preis = ${onchainPrice}`);
  }

  const weighted = applyDecayWeighting(tradeList, LAMBDA, now);
  const normalized = normalizeAndSort(weighted);

  if (!normalized.length) {
    context.logger.warn(`[strategyVolatilityWeighted] Kein Gewicht vorhanden – Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "VolatilityWeighted-NoWeighted",
    };
  }

  const { avg, stdDev } = computeWeightedAverageAndStdDev(normalized);
  const adjusted = avg - 0.25 * stdDev;

  if (DEBUG) {
    context.logger.debug(`[strategyVolatilityWeighted] VWAP (avg) = ${avg}`);
    context.logger.debug(`[strategyVolatilityWeighted] Standardabweichung = ${stdDev}`);
    context.logger.debug(`[strategyVolatilityWeighted] Adjusted Price = ${adjusted}`);
  }

  return {
    value: adjusted,
    ccxt: avg,
    onchain: onchainPrice,
    meta: [avg, stdDev, adjusted],
    strategyName: "VolatilityWeighted",
  };
}
