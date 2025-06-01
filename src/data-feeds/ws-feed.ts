import WebSocket from "ws";
import { FeedId, FeedValueData, FeedVolumeData, Volume } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { Logger } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { applyPriceStrategy } from "../price-strategies";
import { fetchOnchainPrices } from "../utils/onchain";

import {
  TradeMap,
  TickerMap,
  OrderBookMap,
  TradeInfo,
  TickerInfo,
  OrderLevel,
  OrderBook,
} from "../types/market-data-types";

import { getFeedDecimals, getFeedOnchainDecimals, storeSubmittedPriceExtended } from "../utils/mysql";

//const CONFIG_PATH = "src/config/";
const CONFIG_PATH = join(process.cwd(), process.env.CONFIG_PATH || "src/config/");

type OnchainFeedEntry = {
  value: number;
  decimals: number;
};

interface FeedConfig {
  feed: FeedId;
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

function normalizeSymbol(symbol: string): string {
  return symbol.toLowerCase().replace("/usdt", "/usd");
}

export class WsFeed implements BaseDataFeed {
  private readonly logger = new Logger(WsFeed.name);
  private readonly wsBaseUrl = "ws://10.10.1.206:8766";
  private readonly wsKey = "clt_my_82a7e9f3b04c4e88b7fba19d";

  private currentVotingRoundId?: number;
  private readonly tradeMap: TradeMap = new Map();
  private readonly tickerMap: TickerMap = new Map();
  private readonly orderBookMap: OrderBookMap = new Map();
  private readonly onchainPriceMap: Map<string, OnchainFeedEntry> = new Map();
  private readonly lastValidFeedPrice: Map<string, { value: number; time: number }> = new Map();
  private readonly fallbackPath = join(process.cwd(), "src/config/fallback-prices.json");
  private readonly debugMode = process.env.DEBUG_WS_FEED === "true";

  protected config: FeedConfig[];

  constructor() {
    this.logger.log("Connecting to FTSO WebSocket feed...");
    this.config = this.loadConfig();

    ["trade"].forEach(type => {
      for (const symbol of this.getBaseSymbols()) {
        this.connectFiltered({
          symbol,
          symbolQuote: "all",
          exchange: "all",
          types: [type],
        });
      }
    });
    this.startCleanupLoop();
  }

  private loadConfig() {
    const configPath = CONFIG_PATH + "feeds.json";
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
    this.logger.log(`Supported feeds: ${JSON.stringify(config.map(f => f.feed))}`);
    return config;
  }

  private getBaseSymbols(): string[] {
    const seen = new Set<string>();
    for (const entry of this.config) {
      const name = entry.feed.name;
      if (!name.includes("/")) continue;
      const base = name.split("/")[0].trim().toUpperCase();
      seen.add(base);
    }
    return Array.from(seen);
  }

  private connectFiltered({
    symbol,
    symbolQuote,
    exchange,
    types,
  }: {
    symbol: string;
    symbolQuote: string;
    exchange: string;
    types: string[];
  }) {
    const ws = new WebSocket(this.wsBaseUrl);

    ws.on("open", () => {
      const loginQuery =
        `key=${this.wsKey}` +
        `&role=client` +
        `&type=${types.join(",")}` +
        `&symbol=${symbol}` +
        `&symbol_quote=${symbolQuote}` +
        `&exchange=${exchange}`;
      ws.send(loginQuery);
      //this.logger.log(
      //  `🌐 Verbindung für ${symbol}/${symbolQuote} über ${exchange} über Typen ${types.join(", ")} aufgebaut`
      //);

      // 🏓 JSON-Ping regelmäßig senden
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const pingPayload = { op: "ping", ts: Date.now() };
          ws.send(JSON.stringify(pingPayload));
          //this.logger.log(`🏓 JSON-Ping gesendet: ${JSON.stringify(pingPayload)}`);
        }
      }, 30_000);

