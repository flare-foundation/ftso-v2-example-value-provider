import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";
import type { PriceInfo } from "../data-feeds/ccxt-provider-service";
import type { VolumeStore } from "../data-feeds/volumes";

export async function priceStrategie03(
  feed: FeedId,
  ccxtLive: number,
  onchainLive: number,
  _decimals: number,
  _onchainDecimals: number,
  history: PriceHistoryEntry[],
  logger?: ILogger,
  latestPriceMap?: Map<string, Map<string, PriceInfo>>,
  volumeMap?: Map<string, Map<string, VolumeStore>>,
  history_usdt?: PriceHistoryEntry[],
  getValueFn?: (feed: FeedId) => Promise<{ value: number } | undefined>
): Promise<number> {
  try {
    const baseAsset = feed.name.split("/")[0];
    const last_usdt_price = history_usdt?.[0]?.ftso_price;

    const debugLog: string[] = [];

    debugLog.push(`\n================ DEBUG: priceStrategie03 ==================`);
    debugLog.push(`Feed           : ${feed.name}`);
    debugLog.push(`Decimals       : ${_decimals}`);
    debugLog.push(`OnchainDecimals: ${_onchainDecimals}`);
    debugLog.push(`BaseAsset      : ${baseAsset}`);
    debugLog.push(`History (len)  : ${history.length}`);
    debugLog.push(`HistoryUSDT (len): ${history_usdt?.length ?? 0}`);
    debugLog.push(`VolumeMap Keys : ${[...volumeMap?.keys() ?? []].join(", ")}`);
    debugLog.push(`LatestPriceMap Keys : ${[...latestPriceMap?.keys() ?? []].join(", ")}`);
    debugLog.push(``);

    // USDT/USD Kurs lokal aus latestPriceMap berechnen
    let usdtToUsdRate: number | undefined = undefined;
    const usdtMap = latestPriceMap?.get("USDT/USD");
    if (usdtMap && usdtMap.size > 0) {
      const values = [...usdtMap.values()].map(v => v.value);
      const sum = values.reduce((a, b) => a + b, 0);
      usdtToUsdRate = sum / values.length;
      debugLog.push(`📡 USDT/USD Durchschnitt aus ${usdtMap.size} Quellen: ${usdtToUsdRate}`);
    } else {
      debugLog.push(`⚠️ Kein USDT/USD Kurs in latestPriceMap gefunden`);
    }

    for (const [symbol, exchanges] of latestPriceMap ?? []) {
      if (symbol.startsWith(`${baseAsset}/`) && /(USDT|USD|USDC)$/.test(symbol)) {
        debugLog.push(`🧩 ${symbol}:`);
        for (const [exchange, info] of exchanges.entries()) {
          const date = new Date(info.time).toISOString();
          const priceUsd = symbol.endsWith("/USDT") && usdtToUsdRate !== undefined
            ? info.value * usdtToUsdRate
            : undefined;

          const priceLine = `  ├─ ${exchange.padEnd(10)} => Preis: ${info.value}`
            + (priceUsd !== undefined ? ` | USD: ${priceUsd.toFixed(8)}` : "")
            + ` | Zeit: ${date}`;

          debugLog.push(priceLine);
        }
      }
    }

    if (history.length > 0) {
      debugLog.push(`\n🕑 Letzter historischer Preis (Feed): ${history[0].ftso_price}`);
    }

    if (history_usdt?.length) {
      debugLog.push(`🕑 Letzter historischer Preis (USDT): ${history_usdt[0].ftso_price}`);

      if (usdtToUsdRate !== undefined) {
        const history_usd = history_usdt.map(entry => ({
          ...entry,
          ftso_price_usd: entry.ftso_price * usdtToUsdRate,
        }));
        debugLog.push(`🧮 Historische USD-Preise aus USDT:`);
        for (const h of history_usd) {
          debugLog.push(`   Preis (USD): ${h.ftso_price_usd}`);
        }
      } else {
        debugLog.push(`⚠️ USDT/USD Kurs nicht verfügbar – Umrechnung übersprungen`);
      }
    }

    // 🔢 Erweiterung: CCXT USD Durchschnitt berechnen
    const ccxtUsdPrices: number[] = [];
    for (const [symbol, exchanges] of latestPriceMap ?? []) {
      if (symbol.startsWith(`${baseAsset}/`) && /(USDT|USD)$/.test(symbol)) {
        for (const [, info] of exchanges.entries()) {
          if (symbol.endsWith("/USDT") && usdtToUsdRate !== undefined) {
            ccxtUsdPrices.push(info.value * usdtToUsdRate);
          }
          if (symbol.endsWith("/USD")) {
            ccxtUsdPrices.push(info.value);
          }
        }
      }
    }

    let ccxtAverageUsd: number | undefined = undefined;
    if (ccxtUsdPrices.length > 0) {
      const sum = ccxtUsdPrices.reduce((a, b) => a + b, 0);
      ccxtAverageUsd = sum / ccxtUsdPrices.length;
    }

    // 📘 Live-MapDurchschnitt basierend auf allen aktuellen USD-Werten
    let mapAverageUsd: number | undefined = undefined;
    const prices: number[] = [];

    for (const [symbol, exchanges] of latestPriceMap ?? []) {
      if (symbol.startsWith(`${baseAsset}/`) && /(USDT|USD)$/.test(symbol)) {
        for (const [, info] of exchanges.entries()) {
          if (symbol.endsWith("/USDT") && usdtToUsdRate !== undefined) {
            prices.push(info.value * usdtToUsdRate);
          }
          if (symbol.endsWith("/USD")) {
            prices.push(info.value);
          }
        }
      }
    }

    if (prices.length > 0) {
      const sum = prices.reduce((a, b) => a + b, 0);
      mapAverageUsd = sum / prices.length;
    }

    // 🧮 Durchschnitt aus CCXT + ONCHAIN + MAP Durchschnitt
    let combinedAverage: number | undefined = undefined;
    if (ccxtAverageUsd !== undefined && mapAverageUsd !== undefined && onchainLive !== undefined) {
      combinedAverage = (ccxtAverageUsd + onchainLive + mapAverageUsd) / 3;
    }

    // 🧮 Durchschnitt aus CCXT + 2x ONCHAIN + MAP Durchschnitt
    let combinedAverage2on: number | undefined = undefined;
    if (ccxtAverageUsd !== undefined && mapAverageUsd !== undefined && onchainLive !== undefined) {
      combinedAverage2on = (ccxtAverageUsd + 2 * onchainLive + mapAverageUsd) / 4;
    }

    // 🧮 Durchschnitt aus CCXT + 3x ONCHAIN + MAP Durchschnitt
    let combinedAverage3on: number | undefined = undefined;
    if (ccxtAverageUsd !== undefined && mapAverageUsd !== undefined && onchainLive !== undefined) {
      combinedAverage3on = (ccxtAverageUsd + 3 * onchainLive + mapAverageUsd) / 5;
    }

    // 🧮 Durchschnitt aus CCXT + 4x ONCHAIN + MAP Durchschnitt
    let combinedAverage4on: number | undefined = undefined;
    if (ccxtAverageUsd !== undefined && mapAverageUsd !== undefined && onchainLive !== undefined) {
      combinedAverage4on = (ccxtAverageUsd + 4 * onchainLive + mapAverageUsd) / 6;
    }
    // 🧮 Letzter Wert aus Mapping als 'Last Value'
    let lastValue: number | undefined = undefined;
    if (history.length > 0) {
      lastValue = history[0].ftso_price;


    }

    const adjusted: number = combinedAverage4on ?? combinedAverage3on ?? combinedAverage2on ?? combinedAverage ?? NaN;

    debugLog.push(`\n📊 Ergebnis:`);
    debugLog.push(`  Adjusted Price           : ${adjusted}`);
    debugLog.push(`  CCXT Price Median (live) : ${ccxtLive}`);
    debugLog.push(`  CCXT Price Durchschnitt  : ${ccxtAverageUsd !== undefined ? ccxtAverageUsd.toFixed(8) : "N/A"}`);
    debugLog.push(`  ONCHAIN Price (live)     : ${onchainLive}`);
    debugLog.push(`  USDT/USD Preis           : ${usdtToUsdRate !== undefined ? usdtToUsdRate.toFixed(8) : "N/A"}`);
    debugLog.push(`  Live-MapDurchschnitt     : ${mapAverageUsd !== undefined ? mapAverageUsd.toFixed(8) : "N/A"}`);
    debugLog.push(`  CCXT-ON-MAP              : ${combinedAverage !== undefined ? combinedAverage.toFixed(8) : "N/A"}`);
    debugLog.push(`  CCXT-2ON-MAP             : ${combinedAverage2on !== undefined ? combinedAverage2on.toFixed(8) : "N/A"}`);
    debugLog.push(`  CCXT-3ON-MAP             : ${combinedAverage3on !== undefined ? combinedAverage3on.toFixed(8) : "N/A"}`);
    debugLog.push(`  CCXT-4ON-MAP             : ${combinedAverage4on !== undefined ? combinedAverage4on.toFixed(8) : "N/A"}`);
    debugLog.push(`  Last Value               : ${lastValue !== undefined ? lastValue.toFixed(8) : "N/A"}`);
    debugLog.push(`===========================================================\n`);

    if (logger) {
      logger.debug(debugLog.join("\n"));
    }

    return adjusted;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return ccxtLive;
  }
}
