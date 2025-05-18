import WebSocket from 'ws';
import { FeedId, FeedValueData, FeedVolumeData, Volume } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { Logger } from "@nestjs/common";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Neu: TickerInfo für jede Börse
interface TickerInfo {
  last: number;
  bid: number;
  ask: number;
  timestamp: number;
  exchange: string;
}

type TradeInfo = {
  price: number;
  amount: number;
  timestamp: number;
  side: "buy" | "sell";
  exchange: string;
};

interface OrderLevel {
  price: number;
  amount: number;
}

interface OrderBook {
  asks: OrderLevel[];
  bids: OrderLevel[];
  timestamp: number;
  exchange: string;
}

type TradeMap = Map<string, Map<string, TradeInfo[]>>;
type TickerMap = Map<string, Map<string, TickerInfo>>;
type OrderBookMap = Map<string, Map<string, OrderBook>>;

export class CustomWsFeed implements BaseDataFeed {
  private readonly logger = new Logger(CustomWsFeed.name);
  private readonly wsBaseUrl = "ws://10.10.1.206:8765/client";
  private readonly wsKey = "CLIENT_KEY_1";

  private readonly tradeMap: TradeMap = new Map();
  private readonly tickerMap: TickerMap = new Map(); // Neu
  private readonly orderBookMap: OrderBookMap = new Map();
  private readonly lastValidFeedPrice: Map<string, { value: number; time: number }> = new Map();

  private readonly fallbackPath = join(process.cwd(), "src/config/fallback-prices.json");
  private readonly debugMode = process.env.DEBUG_WS_FEED === "true";

  constructor() {
    this.logger.log("Connecting to custom WebSocket feed...");
    this.loadFallbackPrices();
    this.connect("trade");
    this.connect("ticker");
    this.connect("book");
    this.startCleanupLoop();
  }

  private exportFallbackPrices(): void {
    const fallback: Record<string, number> = {};
    for (const [key, data] of this.lastValidFeedPrice.entries()) {
      if (data.value > 0) fallback[key] = data.value;
    }
    try {
      writeFileSync(this.fallbackPath, JSON.stringify(fallback, null, 2));
      this.logger.log(`📦 Fallback-Preise gespeichert unter ${this.fallbackPath}`);
    } catch (e) {
      this.logger.error(`❌ Fehler beim Schreiben von fallback-prices.json:`, e);
    }
  }

  private loadFallbackPrices(): void {
    try {
      const raw = readFileSync(this.fallbackPath, "utf-8");
      const fallback: Record<string, number> = JSON.parse(raw);
      const now = Date.now();
      for (const [key, value] of Object.entries(fallback)) {
        this.lastValidFeedPrice.set(key, { value, time: now });
      }
      this.logger.log(`✅ Fallback-Preise geladen (${Object.keys(fallback).length})`);
    } catch (e) {
      this.logger.warn(`⚠️ fallback-prices.json konnte nicht geladen werden: ${e}`);
    }
  }

