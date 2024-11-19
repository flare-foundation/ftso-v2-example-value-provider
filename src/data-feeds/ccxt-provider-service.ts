import { Logger } from "@nestjs/common";
import ccxt, { Exchange, Trade } from "ccxt";
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
  price: number;
  time: number;
  exchange: string;
  amount: number;
}

const usdtToUsdFeedId: FeedId = { category: FeedCategory.Crypto.valueOf(), name: "USDT/USD" };

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
        await loadExchange;
        this.logger.log(`Exchange ${exchangeName} initialized`);
      } catch (e) {
        this.logger.warn(`Failed to load markets for ${exchangeName}, ignoring: ${e}`);
        exchangeToSymbols.delete(exchangeName);
      }
    }
    this.initialized = true;

    this.logger.log(`Initialization done, watching trades...`);
    void this.watchTrades(exchangeToSymbols);
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

  private async watchTrades(exchangeToSymbols: Map<string, Set<string>>) {
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
      const prices = this.prices.get(trade.symbol) || new Map<string, PriceInfo>();
      prices.set(exchangeName, {
        price: trade.price,
        time: trade.timestamp,
        exchange: exchangeName,
        amount: trade.amount,
      });
      this.prices.set(trade.symbol, prices);
    });
  }

  private async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
    const config = this.config.find(config => feedsEqual(config.feed, feedId));
    if (!config) {
      this.logger.warn(`No config found for ${JSON.stringify(feedId)}`);
      return undefined;
    }

    let usdtToUsd: number | undefined;
    const prices: number[] = [];

    // Gather all available prices
    for (const source of config.sources) {
      const info = this.prices.get(source.symbol)?.get(source.exchange);
      // Skip if no price information is available
      if (!info || info.amount === undefined) continue;

      let price = info.price;

      // Adjust for USDT to USD if needed
      if (source.symbol.endsWith("USDT")) {
        if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsdFeedId);
        if (usdtToUsd === undefined) {
          this.logger.warn(`Unable to retrieve USDT to USD conversion rate for ${source.symbol} at ${source.exchange}`);
          continue; // Skip this source if conversion rate is unavailable
        }
        price *= usdtToUsd;
      }

      // Add the price to our list for median calculation
      prices.push(price);
    }

    // If no valid prices were found, return undefined
    if (prices.length === 0) {
      this.logger.warn(`No prices found for ${JSON.stringify(feedId)}`);
      return undefined;
    }
    // If single price found, return price
    if (prices.length === 1) {
      return prices[0];
    }

    // Sort the prices in ascending order
    prices.sort((a, b) => a - b);

    // Calculate the median
    const mid = Math.floor(prices.length / 2);
    const median =
      prices.length % 2 !== 0
        ? prices[mid] // Odd number of elements, take the middle one
        : (prices[mid - 1] + prices[mid]) / 2; // Even number of elements, average the two middle ones

    return median;
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
