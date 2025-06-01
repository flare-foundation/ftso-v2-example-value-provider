import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import {
  applyDecayWeighting,
  computeWeightedAverageAndStdDev,
  normalizeAndSort,
  getTradesAndTickers,
} from "../helpers";

export async function strategyLowTrades(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const symbol = feed.name.toLowerCase();
  const logger = context.logger;
  const DEBUG = process.env.DEBUG_STRATEGY === "1";

  const fallbackPrice = lastFtsoPrice || onchainPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 2 * 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    logger.warn(`[strategyLowTrades] ⚠️ Keine Trades für ${feed.name}, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0],
      strategyName: "LowTrades-NoTrades",
    };
  }

  const LAMBDA = parseFloat(process.env.MEDIAN_DECAY ?? "0.00005");
  const now = Date.now();

  if (DEBUG) {
    logger.debug(`[strategyLowTrades] 📊 Strategie für ${feed.name}`);
    logger.debug(`[strategyLowTrades] Anzahl Trades: ${tradeList.length}`);
    logger.debug(`[strategyLowTrades] Onchain Preis: ${onchainPrice}`);
    logger.debug(`[strategyLowTrades] Last FTSO Preis: ${lastFtsoPrice}`);
    logger.debug(`[strategyLowTrades] Last FTSO USDT Preis: ${lastUSDTFtsoPrice}`);
    logger.debug(`[strategyLowTrades] LAMBDA: ${LAMBDA}`);
  }

  const weighted = applyDecayWeighting(tradeList, LAMBDA, now);
  const normalized = normalizeAndSort(weighted);

  if (!normalized.length) {
    logger.warn(`[strategyLowTrades] ❌ Gewichtung ergab 0 – Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0],
      strategyName: "LowTrades-NoWeight",
    };
  }

  const { avg, stdDev } = computeWeightedAverageAndStdDev(normalized);
  const adjustedPrice = avg - 0.25 * stdDev;

  if (DEBUG) {
    logger.debug(`[strategyLowTrades] 📈 VWAP (avg): ${avg}`);
    logger.debug(`[strategyLowTrades] 📉 StdDev: ${stdDev}`);
    logger.debug(`[strategyLowTrades] 🧠 AdjustedPrice = VWAP - 0.25 * StdDev = ${adjustedPrice}`);
  }

  return {
    value: adjustedPrice,
    ccxt: avg,
    onchain: onchainPrice,
    meta: [stdDev, tradeList.length],
    strategyName: "LowTrades",
  };
}
