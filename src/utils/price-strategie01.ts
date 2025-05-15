import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";

export async function priceStrategie01(
  feed: FeedId,
  ccxtprice_live: number,
  onchainprice_live: number,
  decimals: number,
  onchaindecimals: number,
  history: PriceHistoryEntry[],
  logger?: ILogger
): Promise<number> {
  try {
    const ccxtPrice = ccxtprice_live;

    if (logger) {
      logger.debug(`\n########################## [${feed.name}] Preis-Historie Start##########################\n`);

      history.forEach((entry, i) => {
        const {
          ccxt_price,
          ftso_value,
          onchain_price,
          submitted,
          voting_round_id,
          first_quartile,
          third_quartile,
          low,
          high,
        } = entry;

        const diffCcxt = ((ccxt_price - ftso_value) / ftso_value) * 100;
        const diffOnchain = ((onchain_price - ftso_value) / ftso_value) * 100;
        const diffSubmitted = submitted !== null ? ((submitted - ftso_value) / ftso_value) * 100 : null;

        logger.debug(
          `#${(i + 1).toString().padStart(2)} | Round: ${voting_round_id}\n` +
            `  CCXT Price      : ${ccxt_price.toFixed(onchaindecimals).padEnd(14)} (Δ ${diffCcxt.toFixed(4)}%)\n` +
            `  FTSO Value      : ${ftso_value.toFixed(onchaindecimals)}\n` +
            `  Onchain Price   : ${onchain_price.toFixed(onchaindecimals).padEnd(14)} (Δ ${diffOnchain.toFixed(4)}%)\n` +
            (submitted !== null
              ? `  Submitted       : ${submitted.toFixed(onchaindecimals).padEnd(14)} (Δ ${diffSubmitted!.toFixed(4)}%)\n`
              : "") +
            `  Quartile (1st)  : ${first_quartile.toFixed(onchaindecimals)}\n` +
            `  Quartile (3rd)  : ${third_quartile.toFixed(onchaindecimals)}\n` +
            `  Low / High      : ${low.toFixed(onchaindecimals)} / ${high.toFixed(onchaindecimals)}\n` +
            `--------------------------------------------------------------------------------`
        );
      });
      logger.debug(`\n########################## [${feed.name}] Preis-Historie  END ##########################\n`);
      logger.debug(
        `\n📊 [${feed.name}] Aktuelle Preisanpassung\n` +
          `────────────────────────────────────────────\n` +
          `   Adjusted Price       : ${ccxtPrice.toFixed(onchaindecimals)}\n` +
          `   CCXT Price (live)    : ${ccxtPrice.toFixed(onchaindecimals)}\n` +
          `   ONCHAIN Price (live) : ${onchainprice_live.toFixed(onchaindecimals)}\n` +
          `######################################################################\n`
      );
    }

    return ccxtPrice;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return ccxtprice_live;
  }
}
