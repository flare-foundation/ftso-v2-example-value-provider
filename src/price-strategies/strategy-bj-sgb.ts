import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";
import { getTradesAndTickers } from "../helpers";

const DEBUG = process.env.DEBUG_STRATEGY === "1";

export async function strategyBjSgb(
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
    maxAgeMs: 5 * 60_000,
    usdtToUsdRate: lastUSDTFtsoPrice || 1.0,
  });

  const tradeList = trades[symbol];
  if (!tradeList?.length) {
    logger.warn(`[bjsgb] Keine Trades für ${feed.name} – fallback zu Onchain/FTSO Preis`);
    return {
      value: fallbackPrice,
      ccxt: fallbackPrice,
      onchain: onchainPrice,
      meta: [0, 0],
      strategyName: "BjSgb-NoTrades",
    };
  }

  // Durchschnitt berechnen
  const tradePrices = tradeList.map(t => t.price);
  const averageTrades = tradePrices.reduce((a, b) => a + b, 0) / tradePrices.length;

  // Kombinierte Preise berechnen
  const combo1 = (averageTrades + onchainPrice + averageTrades) / 3;
  const combo2 = (averageTrades + 2 * onchainPrice + averageTrades) / 4;
  const combo3 = (averageTrades + 3 * onchainPrice + averageTrades) / 5;
  const combo4 = (averageTrades + 4 * onchainPrice + averageTrades) / 6;

  const adjustedPrice = combo4 || combo3 || combo2 || combo1 || averageTrades;

  // 🔍 Debug-Ausgabe
  if (DEBUG) {
    logger.debug(`[bjsgb] Starte Strategie-Berechnung für ${feed.name}`);
    logger.debug(`[bjsgb] OnchainPreis: ${onchainPrice}`);
    logger.debug(`[bjsgb] Last FTSO Preis: ${lastFtsoPrice}`);
    logger.debug(`[bjsgb] Letzter USDT Preis: ${lastUSDTFtsoPrice}`);
    logger.debug(`[bjsgb] Anzahl Trades: ${tradeList.length}`);

    logger.debug(`[bjsgb] Einzelne Trades (max 10):`);
    for (const t of tradeList.slice(0, 10)) {
      logger.debug(
        `→ ${t.exchange.padEnd(10)} | Preis: ${t.price.toFixed(8)} | USD: ${t.price?.toFixed(8) ?? "?"} | Zeit: ${new Date(t.timestamp).toISOString()}`
      );
    }

    logger.debug(`[bjsgb] ⬇️ Berechnungen:`);
    logger.debug(`→ Durchschnitt Trades       : ${averageTrades.toFixed(8)}`);
    logger.debug(`→ Kombi AVG + 1x Onchain    : ${combo1.toFixed(8)}`);
    logger.debug(`→ Kombi AVG + 2x Onchain    : ${combo2.toFixed(8)}`);
    logger.debug(`→ Kombi AVG + 3x Onchain    : ${combo3.toFixed(8)}`);
    logger.debug(`→ Kombi AVG + 4x Onchain    : ${combo4.toFixed(8)}`);
    logger.debug(`→ FINAL Adjusted Price      : ${adjustedPrice.toFixed(8)}`);
    logger.debug(`→ Letzter historischer Preis: ${lastFtsoPrice}`);
    logger.debug(`[bjsgb] ===================================================`);
  }

  return {
    value: adjustedPrice,
    ccxt: averageTrades,
    onchain: onchainPrice,
    meta: [
      tradeList.length, // 1: Anzahl Trades
      Number((adjustedPrice - onchainPrice).toFixed(8)), // 2: Abweichung zum Onchain
      combo1,
      combo2,
      combo3,
    ],
    strategyName: "BjSgb",
  };
}
