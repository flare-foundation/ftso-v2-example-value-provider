import { Logger } from "@nestjs/common";
import ccxt, { Exchange, Trade } from "ccxt";
import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { retry, RetryError, sleepFor } from "src/utils/retry";
import { VolumeStore } from "./volumes";
import { asError } from "../utils/error";

import prodFeeds from "../config/feeds.json";
import testFeeds from "../config/test-feeds.json";

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

interface PriceInfo {
  value: number;
  time: number;
  exchange: string;
}

interface LoadResult {
  exchangeName: string;
  result: PromiseSettledResult<void>;
}

const RETRY_BACKOFF_MS = 10_000;

// Parameter for exponential decay in time-weighted median price calculation
const LAMBDA = process.env.MEDIAN_DECAY ? parseFloat(process.env.MEDIAN_DECAY) : 0.00005;
const TRADES_HISTORY_SIZE = process.env.TRADES_HISTORY_SIZE ? parseInt(process.env.TRADES_HISTORY_SIZE) : 1000; // 1000 is default in ccxt

const usdtToUsdFeedId: FeedId = { category: FeedCategory.Crypto.valueOf(), name: "USDT/USD" };

export class CcxtFeed implements BaseDataFeed {
  private readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  private config: FeedConfig[];
  private configByKey = new Map<string, FeedConfig>();

  private readonly exchangeByName: Map<string, Exchange> = new Map();

  /** Symbol -> exchange -> last price */
  private readonly latestPrice: Map<string, Map<string, PriceInfo>> = new Map();
  /** Symbol -> exchange -> volume */
  private readonly volumes: Map<string, Map<string, VolumeStore>> = new Map();

  async start() {
    this.config = this.loadConfig();
    const exchangeToSymbols = new Map<string, Set<string>>();

    for (const feed of this.config) {
      for (const source of feed.sources) {
        const symbols = exchangeToSymbols.get(source.exchange) || new Set();
        symbols.add(source.symbol);
        exchangeToSymbols.set(source.exchange, symbols);
      }
    }

    this.logger.log(`Connecting to exchanges: ${JSON.stringify(Array.from(exchangeToSymbols.keys()))}`);
    const loadExchanges = [];
    this.logger.log(`Initializing exchanges with trade limit ${TRADES_HISTORY_SIZE}`);
    for (const exchangeName of exchangeToSymbols.keys()) {
      try {
        const exchange: Exchange = new ccxt.pro[exchangeName]({ newUpdates: true });
        exchange.options["tradesLimit"] = TRADES_HISTORY_SIZE;
        this.exchangeByName.set(exchangeName, exchange);
        loadExchanges.push([exchangeName, retry(async () => exchange.loadMarkets(), 2, RETRY_BACKOFF_MS, this.logger)]);
      } catch (e) {
        this.logger.warn(`Failed to initialize exchange ${exchangeName}, ignoring: ${e}`);
        exchangeToSymbols.delete(exchangeName);
      }
    }

    // Load all exchanges in parallel
    this.logger.log(`Initializing all exchanges`);
    const loadResults: LoadResult[] = await Promise.all(
      loadExchanges.map(async ([exchangeName, loadPromise]) => {
        const result = await Promise.allSettled([loadPromise]);
        // result[0] is the settled state of loadPromise
        return { exchangeName, result: result[0] };
      })
    );

    for (const { exchangeName, result } of loadResults) {
      if (result.status === "fulfilled") {
        this.logger.log(`Exchange ${exchangeName} initialized successfully.`);
      } else {
        this.logger.warn(`Failed to load markets for ${exchangeName}: ${result.reason}`);
        exchangeToSymbols.delete(exchangeName);
      }
    }

    await this.initWatchTrades(exchangeToSymbols);

    this.initialized = true;
    this.logger.log(`Initialization done, watching trades...`);
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    const promises = feeds.map(feed => this.getValue(feed));
    return Promise.all(promises);
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const price = await this.getFeedPrice(feed);
    return {
      feed: feed,
      value: price,
    };
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    const usdtToUsd = (await this.getFeedPrice(usdtToUsdFeedId)) ?? undefined;

    const results = await Promise.all(
      feeds.map(async feed => {
        const volMap = new Map<string, number>();

        const volByExchange = this.volumes.get(feed.name);
        if (volByExchange) {
          for (const [exchange, volStore] of volByExchange) {
            volMap.set(exchange, volStore.getVolume(volumeWindow));
          }
        }

        if (feed.name.endsWith("/USD")) {
          const usdtName = feed.name.replace("/USD", "/USDT");
          const usdtVolByExchange = this.volumes.get(usdtName);
          if (usdtVolByExchange) {
            for (const [exchange, volStore] of usdtVolByExchange) {
              volMap.set(
                exchange,
                (volMap.get(exchange) || 0) + Math.round(volStore.getVolume(volumeWindow) * usdtToUsd)
              );
            }
          }
        }

        return {
          feed,
          volumes: Array.from(volMap, ([exchange, volume]) => ({ exchange, volume })),
        };
      })
    );
    return results;
  }

