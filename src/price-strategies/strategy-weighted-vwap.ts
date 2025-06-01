import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getTradesAndTickers, applyDecayWithCapAndStats } from "../helpers";

export async function strategyWeightedVWAP(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const DEBUG = process.env.DEBUG_STRATEGY === "1";
  const symbol = feed.name.toLowerCase();
  const logger = context.logger;
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    logger.warn(`[strategyWeightedVWAP] Keine Trades für ${feed.name}, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "WeightedVWAP-NoTrades",
    };
  }

  const now = Date.now();
  const LAMBDA = parseFloat(process.env.MEDIAN_DECAY ?? "0.00005");
  const MAX_TRADE_USD = 1_000_000;

  if (DEBUG) {
    logger.debug(`[strategyWeightedVWAP] ${tradeList.length} Trades geladen`);
    logger.debug(`[strategyWeightedVWAP] Lambda = ${LAMBDA}`);
    logger.debug(`[strategyWeightedVWAP] Max Trade Cap USD = ${MAX_TRADE_USD}`);
    logger.debug(`[strategyWeightedVWAP] Fallback Preis = ${fallbackPrice}`);
  }

  const { weighted, exchangeStats } = applyDecayWithCapAndStats(tradeList, LAMBDA, MAX_TRADE_USD, now);
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  if (totalWeight === 0) {
    logger.warn(`[strategyWeightedVWAP] Gesamtgewicht = 0, Rückgabe: ${fallbackPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, 0],
      strategyName: "WeightedVWAP",
    };
  }

  const avg = weighted.reduce((sum, w) => sum + w.price * w.weight, 0) / totalWeight;

  if (DEBUG) {
    logger.debug(`[strategyWeightedVWAP] Gesamtgewicht: ${totalWeight}`);
    logger.debug(`[strategyWeightedVWAP] VWAP: ${avg}`);
    logger.debug(`[strategyWeightedVWAP] Gewichtungsanteile je Exchange:`);
    for (const [exchange, stat] of exchangeStats.entries()) {
      const share = stat.weight / totalWeight;
      logger.debug(
        `→ ${exchange}: ${stat.count} Trades, Gewicht = ${stat.weight.toFixed(5)}, Anteil = ${(share * 100).toFixed(2)}%`
      );
    }
  }

  return {
    value: avg,
    ccxt: avg,
    onchain: onchainPrice,
    meta: [avg, totalWeight, tradeList.length],
    strategyName: "WeightedVWAP",
  };
}