  private connect(type: "trade" | "ticker" | "book") {
    const ws = new WebSocket(`${this.wsBaseUrl}?key=${this.wsKey}&type=${type}`);

    ws.on("open", () => {
      this.logger.log(`Connected to feed type: ${type}`);
    });

    ws.on("message", (data: string) => {
      try {
        const parsed = JSON.parse(data);
        const now = Date.now();

        if (parsed.type === "trade" && parsed.symbol && parsed.price && parsed.amount) {
          const symbol = parsed.symbol.toLowerCase();
          const exchange = (parsed.exchange || "default").toLowerCase();

          const trade: TradeInfo = {
            price: parseFloat(parsed.price),
            amount: parseFloat(parsed.amount),
            timestamp: parsed.timestamp || now,
            side: parsed.side || "buy",
            exchange
          };

          if (!this.tradeMap.has(symbol)) this.tradeMap.set(symbol, new Map());
          const exchangeMap = this.tradeMap.get(symbol)!;
          const trades = exchangeMap.get(exchange) || [];

          trades.push(trade);

          // Filter nach maxAge und maxLength
          const maxAge = 5 * 60_000;
          const maxLength = 1000;
          const filtered = trades.filter(t => now - t.timestamp < maxAge);
          const trimmed = filtered.slice(-maxLength);

          exchangeMap.set(exchange, trimmed);
        }

        if (parsed.type === "ticker" && parsed.symbol && parsed.bid && parsed.ask && parsed.last) {
          const symbol = parsed.symbol.toLowerCase();
          const exchange = (parsed.exchange || "default").toLowerCase();

          const ticker: TickerInfo = {
            last: parseFloat(parsed.last),
            bid: parseFloat(parsed.bid),
            ask: parseFloat(parsed.ask),
            timestamp: parsed.timestamp || now,
            exchange,
          };

          if (!this.tickerMap.has(symbol)) this.tickerMap.set(symbol, new Map());
          const symbolMap = this.tickerMap.get(symbol)!;
          symbolMap.set(exchange, ticker);
        }

        if (parsed.type === "book" && parsed.symbol && parsed.timestamp) {
          const symbol = parsed.symbol.toLowerCase();
          const exchange = (parsed.exchange || "default").toLowerCase();

          const normalize = (entries: any[]): OrderLevel[] => {
            return entries.map((entry: any) => ({
              price: parseFloat(entry[0] ?? entry.price),
              amount: parseFloat(entry[1] ?? entry.qty)
            }));
          };

          const orderBook: OrderBook = {
            asks: normalize(parsed.asks || []),
            bids: normalize(parsed.bids || []),
            timestamp: parsed.timestamp,
            exchange,
          };

          if (!this.orderBookMap.has(symbol)) this.orderBookMap.set(symbol, new Map());
          const symbolMap = this.orderBookMap.get(symbol)!;
          symbolMap.set(exchange, orderBook);
        }

      } catch (err) {
        this.logger.error("WebSocket parse error", err);
      }
    });

    ws.on("close", () => {
      this.logger.warn(`WebSocket for type ${type} closed, reconnecting in 5s`);
      setTimeout(() => this.connect(type), 5000);  // <- fix hier
    });

    ws.on("error", (err) => {
      this.logger.error(`WebSocket error [${type}]:`, err);
    });
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    this.logger.debug(`[getValue] Feed angefragt: ${feed.name}`);
    this.logTradeMapStatus(feed.name.toLowerCase());
    this.logTickerMapStatus(feed.name.toLowerCase());
    this.logOrderBookStatus(feed.name.toLowerCase());
    if (process.env.DEBUG_FULL === 'true') {
      this.logFullTradeMap(feed.name.toLowerCase());
      this.logFullTickerMap(feed.name.toLowerCase());
      this.logFullOrderBookMap(feed.name.toLowerCase());
    }

    const value = await this.getSafeFeedPrice(feed);
    this.logger.debug(`[getValue] Rückgabe für ${feed.name}: ${value}`);
    return { feed, value };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return Promise.all(feeds.map(feed => this.getValue(feed)));
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
    const key = `${feedId.category}-${feedId.name}`;
    const symbol = feedId.name.toLowerCase();
    const price = this.getUsdConvertedPrice(symbol);

    if (price && price > 0) {
      this.lastValidFeedPrice.set(key, { value: price, time: now });
      this.exportFallbackPrices();
      return price;
    }

    const fallback = this.lastValidFeedPrice.get(key);
    if (fallback && now - fallback.time < 5 * 60_000) {
      this.logger.warn(`[getSafeFeedPrice] Fallback-Preis für ${symbol}: ${fallback.value}`);
      return fallback.value;
    }

    this.logger.warn(`[getSafeFeedPrice] Kein Preis für ${symbol}, Rückgabe 0.01`);
    return 0.01;
  }

  private getUsdConvertedPrice(symbol: string): number | undefined {
    const symbolLower = symbol.toLowerCase();
    const usdPrices = this.getAllUsdPrices(symbolLower);

    if (usdPrices.length === 0) {
      this.debug(`Keine gültigen USD-Preise für ${symbolLower}`);
      return undefined;
    }

    usdPrices.sort((a, b) => a - b);
    const median = usdPrices[Math.floor(usdPrices.length / 2)];

    this.debug(`✅ Finaler USD-Preis für ${symbolLower}: ${median}`);
    return median;
  }

