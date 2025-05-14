import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";

export async function adjustPrice(
  feed: FeedId,
  ccxtprice_live: number,
  onchainprice_live: number,
  decimals: number,
  onchaindecimals: number,
  history: PriceHistoryEntry[],
  trend: "up" | "down" | "flat",
  logger?: ILogger
): Promise<number> {
  try {
    const scale = 10 ** decimals;
    const ccxtPrice = ccxtprice_live;

    if (logger) {
      logger.debug(`📚 [${feed.name}] Letzte Preisabweichungen aus historischen Daten:`);
      history.forEach((entry, i) => {
        const ccxt = entry.ccxt_price / scale;
        const onchainPrice = entry.onchain_price / scale;
        const ftso = entry.ftso_value;
        const submitted = entry.submitted ? entry.submitted / scale : null;
        const diff_ccxt_ftso_Pct = ((ccxt - ftso) / ftso) * 100;
        const diff_onchain_ftso_Pct = ((onchainPrice - ftso) / ftso) * 100;
        const diff_submitted_ftso_Pct = ((submitted - ftso) / ftso) * 100;
        logger.debug(
          `  #${i + 1}: Round=${entry.voting_round_id}, CCXT=${ccxt.toFixed(onchaindecimals)}, FTSO=${ftso.toFixed(onchaindecimals)}, ONCHAIN=${onchainPrice.toFixed(onchaindecimals)},` +
            (submitted !== null ? ` Submitted=${submitted.toFixed(onchaindecimals)},` : "") +
            ` CCXT-FTSO-Diff=${diff_ccxt_ftso_Pct.toFixed(4)}%` +
            ` ONCHAIN-FTSO-Diff=${diff_onchain_ftso_Pct.toFixed(4)}%` +
            ` SUBMITTED-FTSO-Diff=${diff_submitted_ftso_Pct.toFixed(4)}%`
        );
      });
    }

    const adjusted = ccxtPrice;

    logger?.debug(
      `📊 [${feed.name}] Preisanpassung:\n` +
        `     Adjusted Price= ${adjusted}\n` +
        `     CCXT Price live    = ${ccxtPrice}\n` +
        `     ONCHAIN Price live    = ${onchainprice_live}`
    );

    return adjusted;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return ccxtprice_live;
  }
}
