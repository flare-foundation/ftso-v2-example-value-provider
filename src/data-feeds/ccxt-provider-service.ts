import { Logger } from "@nestjs/common";
import ccxt, { Exchange, pro, Trade } from "ccxt";
import { readFileSync } from "fs";
import { FeedId, FeedValueData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { retry, sleepFor } from "src/utils/retry";

type networks = "local-test" | "from-env" | "coston2" | "coston" | "songbird";

enum FeedCategory {
  None = 0,
  Crypto = 1,
  FX = 2,
  Commodity = 3,
  Stock = 4,
}

const CONFIG_PREFIX = "src/config/";
const RETRY_BACKOFF_MS = 10_000;

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

const usdtToUsdFeedId: FeedId = { category: FeedCategory.Crypto.valueOf(), name: "USDT/USD" };
// Parameter for exponential decay in time-weighted median price calculation
const lambda = process.env.MEDIAN_DECAY ? parseFloat(process.env.MEDIAN_DECAY) : 0.00005;

export class CcxtFeed implements BaseDataFeed {
  private readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  private config: FeedConfig[];

  private readonly exchangeByName: Map<string, Exchange> = new Map();

  /** Symbol -> exchange -> price */
  private readonly prices: Map<string, Map<string, PriceInfo>> = new Map();

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
    for (const exchangeName of exchangeToSymbols.keys()) {
      try {
        const exchange: Exchange = new ccxt.pro[exchangeName]({ newUpdates: true });
        this.exchangeByName.set(exchangeName, exchange);
        loadExchanges.push([exchangeName, retry(async () => exchange.loadMarkets(), 2, RETRY_BACKOFF_MS, this.logger)]);
      } catch (e) {
        this.logger.warn(`Failed to initialize exchange ${exchangeName}, ignoring: ${e}`);
        exchangeToSymbols.delete(exchangeName);
      }
    }

    for (const [exchangeName, loadExchange] of loadExchanges) {
      try {
        this.logger.log(`Initializing exchange ${exchangeName}`);
        await loadExchange;
        this.logger.log(`Exchange ${exchangeName} initialized`);
      } catch (e) {
        this.logger.warn(`Failed to load markets for ${exchangeName}, ignoring: ${e}`);
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

      await this.populateInitialPrices(marketIds, exchangeName, exchange);

      void this.watch(exchange, marketIds, exchangeName);
    }
  }

  private async populateInitialPrices(marketIds: string[], exchangeName: string, exchange: Exchange) {
    try {
      if (exchange.has["fetchTickers"]) {
        this.logger.log(`Fetching last prices for ${marketIds} on ${exchangeName}`);
        const tickers = await exchange.fetchTickers(marketIds);
        for (const [marketId, ticker] of Object.entries(tickers)) {
          if (ticker.last === undefined) {
            this.logger.warn(`No last price found for ${marketId} on ${exchangeName}`);
            continue;
          }

          this.setPrice(exchangeName, ticker.symbol, ticker.last, ticker.timestamp);
        }
      } else {
        throw new Error("Exchange does not support fetchTickers");
      }
    } catch (e) {
      this.logger.log(`Unable to retrieve ticker batch on ${exchangeName}: ${e}`);
      this.logger.log(`Falling back to fetching individual tickers`);
      for (const marketId of marketIds) {
        this.logger.log(`Fetching last price for ${marketId} on ${exchangeName}`);
        const ticker = await exchange.fetchTicker(marketId);
        if (ticker === undefined) {
          this.logger.warn(`Ticker not found for ${marketId} on ${exchangeName}`);
          continue;
        }
        if (ticker.last === undefined) {
          this.logger.log(`No last price found for ${marketId} on ${exchangeName}`);
          continue;
        }

        this.setPrice(exchangeName, ticker.symbol, ticker.last, ticker.timestamp);
      }
    }
  }

  private async watch(exchange: Exchange, marketIds: string[], exchangeName: string) {
    this.logger.log(`Watching trades for ${marketIds} on exchange ${exchangeName}`);

    if (exchange.has["watchTrades"]) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const trades = await retry(
            async () => exchange.watchTradesForSymbols(marketIds, null, 100),
            RETRY_BACKOFF_MS
          );
          this.processTrades(trades, exchangeName);
        } catch (e) {
          this.logger.error(`Failed to watch trades for ${exchangeName}: ${e}`);
          return;
        }
      }
    } else if (exchange.has["fetchTrades"]) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const trades: Trade[] = [];
          for (const marketId of marketIds) {
            const tradesForSymbol = await exchange.fetchTrades(marketId, null, 100);
            trades.push(tradesForSymbol[tradesForSymbol.length - 1]);
          }
          this.processTrades(trades, exchangeName);

          await sleepFor(1000);
        } catch (e) {
          this.logger.error(`Failed to fetch trades for ${exchangeName}: ${e}`);
          await sleepFor(10_000);
        }
      }
    }
  }

  private processTrades(trades: Trade[], exchangeName: string) {
    trades.forEach(trade => {
      this.setPrice(exchangeName, trade.symbol, trade.price, trade.timestamp);
    });
  }

  private setPrice(exchangeName: string, symbol: string, price: number, timestamp: number) {
    const prices = this.prices.get(symbol) || new Map<string, PriceInfo>();
    prices.set(exchangeName, {
      value: price,
      time: timestamp ?? Date.now(),
      exchange: exchangeName,
    });
    this.prices.set(symbol, prices);
  }

  private async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
    const config = this.config.find(config => feedsEqual(config.feed, feedId));
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
      const info = this.prices.get(source.symbol)?.get(source.exchange);
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
      return undefined;
    }

    this.logger.debug(`Calculating results for ${JSON.stringify(feedId)}`);
    return this.weightedMedian(prices);
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
      return Math.exp(-lambda * timeDifference); // Exponential decay
    });

    // Normalize weights to sum to 1
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
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
        configPath = CONFIG_PREFIX + "test-feeds.json";
        break;
      default:
        configPath = CONFIG_PREFIX + "feeds.json";
    }

    try {
      const jsonString = readFileSync(configPath, "utf-8");
      const config: FeedConfig[] = JSON.parse(jsonString);

      if (config.find(feed => feedsEqual(feed.feed, usdtToUsdFeedId)) === undefined) {
        throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
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