  private async initWatchTrades(exchangeToSymbols: Map<string, Set<string>>) {
    for (const [exchangeName, symbols] of exchangeToSymbols) {
      const exchange = this.exchangeByName.get(exchangeName);
      if (exchange === undefined) continue;

      const marketIds: string[] = [];
      for (const symbol of symbols) {
        const market = exchange.markets[symbol];
        if (market === undefined) {
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
      this.logger.warn(`Exchange ${exchange.id} does not support watching trades, polling for trades instead`);
      void this.fetchTrades(exchange, marketIds, exchangeName);
    }
  }

  private async fetchTrades(exchange: Exchange, marketIds: string[], exchangeName: string) {
    while (true) {
      try {
        await retry(
          async () => {
            for (const marketId of marketIds) {
              const trades = await exchange.fetchTrades(marketId);
              if (trades.length > 0) {
                trades.sort((a, b) => b.timestamp - a.timestamp);
                const latestTrade = trades[0];
                if (latestTrade.timestamp > (this.latestPrice.get(latestTrade.symbol)?.get(exchange.id)?.time || 0)) {
                  this.setPrice(exchange.id, latestTrade.symbol, latestTrade.price, latestTrade.timestamp);
                }
              } else {
                this.logger.warn(`No trades found for ${marketId} on ${exchangeName}`);
              }
            }
          },
          5,
          2000,
          this.logger
        );
        await sleepFor(1_000); // Wait 1 second before the next fetch
      } catch (e) {
        const error = asError(e);
        if (error instanceof RetryError) {
          this.logger.debug(
            `Failed to fetch trades after multiple retries for ${exchange.id}/${marketIds}: ${error.cause}, will attempt again in 5 minutes`
          );
          await sleepFor(300_000); // Wait 5 minutes, we must be rate-limited
        } else throw error;
      }
    }
  }

  private async watchTradesForSymbols(exchange: Exchange, marketIds: string[]) {
    const sinceBySymbol = new Map<string, number>();
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
      } catch (e) {
        const error = asError(e);
        this.logger.debug(`Failed to watch trades for ${exchange.id}/${marketIds}: ${error}, will retry`);
        await sleepFor(10_000);
      }
    }
  }

  private async watchTradesForSymbol(exchange: Exchange, marketId: string) {
    let since = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
      } catch (e) {
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

  private async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
    const key = this.feedKey(feedId);
    const config = this.configByKey.get(key);
    if (!config) {
      this.logger.warn(`No config found for ${JSON.stringify(feedId)}`);
      return undefined;
    }

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

    // Gather all available prices
    for (const source of config.sources) {
      const info = this.latestPrice.get(source.symbol)?.get(source.exchange);
      // Skip if no price information is available
      if (!info) continue;

      let price = info.value;

      price = source.symbol.endsWith("USDT") ? await convertToUsd(source.symbol, source.exchange, price) : price;
      if (price === undefined) continue;

      // Add the price to our list for median calculation
      prices.push({
        ...info,
        value: price,
      });
    }

    if (prices.length === 0) {
      this.logger.warn(`No prices found for ${JSON.stringify(feedId)}`);
      // Attempt to fetch last known price from exchanges. Don't block on this request - data will be available later on re-query.
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
      this.logger.log(`Fetching last price for ${market.id} on ${source.exchange}`);
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

  private weightedMedian(prices: PriceInfo[]): number {
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

  // helper to normalize FeedId → string
  private feedKey(feed: FeedId): string {
    return `${feed.category}:${feed.name}`;
  }

  private loadConfig() {
    const config = process.env.NETWORK === "local-test" ? testFeeds : prodFeeds;

    try {
      if (config.find(feed => feedsEqual(feed.feed, usdtToUsdFeedId)) === undefined) {
        throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
      }

      for (const cfg of config) {
        this.configByKey.set(this.feedKey(cfg.feed), cfg);
      }

      this.logger.log(`Supported feeds: ${JSON.stringify(config.map(f => f.feed))}`);

      return config;
    } catch (err) {
      this.logger.error("Error parsing JSON config:", err);
      throw err;
    }
  }
}

function feedsEqual(a: FeedId, b: FeedId): boolean {
  return a.category === b.category && a.name === b.name;
}