  private getAllUsdPrices(symbol: string): number[] {
    const now = Date.now();
    const result: number[] = [];

    const directSymbol = symbol.toLowerCase();
    const usdtSymbol = directSymbol.replace("/usd", "/usdt");

    const directMap = this.tradeMap.get(directSymbol);
    const usdtMap = this.tradeMap.get(usdtSymbol);
    const usdtUsdMap = this.tradeMap.get("usdt/usd");

    const getRecentTrades = (map?: Map<string, TradeInfo[]>) =>
      [...(map?.entries() ?? [])]
        .flatMap(([exchange, trades]) => trades.map(t => ({ ...t, exchange })))
        .filter(t => now - t.timestamp < 5 * 60_000);

    const directTrades = getRecentTrades(directMap);
    const usdtTrades = getRecentTrades(usdtMap);
    const usdtToUsdTrades = getRecentTrades(usdtUsdMap);

    const usdtToUsdPrice = this.getWeightedMedianPrice("usdt/usd");
    if (this.debugMode) {
      this.debug("🧱 Trades für Preisermittlung:");
      this.debug(`→ ${directSymbol}:`, directTrades.length);
      this.debug(`→ ${usdtSymbol}:`, usdtTrades.length);
      this.debug(`→ usdt/usd:`, usdtToUsdTrades.length);
    }

    for (const t of directTrades) result.push(t.price);
    if (usdtToUsdPrice) {
      for (const t of usdtTrades) result.push(t.price * usdtToUsdPrice);
    }

    return result;
  }

  private getTradeWeight(t: TradeInfo): number {
    return t.amount * (t.side === "sell" ? 0.9 : 1.0);
  }

  private getWeightedMedianPrice(symbol: string): number | undefined {
    const exchangeMap = this.tradeMap.get(symbol);
    if (!exchangeMap) {
      this.debug(`Kein exchangeMap für ${symbol}`);
      return undefined;
    }

    const now = Date.now();
    const trades: TradeInfo[] = [...exchangeMap.values()].flat();
    const recentTrades = trades.filter(t => now - t.timestamp < 5 * 60_000);

    if (recentTrades.length === 0) {
      this.debug(`Keine gültigen Trades für ${symbol}`);
      return undefined;
    }

    recentTrades.sort((a, b) => a.price - b.price);
    const totalWeight = recentTrades.reduce((sum, t) => sum + this.getTradeWeight(t), 0);
    let cumulative = 0;

    this.debug(`Berechne gewichteten Median für ${symbol}`);
    this.debug(`Trades (amount/price/side):`, recentTrades.map(t => `${t.amount}/${t.price}/${t.side}`));

    for (const trade of recentTrades) {
      cumulative += this.getTradeWeight(trade);
      if (cumulative >= totalWeight / 2) {
        this.debug(`Gewichteter Medianpreis: ${trade.price}`);
        return trade.price;
      }
    }
    this.debug(`📈 ${symbol}: ${recentTrades.length} Trades (Buy/Sell: ${recentTrades.filter(t => t.side === 'buy').length}/${recentTrades.filter(t => t.side === 'sell').length})`);

    return recentTrades[recentTrades.length - 1].price;
  }

  private logTickerMapStatus(symbol: string) {
    if (!this.debugMode) return;

    const map = this.tickerMap.get(symbol);
    if (!map) {
      this.debug(`⚠️ Kein Ticker-Eintrag für ${symbol}`);
      return;
    }

    const now = Date.now();
    const entries = [...map.entries()].map(([exchange, ticker]) => {
      const age = ((now - ticker.timestamp) / 1000).toFixed(1);
      return `${exchange}: bid=${ticker.bid}, ask=${ticker.ask}, last=${ticker.last}, ⏱ ${age}s alt`;
    });

    this.debug(`📈 ${symbol} (${map.size} Börsen): ${entries.join(" | ")}`);
  }

  private logTradeMapStatus(symbol: string) {
    if (!this.debugMode) return;

    const map = this.tradeMap.get(symbol);
    if (!map) {
      this.debug(`⚠️ Kein Daten-Eintrag für ${symbol}`);
      return;
    }

    const now = Date.now();
    const entries = [...map.entries()].map(([exchange, trades]) => {
      const last = trades.at(-1);
      const age = last ? ((now - last.timestamp) / 1000).toFixed(1) : "?";
      const buys = trades.filter(t => t.side === "buy").length;
      const sells = trades.filter(t => t.side === "sell").length;
      return `${exchange}: ${trades.length} Trades (🟢${buys}/🔴${sells}), ⏱ ${age}s alt`;
    });

    this.debug(`📊 ${symbol} (${map.size} Börsen): ${entries.join(" | ")}`);
  }

