import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { applyDecayWithCapAndStats, normalizeAndSort, getWeightedMedian, getTradesAndTickers } from "../helpers";

const LAMBDA = parseFloat(process.env.MEDIAN_DECAY ?? "0.00005");
const MAX_TRADE_USD = 1_000_000;
const DEBUG = process.env.DEBUG_STRATEGY === "1";

export async function strategyDefault(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  lastUSDTFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const symbol = feed.name.toLowerCase();
  const logger = context.logger;
  const fallbackPrice = onchainPrice || lastFtsoPrice || 0.01;

  const { trades } = await getTradesAndTickers(context, feed.name, {
    withTrades: true,
    withTickers: false,
    maxAgeMs: 2 * 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    logger.warn(`[defaults] Keine Trades gefunden für ${feed.name}, Rückgabe Onchain Preis ${onchainPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, LAMBDA],
      strategyName: "Default-NoTrades",
    };
  }

  const now = Date.now();
  const { weighted, exchangeStats } = applyDecayWithCapAndStats(tradeList, LAMBDA, MAX_TRADE_USD, now);
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) {
    logger.warn(`[defaults] Gewichtung ergibt 0 für ${feed.name}, Rückgabe Onchain Preis ${onchainPrice}`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0, LAMBDA],
      strategyName: "Default-Gewichtung-0",
    };
  }

  if (DEBUG) {
    logger.debug(`\n[defaults] 🧠 Strategie Debug für ${feed.name}`);
    logger.debug(`→ OnchainPreis         : ${onchainPrice}`);
    logger.debug(`→ Letzter FTSO Preis   : ${lastFtsoPrice}`);
    logger.debug(`→ Letzter FTSO USDT Preis   : ${lastUSDTFtsoPrice}`);
    logger.debug(`→ Trades geladen       : ${tradeList.length}`);
    logger.debug(`→ Gesamtgewicht        : ${totalWeight.toFixed(5)}`);
    logger.debug(`→ Lambda               : ${LAMBDA}`);
    logger.debug(`→ USD Cap              : ${MAX_TRADE_USD}`);
    logger.debug(`→ Exchanges:`);

    for (const [exchange, stat] of exchangeStats.entries()) {
      const share = stat.weight / totalWeight;
      logger.debug(
        `  ↳ ${exchange.padEnd(12)} | Trades: ${stat.count.toString().padStart(4)} | Gewicht: ${stat.weight.toFixed(5)} | Anteil: ${(share * 100).toFixed(2)}%`
      );
    }

    logger.debug(`→ Einzelne Trades:`);
    tradeList.slice(0, 30).forEach(t => {
      logger.debug(
        `  ↳ ${t.exchange.padEnd(10)} | Preis: ${t.price.toFixed(8)} | USD: ${(t as any)?.price?.toFixed(8) ?? "?"} | Zeit: ${new Date(t.timestamp).toISOString()}`
      );
    });
    if (tradeList.length > 30) {
      logger.debug(`  … (${tradeList.length - 30} weitere Trades ausgelassen)`);
    }
  }

  const normalized = normalizeAndSort(weighted);
  const median = getWeightedMedian(normalized);

  if (median !== undefined) {
    logger.debug(`[defaults] ✅ Gewichteter Median für ${feed.name}: ${median}`);
    return {
      value: median,
      ccxt: median,
      onchain: onchainPrice,
      meta: [totalWeight, tradeList.length, LAMBDA, fallbackPrice, Math.abs(median - fallbackPrice)],
      strategyName: "Default",
    };
  }

  logger.warn(`[defaults] ❌ Medianberechnung fehlgeschlagen für ${feed.name}`);
  return {
    value: fallbackPrice,
    ccxt: fallbackPrice,
    onchain: onchainPrice,
    meta: [0, tradeList.length, LAMBDA],
    strategyName: "Default-Median-Error",
  };
}
