import WebSocket from 'ws';
import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { Logger } from "@nestjs/common";


type PriceInfo = {
  value: number;
  time: number;
  source: string;
};

export class CustomWsFeed implements BaseDataFeed {
  private readonly logger = new Logger(CustomWsFeed.name);
  private readonly latestPrices: Map<string, Map<string, PriceInfo>> = new Map(); // symbol -> client-id -> price
  private readonly lastValidFeedPrice: Map<string, { value: number; time: number }> = new Map();
  private readonly wsUrl = "ws://10.10.1.206:8765/client?key=CLIENT_KEY_1";

  constructor() {
    this.logger.log("Connecting to custom WebSocket feed...");
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.wsUrl);

    ws.on("open", () => {
      this.logger.log("Connected to custom WebSocket server.");
    });

    ws.on("message", (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "trade" && parsed.symbol && parsed.price) {
          const symbol = parsed.symbol.toLowerCase(); // z. B. btcusd
          const source = parsed.source || "default";
          const price = parseFloat(parsed.price);
          //this.logger.debug(`Trade received: ${parsed.symbol} → ${price}`);
          //this.logger.debug(`Saved as key: ${symbol}`);

          const now = Date.now();
          if (!isNaN(price)) {
            const perClient = this.latestPrices.get(symbol) || new Map();
            perClient.set(source, { value: price, time: now, source });
            this.latestPrices.set(symbol, perClient);
          }
        }
      } catch (err) {
        this.logger.error("WebSocket parse error", err);
      }
    });

    ws.on("close", () => {
      this.logger.warn("WebSocket closed, reconnecting in 5s");
      setTimeout(() => this.connect(), 5000);
    });
  }

  private getUsdtToUsd(): number | undefined {
    const priceMap = this.latestPrices.get("usdt/usd");
    if (!priceMap || priceMap.size === 0) return undefined;

    const values = Array.from(priceMap.values()).map(p => p.value);
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }

  private purgeStalePrices(ttlMs: number) {
    const now = Date.now();
    this.latestPrices.forEach((map, symbol) => {
      map.forEach((info, source) => {
        if (now - info.time > ttlMs) {
          map.delete(source);
        }
      });
      if (map.size === 0) this.latestPrices.delete(symbol);
    });
  }

  private getFeedPrice(feedId: FeedId): number | undefined {
    const key = feedId.name.toLowerCase(); // z. B. rune/usd
    this.purgeStalePrices(1800000);

    // Schritt 1: Direkter Treffer?
    let prices = this.latestPrices.get(key);
    if (prices && prices.size > 0) {
      const values = Array.from(prices.values()).map(p => p.value);
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    }

    // Schritt 2: USD → USDT Fallback
    if (key.endsWith("/usd")) {
      const usdtKey = key.replace("/usd", "/usdt"); // rune/usd → rune/usdt
      const usdtPrices = this.latestPrices.get(usdtKey);
      const usdtToUsd = this.getUsdtToUsd();

      if (usdtPrices && usdtToUsd) {
        const values = Array.from(usdtPrices.values()).map(p => p.value * usdtToUsd);
        values.sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      }
    }

    return undefined;
  }

  private async getSafeFeedPrice(feedId: FeedId): Promise<number> {
    const now = Date.now();
    const key = `${feedId.category}-${feedId.name}`;
    const price = this.getFeedPrice(feedId);

    if (price && price > 0) {
      this.lastValidFeedPrice.set(key, { value: price, time: now });
      return price;
    }

    const fallback = this.lastValidFeedPrice.get(key);
    if (fallback && now - fallback.time < 5 * 60_000) {
      this.logger.warn(`⚠️ Preis veraltet, Rückfallwert für ${feedId.name}: ${fallback.value}`);
      return fallback.value;
    }

    this.logger.warn(`❌ Kein Preis für ${feedId.name}, Rückgabe 0.01`);
    return 0.01;
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const value = await this.getSafeFeedPrice(feed);
    return { feed, value };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getVolumes(): Promise<FeedVolumeData[]> {
    // Optional: gleiche Idee wie in `CcxtFeed`, falls dein WS Volumen liefert
    return [];
  }

}