  private logFullTradeMap(symbol: string) {
    if (!this.debugMode) return;

    const map = this.tradeMap.get(symbol);
    if (!map) {
      this.debug(`❌ [Trades] Kein Eintrag für Symbol ${symbol}`);
      return;
    }

    for (const [exchange, trades] of map.entries()) {
      this.debug(`📥 [Trades][${symbol}][${exchange}] ${trades.length} Trades:`);
      for (const t of trades) {
        this.debug(`  ↪ ${t.timestamp} | ${t.side.toUpperCase()} | ${t.amount} @ ${t.price}`);
      }
    }
  }

  private logFullTickerMap(symbol: string) {
    if (!this.debugMode) return;

    const map = this.tickerMap.get(symbol);
    if (!map) {
      this.debug(`❌ [Ticker] Kein Eintrag für Symbol ${symbol}`);
      return;
    }

    for (const [exchange, ticker] of map.entries()) {
      const age = ((Date.now() - ticker.timestamp) / 1000).toFixed(1);
      this.debug(
        `📈 [Ticker][${symbol}][${exchange}] ⏱ ${age}s alt | Bid: ${ticker.bid} | Ask: ${ticker.ask} | Last: ${ticker.last}`
      );
    }
  }

  private debug(...args: any[]) {
    if (!this.debugMode) return;

    const message = args.map(arg => {
      if (Array.isArray(arg)) return `[${arg.join(", ")}]`;
      if (typeof arg === "object") return JSON.stringify(arg);
      return String(arg);
    }).join(" ");

    this.logger.debug(message);
  }

  private startCleanupLoop() {
    setInterval(() => {
      const now = Date.now();
      const maxAge = 5 * 60_000;

      for (const [symbol, exchangeMap] of this.tradeMap.entries()) {
        for (const [exchange, trades] of exchangeMap.entries()) {
          const freshTrades = trades.filter(t => now - t.timestamp < maxAge);
          if (freshTrades.length > 0) {
            exchangeMap.set(exchange, freshTrades);
          } else {
            exchangeMap.delete(exchange);
          }
        }
        if (exchangeMap.size === 0) {
          this.tradeMap.delete(symbol);
        }
      }

      for (const [symbol, tickerByExchange] of this.tickerMap.entries()) {
        for (const [exchange, ticker] of tickerByExchange.entries()) {
          if (now - ticker.timestamp > maxAge) {
            tickerByExchange.delete(exchange);
          }
        }
        if (tickerByExchange.size === 0) {
          this.tickerMap.delete(symbol);
        }
      }

      for (const [symbol, bookByExchange] of this.orderBookMap.entries()) {
        for (const [exchange, book] of bookByExchange.entries()) {
          if (now - book.timestamp > maxAge) {
            bookByExchange.delete(exchange);
          }
        }
        if (bookByExchange.size === 0) {
          this.orderBookMap.delete(symbol);
        }
      }

      this.debug(`🧹 Cleanup durchgeführt`);
    }, 60_000);
  }

  private logOrderBookStatus(symbol: string) {
    if (!this.debugMode) return;

    const map = this.orderBookMap.get(symbol);
    if (!map) {
      this.debug(`⚠️ Kein Orderbook-Eintrag für ${symbol}`);
      return;
    }

    const now = Date.now();
    const entries = [...map.entries()].map(([exchange, book]) => {
      const age = ((now - book.timestamp) / 1000).toFixed(1);
      const topAsk = book.asks[0] ? `${book.asks[0].price} (${book.asks[0].amount})` : "–";
      const topBid = book.bids[0] ? `${book.bids[0].price} (${book.bids[0].amount})` : "–";
      return `${exchange}: 🟢 Bid ${topBid} | 🔴 Ask ${topAsk} | ⏱ ${age}s alt`;
    });

    this.debug(`📚 Orderbook ${symbol} (${map.size} Börsen): ${entries.join(" | ")}`);
  }

  private logFullOrderBookMap(symbol: string) {
    if (!this.debugMode) return;

    const map = this.orderBookMap.get(symbol);
    if (!map) {
      this.debug(`❌ [OrderBook] Kein Eintrag für Symbol ${symbol}`);
      return;
    }

    for (const [exchange, book] of map.entries()) {
      const age = ((Date.now() - book.timestamp) / 1000).toFixed(1);
      this.debug(`📘 [OrderBook][${symbol}][${exchange}] ⏱ ${age}s alt`);
      this.debug(`  🔼 Asks (${book.asks.length}):`, book.asks.slice(0, 5).map(a => `${a.price}@${a.amount}`));
      this.debug(`  🔽 Bids (${book.bids.length}):`, book.bids.slice(0, 5).map(b => `${b.price}@${b.amount}`));
    }
  }
}
