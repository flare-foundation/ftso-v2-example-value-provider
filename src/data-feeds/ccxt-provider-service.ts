import { Logger } from "@nestjs/common";
import * as ccxt from "ccxt";
import type { Exchange, Trade } from "ccxt";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { retry, sleepFor } from "../utils/retry";
import { VolumeStore } from "./volumes";
import { asError } from "../utils/error";

enum FeedCategory {
  None = 0,
  Crypto = 1,
  FX = 2,
  Commodity = 3,
  Stock = 4,
}

interface FeedConfig {
  feed: FeedId;
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

export interface PriceInfo {
  value: number;
  time: number;
  exchange: string;
}

type networks = "local-test" | "from-env" | "coston2" | "coston" | "songbird";

const CONFIG_PATH = "src/config/";
const RETRY_BACKOFF_MS = 10_000;

const PING_INTERVALS: Record<string, number> = {
  bybit: 20000,
  binance: 30000,
  kucoin: 30000,
  okx: 25000,
  gate: 30000,
};

// Parameter for exponential decay in time-weighted median price calculation
const LAMBDA = process.env.MEDIAN_DECAY ? parseFloat(process.env.MEDIAN_DECAY) : 0.00005;
const PRICE_TTL_MS = process.env.PRICE_TTL_MS ? parseFloat(process.env.PRICE_TTL_MS) : 1800000;
const TRADES_HISTORY_SIZE = process.env.TRADES_HISTORY_SIZE ? parseInt(process.env.TRADES_HISTORY_SIZE) : 1000; // 1000 is default in ccxt

const usdtToUsdFeedId: FeedId = { category: FeedCategory.Crypto.valueOf(), name: "USDT/USD" };

export class CcxtFeed implements BaseDataFeed {
  protected readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  protected config: FeedConfig[];

  protected readonly exchangeByName: Map<string, Exchange> = new Map();

  /** Symbol -> exchange -> last price */
  protected readonly latestPrice: Map<string, Map<string, PriceInfo>> = new Map();
  /** Symbol -> exchange -> volume */
  protected readonly volumes: Map<string, Map<string, VolumeStore>> = new Map();
  protected lastValidFeedPrice: Map<string, { value: number; time: number }> = new Map();

  private exportFallbackPrices(): void {
    const fallback: Record<string, number> = {};
    for (const [key, data] of this.lastValidFeedPrice.entries()) {
      if (data.value > 0) fallback[key] = data.value;
    }
    const path = join(process.cwd(), "src/config/fallback-prices.json");
    try {
      writeFileSync(path, JSON.stringify(fallback, null, 2));
      this.logger.log(`📦 Fallback-Preise aktualisiert unter ${path}`);
    } catch (e) {
      this.logger.error(`❌ Fehler beim Schreiben von fallback-prices.json:`, e);
    }
  }

  public getLatestPriceMap(): Map<string, Map<string, PriceInfo>> {
    return this.latestPrice;
  }

  public getPriceInfo(symbol: string, exchange: string): PriceInfo | undefined {
    return this.latestPrice.get(symbol)?.get(exchange);
  }

  public getVolumesMap(): Map<string, Map<string, VolumeStore>> {
    return this.volumes;
  }

  public getVolumeStore(symbol: string, exchange: string): VolumeStore | undefined {
    return this.volumes.get(symbol)?.get(exchange);
  }


  async getSafeFeedPrice(feedId: FeedId): Promise<number> {
    const now = Date.now();
    const key = `${feedId.category}-${feedId.name}`;
    const price = await this.getFeedPrice(feedId);

    if (price && price > 0) {
      this.lastValidFeedPrice.set(key, { value: price, time: now });
      this.exportFallbackPrices();
      return price;
    }

    const fallback = this.lastValidFeedPrice.get(key);
    if (fallback && now - fallback.time < 5 * 60_000) {
      this.logger.warn(`⚠️ Preis veraltet, verwende alten Wert für ${feedId.name}: ${fallback.value}`);
      return fallback.value;
    }

    this.logger.warn(`❌ Kein gültiger Preis für ${feedId.name}, Rückgabe Defaultwert 1`);
    return 1;
  }
  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const value = await this.getSafeFeedPrice(feed);
    return { feed, value };
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    let usdtToUsd: number | undefined;

