import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";

export class Test2CcxtFeed extends CcxtFeed implements BaseDataFeed {
  constructor() {
    super();
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed);
    const adjustedValue = this.adjustPrice(result.value, feed);

    this.logger.debug(`🔧 Feed ${feed.name}: Original=${result.value}, Adjusted=${adjustedValue}`);

    return {
      feed,
      value: adjustedValue,
    };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  /**
   * Adaptive Preis-Anpassung:
   * - Trend (steigend = leicht höherer Preis)
   * - Volumen (hohes Volumen = leicht aggressiver)
   * - Zufall zur Streuung
   */
  private adjustPrice(original: number, feed: FeedId): number {
    const trend = this.estimateTrend(feed.name);
    const volumeBias = this.getVolumeBias(feed.name);
    const noise = (Math.random() - 0.5) * 0.00005; // ±0.0025%

    const combinedBias = 1 + trend * 0.5 + volumeBias + noise;

    const adjusted = original * combinedBias;

    this.logger.debug(
      `📊 Anpassung für ${feed.name}: trend=${trend.toFixed(5)}, volumeBias=${volumeBias.toFixed(
        5
      )}, noise=${noise.toFixed(5)}, bias=${(combinedBias - 1).toFixed(5)}`
    );

    return adjusted;
  }

  /**
   * Trendbasierte Anpassung (Veränderung über Zeit)
   */
  private estimateTrend(symbol: string): number {
    const prices = this.latestPrice.get(symbol);
    if (!prices) return 0;

    const sorted = Array.from(prices.values())
      .map(p => ({ time: p.time, value: p.value }))
      .sort((a, b) => a.time - b.time);

    if (sorted.length < 2) return 0;

    const oldest = sorted[0];
    const latest = sorted.at(-1)!;
    const change = (latest.value - oldest.value) / oldest.value;

    return change; // z.B. 0.001 = +0.1 %
  }

  /**
   * Volumenabhängige Bias-Anpassung
   */
  private getVolumeBias(symbol: string): number {
    const exchangeVolumes = this.volumes.get(symbol);
    if (!exchangeVolumes) return 0;

    let totalVolume = 0;
    for (const vol of exchangeVolumes.values()) {
      totalVolume += vol.getVolume(60); // letzte 60 Sekunden
    }

    // Volumen-Schwellenwert für aggressiveres Verhalten
    if (totalVolume > 50000) return -0.00003; // bei hohem Volumen minimal tiefer anbieten

    return 0;
  }
}