      // 🔒 Stoppe Ping, wenn Verbindung geschlossen wird
      ws.on("close", () => {
        clearInterval(pingInterval);
      });
    });
    ws.on("message", (data: string | Buffer) => this.handleWsMessage(data, ws));
    const context = `${symbol}/${symbolQuote} @ ${exchange}`;
    ws.on("error", err => this.logger.error(`WebSocket error [${context}]:`, err));
    ws.on("close", () => {
      this.logger.warn(`Verbindung für ${context} geschlossen – Reconnect in 5s`);
      setTimeout(() => this.connectFiltered({ symbol, symbolQuote, exchange, types }), 5000);
    });
  }

  private handleWsMessage(data: string | Buffer, ws?: WebSocket): void {
    try {
      const raw = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf-8") : "";
      const parsed = JSON.parse(raw);
      const now = Date.now();

      if (parsed.op === "ping") {
        const ts = parsed.ts ?? now;
        const pong = JSON.stringify({ op: "pong", ts });
        if (ws) ws.send(pong);
        return;
      }

      const symbol = parsed.symbol?.toLowerCase();
      const exchange = (parsed.exchange || "default").toLowerCase();
      if (!symbol || !exchange) return;

      if (parsed.type === "trade" && parsed.price && parsed.amount) {
        const trade: TradeInfo = {
          price: parseFloat(parsed.price),
          amount: parseFloat(parsed.amount),
          timestamp: parsed.timestamp || now,
          side: parsed.side || "buy",
          exchange,
        };

        if (!this.tradeMap.has(symbol)) this.tradeMap.set(symbol, new Map());
        const exchMap = this.tradeMap.get(symbol)!;
        const trades = exchMap.get(exchange) || [];
        trades.push(trade);
        const filtered = trades.filter(t => now - t.timestamp < 5 * 60_000).slice(-1000);
        exchMap.set(exchange, filtered);
      }

      if (parsed.type === "ticker" && parsed.last) {
        const ticker: TickerInfo = {
          last: parseFloat(parsed.last),
          bid: parseFloat(parsed.bid),
          ask: parseFloat(parsed.ask),
          vol_24h: parseFloat(parsed.vol_24h),
          timestamp: parsed.timestamp || now,
          exchange,
        };

        if (!this.tickerMap.has(symbol)) this.tickerMap.set(symbol, new Map());
        this.tickerMap.get(symbol)!.set(exchange, ticker);
      }

      if (parsed.type === "book" && parsed.timestamp) {
        const asks = parsed.asks || [];
        const bids = parsed.bids || [];

        const toOrderLevels = (entries: never[]): OrderLevel[] =>
          entries.map((e: never) => ({
            price: e[0],
            amount: e[1],
          }));

        const book: OrderBook = {
          asks: toOrderLevels(asks),
          bids: toOrderLevels(bids),
          timestamp: parsed.timestamp,
          exchange,
        };

        if (!this.orderBookMap.has(symbol)) this.orderBookMap.set(symbol, new Map());
        this.orderBookMap.get(symbol)!.set(exchange, book);
      }
    } catch (err) {
      this.logger.error("WebSocket parse error", err);
    }
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    this.logger.debug(`[getValue] Feed angefragt: ${feed.name}`);
    const value = await this.getSafeFeedPrice(feed);
    return { feed, value };
  }

  async getValues(feeds: FeedId[], votingRoundId?: number): Promise<FeedValueData[]> {
    try {
      if (votingRoundId !== undefined) {
        this.debug(`🆔 getValues Setze VotingRoundId auf ${votingRoundId}`);
        this.currentVotingRoundId = votingRoundId;
      }

      const onchainPrices = await fetchOnchainPrices(this.getFlareRPC(), this.fallbackPath, this.logger);
      this.onchainPriceMap.clear();
      for (const [symbol, entry] of Object.entries(onchainPrices)) {
        this.onchainPriceMap.set(symbol, entry);
      }
    } catch (e) {
      this.logger.error(`❌ Fehler beim Abrufen der Onchain-Preise: ${(e as Error).message}`);
    }

    const results: FeedValueData[] = [];

    for (const feed of feeds) {
      try {
        const value = await this.getValue(feed);
        results.push(value);
      } catch (err) {
        this.logger.warn(`⚠️ Fehler bei getValue(${feed.name}) – Rückgabe Onchain-Preis oder Fallback 0.01`);

        // Versuche Onchain-Preis zu verwenden
        const onchain = this.onchainPriceMap.get(feed.name.toUpperCase());
        const fallbackValue = onchain?.value ?? 0.01;

        results.push({ feed, value: fallbackValue });
      }
    }

    return results;
  }

  async getVolumes(): Promise<FeedVolumeData[]> {
    const result: FeedVolumeData[] = [];

    this.tradeMap.forEach((exchangeMap, symbol) => {
      const volumes: Volume[] = [];

      exchangeMap.forEach((trades, exchange) => {
        const totalVolume = trades.reduce((sum, t) => sum + t.amount, 0);
        volumes.push({ exchange, volume: totalVolume });
      });

      result.push({
        feed: { name: symbol, category: 0 },
        volumes,
      });
    });

    return result;
  }

  private async getSafeFeedPrice(feedId: FeedId): Promise<number> {
    const now = Date.now();
    const normalized = normalizeSymbol(feedId.name);
    const key = `${feedId.category}-${normalized}`;
    const dbDecimals = (await getFeedDecimals(feedId.name)) ?? 8;
    const dbOnchainDecimals = (await getFeedOnchainDecimals(feedId.name)) ?? dbDecimals;
    const onchain = this.onchainPriceMap.get(feedId.name);
    const onchainPrice = onchain?.value ? onchain.value / 10 ** (onchain.decimals ?? dbOnchainDecimals) : 0;

    const result = await applyPriceStrategy(feedId, onchainPrice, dbDecimals, dbOnchainDecimals, {
      tradeMap: this.tradeMap,
      tickerMap: this.tickerMap,
      orderBookMap: this.orderBookMap,
      fallbackMap: this.lastValidFeedPrice,
      logger: this.logger,
    });

    // Validierung: Pflichtfelder vorhanden
    if (
      !result ||
      typeof result.value !== "number" ||
      typeof result.ccxt !== "number" ||
      typeof result.onchain !== "number"
    ) {
      this.logger.warn(`[getSafeFeedPrice] Ungültiger StrategyResult für ${normalized} – Rückgabe Fallback`);
      return this.getFallbackPrice(key, normalized, now);
    }

    if (result.value <= 0 || isNaN(result.value)) {
      this.logger.warn(`[getSafeFeedPrice] Ergebnis <= 0 für ${normalized} – Rückgabe Fallback`);
      return this.getFallbackPrice(key, normalized, now);
    }

    // Speicherung
    if (this.currentVotingRoundId && this.shouldStorePrices()) {
      const submittedScaled = Math.round(result.value * 10 ** dbDecimals);
      const ccxtScaled = Math.round(result.ccxt * 10 ** dbDecimals);
      const onchainScaled = Math.round(result.onchain * 10 ** dbOnchainDecimals);

      await storeSubmittedPriceExtended(
        feedId.name,
        this.currentVotingRoundId,
        submittedScaled,
        ccxtScaled,
        onchainScaled,
        result.meta,
        result.strategyName
      );
    }

    this.lastValidFeedPrice.set(key, { value: result.value, time: now });
    return result.value;
  }

  private debug(...args: unknown[]) {
    if (!this.debugMode) return;

    const message = args
      .map(arg => {
        if (Array.isArray(arg)) {
          return `[${arg.map(String).join(", ")}]`;
        } else if (typeof arg === "object" && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return "[Unserializable object]";
          }
        } else {
          return String(arg);
        }
      })
      .join(" ");

    this.logger.debug(message);
  }

  private startCleanupLoop() {
    const maxAge = 5 * 60_000; // 10 Minuten

    setInterval(() => {
      this.cleanupTradeMap(maxAge);
      this.cleanupGenericMap(this.tickerMap, maxAge);
      this.cleanupGenericMap(this.orderBookMap, maxAge);

      this.debug(`🧹 Cleanup durchgeführt`);

      const tradeStats = new Map<string, { symbols: number; trades: number }>();
      for (const exchMap of this.tradeMap.values()) {
        for (const [exch, trades] of exchMap.entries()) {
          const prev = tradeStats.get(exch) || { symbols: 0, trades: 0 };
          prev.symbols += 1;
          prev.trades += trades.length;
          tradeStats.set(exch, prev);
        }
      }

      const tickerStats = new Map<string, number>();
      for (const exchMap of this.tickerMap.values()) {
        for (const exch of exchMap.keys()) {
          tickerStats.set(exch, (tickerStats.get(exch) || 0) + 1);
        }
      }

      const bookStats = new Map<string, number>();
      for (const exchMap of this.orderBookMap.values()) {
        for (const exch of exchMap.keys()) {
          bookStats.set(exch, (bookStats.get(exch) || 0) + 1);
        }
      }

      this.logger.log(`📊 TradeMap nach Cleanup:`);
      tradeStats.forEach((info, exch) => {
        this.logger.log(`  • ${exch}: ${info.trades} Trades in ${info.symbols} Coins`);
      });

      this.logger.log(`📈 TickerMap nach Cleanup:`);
      tickerStats.forEach((count, exch) => {
        this.logger.log(`  • ${exch}: ${count} Ticker-Einträge`);
      });

      this.logger.log(`📚 OrderBookMap nach Cleanup:`);
      bookStats.forEach((count, exch) => {
        this.logger.log(`  • ${exch}: ${count} OrderBooks`);
      });
    }, 60_000);
  }

  private cleanupTradeMap(maxAge: number): void {
    const now = Date.now();

    for (const [symbol, exchMap] of this.tradeMap.entries()) {
      for (const [exch, trades] of exchMap.entries()) {
        const fresh = trades.filter(t => now - t.timestamp < maxAge);
        if (fresh.length > 0) {
          exchMap.set(exch, fresh);
        } else {
          exchMap.delete(exch);
        }
      }
      if (exchMap.size === 0) {
        this.tradeMap.delete(symbol);
      }
    }
  }

  private cleanupGenericMap<T extends { timestamp: number }>(map: Map<string, Map<string, T>>, maxAge: number): void {
    const now = Date.now();
    for (const [symbol, exchangeMap] of map.entries()) {
      for (const [exchange, entry] of exchangeMap.entries()) {
        if (now - entry.timestamp > maxAge) {
          exchangeMap.delete(exchange);
        }
      }
      if (exchangeMap.size === 0) {
        map.delete(symbol);
      }
    }
  }

  private shouldStorePrices(): boolean {
    return process.env.ENABLE_PRICE_STORAGE?.toLowerCase() === "true";
  }

  private getFlareRPC(): string {
    const rpc = process.env.FLARE_RPC;
    if (!rpc) throw new Error("FLARE_RPC ist nicht gesetzt!");
    return rpc;
  }

  private getFallbackPrice(key: string, normalized: string, now: number): number {
    const fallback = this.lastValidFeedPrice.get(key);
    if (fallback && now - fallback.time < 5 * 60_000) {
      this.logger.warn(`[getSafeFeedPrice] Fallback-Preis für ${normalized}: ${fallback.value}`);
      return fallback.value;
    }
    this.logger.warn(`[getSafeFeedPrice] Kein gültiger Preis für ${normalized}, Rückgabe 0.01`);
    return 0.01;
  }
}
