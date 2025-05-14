import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";

export async function adjustPrice(
  feed: FeedId,
  original: number,
  onchainprice_live: number,
  decimals: number,
  history: PriceHistoryEntry[],
  trend: "up" | "down" | "flat",
  logger?: ILogger
): Promise<number> {
  try {
    const scale = 10 ** decimals;
    const ccxtPrice = original;
    let onchainPrice: number;
    if (logger) {
      logger.debug(`📚 [${feed.name}] Letzte Preisabweichungen aus historischen Daten:`);
      history.forEach((entry, i) => {
        const ccxt = entry.ccxt_price / scale;
        onchainPrice = entry.onchain_price;
        const ftso = entry.ftso_value;
        const submitted = entry.submitted ? entry.submitted / scale : null;
        const diffPct = ((ccxt - ftso) / ftso) * 100;

        logger.debug(
          `  #${i + 1}: Round=${entry.voting_round_id}, CCXT=${ccxt.toFixed(8)}, FTSO=${ftso.toFixed(8)}, ONCHAIN=${onchainPrice.toFixed(8)},` +
            (submitted !== null ? ` Submitted=${submitted.toFixed(8)},` : "") +
            ` Diff=${diffPct.toFixed(4)}%`
        );
      });
    }

    const baseTolerance = 0.05;
    const tolerance = trend === "flat" ? baseTolerance : baseTolerance * 2;
    logger?.debug(`[${feed.name}] Toleranz für Filterung: ${tolerance}%`);

    const filtered = history.filter(row => {
      const ftso_scaled = Math.round(row.ftso_value * scale);
      const diffPct = Math.abs((row.ccxt_price - ftso_scaled) / ftso_scaled) * 100;
      return diffPct <= tolerance;
    });

    const over = filtered.filter(r => r.ccxt_price / scale > r.ftso_value);
    const under = filtered.filter(r => r.ccxt_price / scale < r.ftso_value);

    const avgOver = over.length
      ? over.reduce((sum, r) => sum + ((r.submitted ?? r.ccxt_price) / scale - r.ftso_value), 0) / over.length
      : 0;
    const avgUnder = under.length
      ? under.reduce((sum, r) => sum + (r.ftso_value - (r.submitted ?? r.ccxt_price) / scale), 0) / under.length
      : 0;

    const last2 = history.slice(0, 2);
    const forceOver = trend === "up" && last2.every(r => r.ccxt_price > r.ftso_value * scale);
    const forceUnder = trend === "down" && last2.every(r => r.ccxt_price < r.ftso_value * scale);

    const adjusted = (() => {
      if (forceOver) return ccxtPrice - avgOver;
      if (forceUnder) return ccxtPrice + avgUnder;
      if (trend === "up") return ccxtPrice + avgUnder;
      if (trend === "down") return ccxtPrice - avgOver;
      return ccxtPrice + (avgUnder - avgOver) / 2;
    })();

    logger?.debug(
      `📊 [${feed.name}] Preisanpassung:\n` +
        `     Trend         = ${trend}\n` +
        `     avgOver       = ${avgOver}\n` +
        `     avgUnder      = ${avgUnder}\n` +
        `     forceOver     = ${forceOver}\n` +
        `     forceUnder    = ${forceUnder}\n` +
        `     Adjusted Price= ${adjusted}\n` +
        `     CCXT Price live    = ${ccxtPrice}\n` +
        `     ONCHAIN Price live    = ${onchainprice_live}`
    );

    return adjusted;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return original;
  }
}
