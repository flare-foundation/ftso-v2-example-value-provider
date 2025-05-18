import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";
import type { PriceInfo } from "../data-feeds/ccxt-provider-service";
import type { VolumeStore } from "../data-feeds/volumes";

// Von Björn

export async function priceStrategie02(
  feed: FeedId,
  ccxtLive: number,
  onchainLive: number,
  _decimals: number,
  _onchainDecimals: number,
  history: PriceHistoryEntry[],
  logger?: ILogger,
  latestPriceMap?: Map<string, Map<string, PriceInfo>>,
  volumeMap?: Map<string, Map<string, VolumeStore>>,
  history_usdt?: PriceHistoryEntry[]
): Promise<number> {
  try {
    //console.log(latestPriceMap);
    //console.log(volumeMap);
    //console.log(history);

    const baseAsset = feed.name.split("/")[0];
    const last_usdt_price = history_usdt?.[0]?.ftso_price


    // Hier daten aus der Map Auslesen
    for (const [symbol, exchanges] of latestPriceMap ?? []) {
      if (symbol.startsWith(baseAsset + "/") && /(USDT|USD|USDC)$/.test(symbol)) {
        console.log(`🧩 ${symbol}:`);
        for (const [exchange, info] of exchanges.entries()) {
          const date = new Date(info.time).toISOString();
          console.log(`  ${exchange} => Preis: ${info.value}, Zeit: ${date}`);
        }
      }
    }

    // Preis der Berechtet wurde und an die FTSO gesendet wird (adjusted)
    const adjusted = ccxtLive;

    /* ---------- 5. Logging ------------------------------------------------ */
    if (logger) {
      logger.debug(
        `\n######################################################################\n` +
        `📊 [${feed.name}] Aktuelle Preisanpassung (priceStrategie02)\n` +
        `────────────────────────────────────────────\n` +
        `   Adjusted Price       : ${adjusted}\n` +
        `   CCXT Price (live)    : ${ccxtLive}\n` +
        `   ONCHAIN Price (live) : ${onchainLive}\n` +
        `   USDT/USD Preis : ${last_usdt_price}\n` +
        `######################################################################\n`
      );
    }

    return adjusted;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return ccxtLive;
  }
}

/* ---------- Hilfsfunktionen --------------------------------------------- */