    const convertToUsd = async (price: number) => {
      if (!usdtToUsd) usdtToUsd = await this.getFeedPrice(usdtToUsdFeedId);
      return usdtToUsd ? price * usdtToUsd : undefined;
    };

    const res: FeedVolumeData[] = [];
    for (const feed of feeds) {
      const volMap = new Map<string, number>();
      const baseVolume = this.volumes.get(feed.name);

      baseVolume?.forEach((vol, ex) => volMap.set(ex, vol.getVolume(volumeWindow)));

      if (feed.name.endsWith("/USD")) {
        const alt = this.volumes.get(feed.name.replace("/USD", "/USDT"));
        for (const [ex, vol] of alt ?? []) {
          const usdVol = await convertToUsd(vol.getVolume(volumeWindow));
          volMap.set(ex, (volMap.get(ex) ?? 0) + (usdVol ?? 0));
        }
      }

      res.push({
        feed,
        volumes: Array.from(volMap.entries()).map(([exchange, volume]) => ({ exchange, volume: Math.round(volume) })),
      });
    }
    return res;
  }

  async start() {
    this.loadFallbackPrices();
    this.config = this.loadConfig();
    const exchangeToSymbols = new Map<string, Set<string>>();
    if (process.env.DEBUG_ALL_EXCHANGES === "true") {
      await logSupportedMarketsForFeeds(this.config, this.logger);
      //await logMarketsForExchanges();
    }
    for (const feed of this.config) {
      for (const source of feed.sources) {
        const symbols = exchangeToSymbols.get(source.exchange) || new Set();
        symbols.add(source.symbol);
        exchangeToSymbols.set(source.exchange, symbols);
      }
    }

    const loadExchanges = [];
    for (const exchangeName of exchangeToSymbols.keys()) {
      try {
        let ExchangeClass: new (args: Record<string, unknown>) => Exchange;
        if (ccxt.pro && ccxt.pro[exchangeName]) {
          ExchangeClass = ccxt.pro[exchangeName];
        } else if (ccxt[exchangeName]) {
          ExchangeClass = ccxt[exchangeName];
        } else {
          this.logger.warn(`Exchange ${exchangeName} not found in ccxt or ccxt.pro`);
          continue;
        }

        let exchange: Exchange;
        try {
          exchange = new ExchangeClass({ newUpdates: true });
        } catch (e) {
          this.logger.warn(`Failed to instantiate exchange ${exchangeName}, ignoring: ${e}`);
          continue;
        }

        exchange.options["tradesLimit"] = TRADES_HISTORY_SIZE;
        this.exchangeByName.set(exchangeName, exchange);
        loadExchanges.push([exchangeName, retry(async () => exchange.loadMarkets(), 2, RETRY_BACKOFF_MS, this.logger)]);
      } catch (e) {
        this.logger.warn(`Failed to initialize exchange ${exchangeName}, ignoring: ${e}`);
        exchangeToSymbols.delete(exchangeName);
      }
    }

    for (const [exchangeName, exchange] of this.exchangeByName.entries()) {
      const pingFn = (exchange as unknown as { ping?: (...args: unknown[]) => unknown }).ping;
      const interval = PING_INTERVALS[exchangeName] ?? 30000;

      if (typeof pingFn === "function") {
        this.logger.log(`🔄 Setting up ping for ${exchangeName} every ${interval / 1000}s`);
        setInterval(async () => {
          try {
            const maybePromise = pingFn.call(exchange);
            if (maybePromise instanceof Promise) {
              await maybePromise;
            }
          } catch (err: unknown) {
            if (err instanceof Error) {
              this.logger.warn(`❌ Ping to ${exchangeName} failed: ${err.message}`);
            } else {
              this.logger.warn(`❌ Ping to ${exchangeName} failed: ${JSON.stringify(err)}`);
            }
          }
        }, interval);
      }
    }

    await this.initWatchTrades(exchangeToSymbols);
    this.initialized = true;
    this.logger.log(`Initialization done, watching trades...`);
  }

