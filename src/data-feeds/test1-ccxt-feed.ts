import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";

export class Test1CcxtFeed extends CcxtFeed implements BaseDataFeed {
  constructor() {
    super(); // nutzt dieselbe Konfiguration wie CcxtFeed
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed);

    // Trend basierend auf Exchange-Preisen berechnen
    const rawPrices = this.getLatestExchangePrices(feed);
    const trend = this.detectTrend(rawPrices);
    const offset = this.calculateDynamicOffset(rawPrices);
    const adjusted = result.value + offset;

    this.logger.debug(`Test1: Feed=${feed.name}, Offset=${offset.toExponential(2)}, Final=${adjusted}`);
    this.logger.debug(
      `Test1: Feed=${feed.name}, Trend=${trend}, ExchangePrices=[${rawPrices.map(p => p.toFixed(5)).join(", ")}], ` +
        `Original=${result.value.toPrecision(15)}, Final=${adjusted.toPrecision(15)}`
    );

    return {
      feed,
      value: adjusted,
    };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  private calculateDynamicOffset(prices: number[]): number {
    if (prices.length < 5) return 0;

    // Nur die letzten 20 Werte betrachten für Reaktivität
    const recent = prices.slice(-20);

    const diffs = recent.slice(1).map((v, i) => v - recent[i]);
    const avgDelta = diffs.reduce((a, b) => a + b, 0) / diffs.length;

    // Standardabweichung zur Normierung
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / recent.length;
    const stddev = Math.sqrt(variance);

    // Normalisierter Trend: in Prozent der Standardabweichung
    const normalized = stddev > 0 ? avgDelta / stddev : 0;

    // Begrenzter Anpassungswert
    const maxAdjust = 0.001; // maximal 0.001

    return Math.max(-maxAdjust, Math.min(maxAdjust, normalized * 0.0005));
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private getLatestExchangePrices(feed: FeedId): number[] {
    const config = this.config.find(c => c.feed.name === feed.name && c.feed.category === feed.category);
    if (!config) return [];

    const prices: number[] = [];

    for (const source of config.sources) {
      const info = this.latestPrice.get(source.symbol)?.get(source.exchange);
      if (info && info.value > 0) {
        prices.push(info.value);
      }
    }

    return prices;
  }

  private detectTrend(prices: number[]): "up" | "down" | "flat" {
    if (prices.length < 3) return "flat";

    const deltas = prices.slice(1).map((p, i) => p - prices[i]);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;

    if (avg > 0.0001) return "up";
    if (avg < -0.0001) return "down";
    return "flat";
  }
}
