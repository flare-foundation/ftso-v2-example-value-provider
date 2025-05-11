import { SmartCcxtFeed, loadSmartFeedConfigFromEnv } from "./smart-ccxt-feed";
import { FeedId } from "../src/dto/provider-requests.dto";
import { Logger } from "@nestjs/common";

function mockPriceInfo(value: number, exchange: string, time: number = Date.now()) {
  return { value, exchange, time };
}

jest.mock("../src/data-feeds/ccxt-provider-service", () => {
  return {
    CcxtFeed: class {
      public logger: Partial<Logger> = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      public latestPrice = new Map();
      public volumes = new Map();
      public config = [];
      async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
        const symbolMap = this.latestPrice.get(feedId.name);
        if (!symbolMap) return undefined;

        for (const [_, info] of symbolMap.entries()) {
          if (info.value !== undefined) {
            return info.value;
          }
        }

        return undefined;
      }
    },
  };
});

describe("SmartCcxtFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_OUTLIER_FILTER = "true";
    process.env.ENABLE_VOLUME_WEIGHTING = "true";
    process.env.OUTLIER_THRESHOLD_PERCENT = "0.5";
    process.env.VOLUME_LOOKBACK_SECONDS = "3600";
  });

  it("should initialize with default env values", () => {
    const feed = new SmartCcxtFeed(loadSmartFeedConfigFromEnv());

    expect(feed["enableOutlierFilter"]).toBe(true);
    expect(feed["enableVolumeWeighting"]).toBe(true);
    expect(feed["outlierThresholdPercent"]).toBe(0.5);
    expect(feed["volumeLookbackSeconds"]).toBe(3600);
  });

  it("should fallback to simple average if volume weighting is disabled", async () => {
    const feed = new SmartCcxtFeed({
      enableVolumeWeighting: false,
      enableOutlierFilter: false,
    });

    const symbol = "BTC/USD";

    (feed as any).volumes.set(symbol, new Map());
    const prices = [
      { value: 10000, exchange: "binance" },
      { value: 10200, exchange: "coinbase" },
    ];

    const avg = (feed as any).weightedAverage(prices, symbol);
    expect(avg).toBe(10100);
  });

  it("should apply outlier filtering when enabled", async () => {
    const feed = new SmartCcxtFeed({
      enableOutlierFilter: true,
      enableVolumeWeighting: false,
      outlierThresholdPercent: 1, // allow small deviation
    });

    const feedId: FeedId = { category: 1, name: "BTC/USD" };

    // Simuliere frische Preise
    feed["latestPrice"].set(
      "BTC/USD",
      new Map([
        ["binance", mockPriceInfo(10000, "binance")],
        ["coinbase", mockPriceInfo(13000, "coinbase")],
        ["kraken", mockPriceInfo(10100, "kraken")],
      ])
    );

    feed["config"] = [
      {
        feed: { category: 1, name: "BTC/USD" },
        sources: [
          { symbol: "BTC/USD", exchange: "binance" },
          { symbol: "BTC/USD", exchange: "coinbase" },
          { symbol: "BTC/USD", exchange: "kraken" },
        ],
      },
    ];

    const price = await (feed as any).getFeedPrice(feedId);
    expect(price).toBeGreaterThan(10000);
    expect(price).toBeLessThan(10200);
  });

  it("should not apply outlier filtering when disabled", async () => {
    const feed = new SmartCcxtFeed({
      enableOutlierFilter: false,
      enableVolumeWeighting: false,
    });

    const feedId: FeedId = { category: 1, name: "BTC/USD" };

    feed["latestPrice"].set(
      "BTC/USD",
      new Map([
        ["binance", mockPriceInfo(10000, "binance")],
        ["coinbase", mockPriceInfo(13000, "coinbase")],
        ["kraken", mockPriceInfo(10100, "kraken")],
      ])
    );

    feed["config"] = [
      {
        feed: { category: 1, name: "BTC/USD" },
        sources: [
          { symbol: "BTC/USD", exchange: "binance" },
          { symbol: "BTC/USD", exchange: "coinbase" },
          { symbol: "BTC/USD", exchange: "kraken" },
        ],
      },
    ];

    const price = await (feed as any).getFeedPrice(feedId);
    const expected = (10000 + 13000 + 10100) / 3;
    expect(price).toBeCloseTo(expected, 5);
  });

  it("should return undefined if no fresh prices", async () => {
    const feed = new SmartCcxtFeed();
    const feedId: FeedId = { category: 1, name: "BTC/USD" };

    feed["config"] = [
      {
        feed: { category: 1, name: "BTC/USD" },
        sources: [{ symbol: "BTC/USD", exchange: "binance" }],
      },
    ];

    const price = await (feed as any).getFeedPrice(feedId);
    expect(price).toBeUndefined();
  });

  it("should skip prices older than MAX_PRICE_AGE_MS", async () => {
    const feed = new SmartCcxtFeed({
      enableOutlierFilter: false,
      enableVolumeWeighting: false,
    });

    const feedId: FeedId = { category: 1, name: "BTC/USD" };
    const oldTimestamp = Date.now() - 31_000; // älter als 30 Sekunden

    feed["latestPrice"].set("BTC/USD", new Map([["binance", mockPriceInfo(10000, "binance", oldTimestamp)]]));

    feed["config"] = [
      {
        feed: feedId,
        sources: [{ symbol: "BTC/USD", exchange: "binance" }],
      },
    ];

    const price = await (feed as any).getFeedPrice(feedId);
    expect(price).toBeUndefined();
  });

  it("should convert USDT price to USD using USDT/USD feed", async () => {
    const feed = new SmartCcxtFeed({
      enableOutlierFilter: false,
      enableVolumeWeighting: false,
    });

    const now = Date.now();

    // Preise in latestPrice simulieren
    feed["latestPrice"].set(
      "BTC/USDT",
      new Map([["binance", mockPriceInfo(10000, "binance", now)]])
    );

    feed["latestPrice"].set(
      "USDT/USD",
      new Map([["binance", mockPriceInfo(1.01, "binance", now)]])
    );

    // Feed-Konfiguration setzen
    feed["config"] = [
      {
        feed: { category: 1, name: "BTC/USD" },
        sources: [{ symbol: "BTC/USDT", exchange: "binance" }],
      },
      {
        feed: { category: 1, name: "USDT/USD" },
        sources: [{ symbol: "USDT/USD", exchange: "binance" }],
      },
    ];

    const price = await (feed as any).getFeedPrice({ category: 1, name: "BTC/USD" });
    expect(price).toBeCloseTo(10100, 2);
  });


  it("should calculate volume-weighted average when enabled", async () => {
    const feed = new SmartCcxtFeed({
      enableOutlierFilter: false,
      enableVolumeWeighting: true,
    });

    const now = Date.now();

    feed["latestPrice"].set(
      "BTC/USD",
      new Map([
        ["binance", mockPriceInfo(10000, "binance", now)],
        ["coinbase", mockPriceInfo(11000, "coinbase", now)],
      ])
    );

    const binanceVol = { getVolume: () => 100 };
    const coinbaseVol = { getVolume: () => 300 };

    const volumeMap = new Map();
    volumeMap.set("binance", binanceVol);
    volumeMap.set("coinbase", coinbaseVol);

    feed["volumes"].set("BTC/USD", volumeMap);

    feed["config"] = [
      {
        feed: { category: 1, name: "BTC/USD" },
        sources: [
          { symbol: "BTC/USD", exchange: "binance" },
          { symbol: "BTC/USD", exchange: "coinbase" },
        ],
      },
    ];

    const price = await (feed as any).getFeedPrice({ category: 1, name: "BTC/USD" });
    const expected = (10000 * 100 + 11000 * 300) / 400;
    expect(price).toBeCloseTo(expected, 2);
  });
});