  private async ensureMarketsLoaded(exchange: Exchange): Promise<void> {
    if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
      await exchange.loadMarkets();
    }
  }

  private async initWatchTrades(exchangeToSymbols: Map<string, Set<string>>) {
    for (const [exchangeName, symbols] of exchangeToSymbols) {
      const exchange = this.exchangeByName.get(exchangeName);
      if (exchange === undefined) continue;

      // 🛠️ neu: sicherstellen, dass Märkte geladen sind
      await this.ensureMarketsLoaded(exchange);

      const marketIds: string[] = [];
      for (const symbol of symbols) {
        const market = exchange.markets?.[symbol];
        if (!market) {
          this.logger.warn(`Market not found for ${symbol} on ${exchangeName}`);
          continue;
        }
        marketIds.push(market.id);
      }

      void this.watch(exchange, marketIds, exchangeName);
    }
  }

  private async watch(exchange: Exchange, marketIds: string[], exchangeName: string) {
    this.logger.log(`Watching trades for ${marketIds} on exchange ${exchangeName}`);
    if (exchange.has["watchTradesForSymbols"] && exchange.id != "bybit") {
      void this.watchTradesForSymbols(exchange, marketIds);
    } else if (exchange.has["watchTrades"]) {
      marketIds.forEach(marketId => void this.watchTradesForSymbol(exchange, marketId));
    } else {
      this.logger.warn(`Not tracking ${exchange.id} for symbols ${marketIds}`);
    }
  }

  private loadFallbackPrices() {
    const path = join(process.cwd(), "src/config/fallback-prices.json");
    try {
      const raw = readFileSync(path, "utf-8");
      const fallback: Record<string, number> = JSON.parse(raw);
      const now = Date.now();
      for (const [key, value] of Object.entries(fallback)) {
        if (value > 0) {
          this.lastValidFeedPrice.set(key, { value, time: now });
        }
      }
      this.logger.log(`✅ ${Object.keys(fallback).length} Fallback-Preise geladen`);
    } catch (e) {
      this.logger.warn(`⚠️ fallback-prices.json konnte nicht geladen werden: ${e}`);
    }
  }

  private stopRequested = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public stop() {
    this.stopRequested = true;
  }

  private async watchTradesForSymbols(exchange: Exchange, marketIds: string[]): Promise<void> {
    const sinceBySymbol = new Map<string, number>();
    // eslint-disable-next-line no-constant-condition
    while (!this.stopRequested) {
      try {
        const trades = await exchange.watchTradesForSymbols(marketIds);

        // Some exchange impls don't respect the "since" filter parameter or guarantee trade ordering, so we retrieve the full trade buffer and filter manually.
        const since = sinceBySymbol.get(trades[0].symbol) ?? 0;
        const newTrades = trades.filter(trade => trade.timestamp > since).sort((a, b) => a.timestamp - b.timestamp);

        if (newTrades.length === 0) {
          await sleepFor(1000);
          continue;
        }

        const lastTrade = newTrades.at(-1);
        this.setPrice(exchange.id, lastTrade.symbol, lastTrade.price, lastTrade.timestamp);
        sinceBySymbol.set(lastTrade.symbol, lastTrade.timestamp);

        this.processVolume(exchange.id, lastTrade.symbol, newTrades);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.includes("code 1006")) {
          this.logger.verbose(`🔌 WebSocket closed (1006) for ${exchange.id}/${marketIds}, will retry`);
        } else {
          this.logger.warn(`❗ Failed to watch trades for ${exchange.id}/${marketIds}: ${message}`);
        }

        await sleepFor(10_000);
      }
    }
  }

  private async watchTradesForSymbol(exchange: Exchange, marketId: string) {
    let since = undefined;
    // eslint-disable-next-line no-constant-condition
    while (!this.stopRequested) {
      try {
        const trades = await exchange.watchTrades(marketId, since);
        if (trades.length === 0) {
          await sleepFor(1_000);
          continue;
        }

        // Seems not all exchanges guarantee trade ordering by timestamp
        trades.sort((a, b) => a.timestamp - b.timestamp);

        const lastTrade = trades.at(-1);
        this.setPrice(exchange.id, lastTrade.symbol, lastTrade.price, lastTrade.timestamp);
        since = lastTrade.timestamp + 1;

        this.processVolume(exchange.id, lastTrade.symbol, trades);
      } catch (e: unknown) {
        const error = asError(e);
        this.logger.debug(`Failed to watch trades for ${exchange.id}/${marketId}: ${error}, will retry`);
        await sleepFor(5_000 + Math.random() * 10_000);
      }
    }
  }

  private processVolume(exchangeId: string, symbol: string, trades: Trade[]) {
    const exchangeVolumes = this.volumes.get(symbol) || new Map<string, VolumeStore>();
    this.volumes.set(symbol, exchangeVolumes);

    const volumeStore = exchangeVolumes.get(exchangeId) || new VolumeStore();
    exchangeVolumes.set(exchangeId, volumeStore);

    volumeStore.processTrades(trades);
  }

  private setPrice(exchangeName: string, symbol: string, price: number, timestamp?: number) {
    const prices = this.latestPrice.get(symbol) || new Map<string, PriceInfo>();
    prices.set(exchangeName, {
      value: price,
      time: timestamp ?? Date.now(),
      exchange: exchangeName,
    });
    this.latestPrice.set(symbol, prices);
  }
  private purgeStalePrices(ttlMs: number) {
    const now = Date.now();
    this.latestPrice.forEach((exMap, symbol) => {
      exMap.forEach((info, exchange) => {
        if (now - info.time > ttlMs) {
          exMap.delete(exchange);
        }
      });
      if (exMap.size === 0) this.latestPrice.delete(symbol);
    });
  }
  protected async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
    const config = this.config.find(config => feedsEqual(config.feed, feedId));
    if (!config) {
      this.logger.warn(`No config found for ${JSON.stringify(feedId)}`);
      return undefined;
    }

    // ⬇️ Cleanup
    this.purgeStalePrices(PRICE_TTL_MS);

    let usdtToUsd: number | undefined;

    const convertToUsd = async (symbol: string, exchange: string, price: number) => {
      if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsdFeedId);
      if (usdtToUsd === undefined) {
        this.logger.warn(`Unable to retrieve USDT to USD conversion rate for ${symbol} at ${exchange}`);
        return undefined;
      }
      return price * usdtToUsd;
    };

    const prices: PriceInfo[] = [];

    for (const source of config.sources) {
      const info = this.latestPrice.get(source.symbol)?.get(source.exchange);
      if (!info) continue;

      let price = info.value;
      price = source.symbol.endsWith("USDT") ? await convertToUsd(source.symbol, source.exchange, price) : price;
      if (price === undefined) continue;

      prices.push({
        ...info,
        value: price,
      });
    }

    if (prices.length === 0) {
      this.logger.warn(`No prices found for ${JSON.stringify(feedId)}`);
      void this.fetchLastPrices(config);
      return undefined;
    }

    this.logger.debug(`Calculating results for ${JSON.stringify(feedId)}`);
    return this.weightedMedian(prices);
  }

  private fetchAttempted = new Set<FeedId>();

  private async fetchLastPrices(config: FeedConfig) {
    if (this.fetchAttempted.has(config.feed)) {
      return;
    } else {
      this.fetchAttempted.add(config.feed);
    }

    for (const source of config.sources) {
      const exchange: Exchange = this.exchangeByName.get(source.exchange);
      if (exchange == undefined) continue;
      const market = exchange.markets[source.symbol];
      if (market == undefined) continue;
      //this.logger.log(`Fetching last price for ${market.id} on ${source.exchange}`);
      const ticker = await exchange.fetchTicker(market.id);
      if (ticker === undefined) {
        this.logger.warn(`Ticker not found for ${market.id} on ${source.exchange}`);
        continue;
      }
      if (ticker.last === undefined) {
        this.logger.log(`No last price found for ${market.id} on ${source.exchange}`);
        continue;
      }

      this.setPrice(source.exchange, ticker.symbol, ticker.last, ticker.timestamp);
    }
  }

  protected weightedMedian(prices: PriceInfo[]): number {
    if (prices.length === 0) {
      throw new Error("Price list cannot be empty.");
    }

    prices.sort((a, b) => a.time - b.time);

    // Current time for weight calculation
    const now = Date.now();

    // Calculate exponential weights
    const weights = prices.map(data => {
      const timeDifference = now - data.time;
      return Math.exp(-LAMBDA * timeDifference); // Exponential decay
    });

    // Normalize weights to sum to 1
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

    if (weightSum === 0) {
      // All prices extremely stale, return any
      return prices[0].value;
    }

    const normalizedWeights = weights.map(weight => weight / weightSum);

    // Combine prices and weights
    const weightedPrices = prices.map((data, i) => ({
      price: data.value,
      weight: normalizedWeights[i],
      exchange: data.exchange,
      staleness: now - data.time,
    }));

    // Sort prices by value for median calculation
    weightedPrices.sort((a, b) => a.price - b.price);

    this.logger.debug("Weighted prices:");
    for (const { price, weight, exchange, staleness: we } of weightedPrices) {
      this.logger.debug(`Price: ${price}, weight: ${weight}, staleness ms: ${we}, exchange: ${exchange}`);
    }

    // Find the weighted median
    let cumulativeWeight = 0;
    for (let i = 0; i < weightedPrices.length; i++) {
      cumulativeWeight += weightedPrices[i].weight;
      if (cumulativeWeight >= 0.5) {
        this.logger.debug(`Weighted median: ${weightedPrices[i].price}`);
        return weightedPrices[i].price;
      }
    }

    this.logger.warn("Unable to calculate weighted median");
    return undefined;
  }

  private loadConfig() {
    const network = process.env.NETWORK as networks;
    let configPath: string;
    switch (network) {
      case "local-test":
        configPath = CONFIG_PATH + "test-feeds.json";
        break;
      default:
        configPath = CONFIG_PATH + "feeds.json";
    }

    let config: FeedConfig[];
    try {
      const jsonString = readFileSync(configPath, "utf-8");
      config = JSON.parse(jsonString);
    } catch (err: unknown) {
      if (err instanceof Error) {
        this.logger.error("Error loading/parsing JSON config:", err);
      }
      throw err;
    }

    // Jetzt ist klar: nur bei gültigem JSON prüfst du die Business-Logik
    if (!config.find(feed => feedsEqual(feed.feed, usdtToUsdFeedId))) {
      throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
    }

    this.logger.log(`Supported feeds: ${JSON.stringify(config.map(f => f.feed))}`);
    return config;
  }
}

function feedsEqual(a: FeedId, b: FeedId): boolean {
  return a.category === b.category && a.name === b.name;
}



async function logSupportedMarketsForFeeds(feeds: FeedConfig[], logger: Logger) {
  const proExchanges = [
    //"bybit",
    //"binance",
    //"kucoin",
    //"okx",
    //"cryptocom",
    //"gate",
    //"htx",
    //"bitstamp",
    //"kraken",
    //"bitget",
    //"coinbase",
    //"bingx",
    //"bitfinex",
    //"mexc",
    //"binanceus",
    //"bitmart",
    //"ascendex",
    //"probit",
    //
    //"bitrue",
    "probit",
  ];

  // Map aus aktiven sources (exchange+symbol)
  const activeSources = new Set(feeds.flatMap(feed => feed.sources.map(s => `${s.exchange}::${s.symbol}`)));

  // Alle symboile aus feeds.json
  const allSymbols = Array.from(new Set(feeds.flatMap(feed => feed.sources.map(s => s.symbol))));

  for (const exchangeId of proExchanges) {
    try {
      const ExchangeClass = (ccxt as unknown as Record<string, new (...args: unknown[]) => Exchange>)[exchangeId];
      if (typeof ExchangeClass !== "function") continue;

      const exchange = new ExchangeClass({ enableRateLimit: true });
      const markets = await exchange.loadMarkets();
      const supportedSymbols = Object.keys(markets);

      const matched = allSymbols.filter(sym => supportedSymbols.includes(sym));

      if (matched.length > 0) {
        const annotated = matched.map(sym => {
          const key = `${exchangeId}::${sym}`;
          return activeSources.has(key) ? `🟢 ${sym}` : `🔘 ${sym}`;
        });

        logger.debug(`✅ ${exchangeId} supports:\n${annotated.join("\n")}`);
      } else {
        logger.debug(`❌ ${exchangeId} supports none of your configured symbols`);
      }
    } catch (e) {
      logger.debug(`⚠️ ${exchangeId} skipped: ${(e as Error).message}`);
    }
  }
}
