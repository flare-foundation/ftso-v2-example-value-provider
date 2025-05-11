import { FeedId } from "../src/dto/provider-requests.dto";
import { CcxtFeed } from "../src/data-feeds/ccxt-provider-service";
import { BaseDataFeed } from "../src/data-feeds/base-feed";

// type PriceInfo is reserved for future use (e.g., weighted median calculations)
// type PriceInfo = {
//   value: number;
//   time: number;
//   exchange: string;
// };

export interface SmartCcxtFeedConfig {
  enableOutlierFilter?: boolean;
  enableVolumeWeighting?: boolean;
  outlierThresholdPercent?: number;
  volumeLookbackSeconds?: number;
  enableMaxPriceAge?: boolean;
  maxPriceAgeMs?: number;
  enableWeightedMedian?: boolean;
  lambda?: number;
}

export function loadSmartFeedConfigFromEnv(): SmartCcxtFeedConfig {
  const enableOutlierFilter = process.env.ENABLE_OUTLIER_FILTER === "true";
  const enableVolumeWeighting = process.env.ENABLE_VOLUME_WEIGHTING === "true";
  const enableMaxPriceAge = process.env.ENABLE_MAX_PRICE_AGE !== "true";
  const maxPriceAgeMs = parseInt(process.env.MAX_PRICE_AGE_MS || "30000", 10);
  const enableWeightedMedian = process.env.ENABLE_WEIGHTED_MEDIAN === "true";
  const lambda = parseFloat(process.env.MEDIAN_DECAY || "0.00005");

  let outlierThresholdPercent = 0.5;
  if (process.env.OUTLIER_THRESHOLD_PERCENT) {
    const parsed = parseFloat(process.env.OUTLIER_THRESHOLD_PERCENT);
    if (!isNaN(parsed)) {
      outlierThresholdPercent = parsed;
    }
  }

  let volumeLookbackSeconds = 3600;
  if (process.env.VOLUME_LOOKBACK_SECONDS) {
    const parsed = parseInt(process.env.VOLUME_LOOKBACK_SECONDS, 10);
    if (!isNaN(parsed)) {
      volumeLookbackSeconds = parsed;
    }
  }

  return {
    enableOutlierFilter,
    enableVolumeWeighting,
    outlierThresholdPercent,
    volumeLookbackSeconds,
    enableMaxPriceAge,
    maxPriceAgeMs,
    enableWeightedMedian,
    lambda,
  };
}

export class SmartCcxtFeed extends CcxtFeed implements BaseDataFeed {
  private readonly enableOutlierFilter: boolean;
  private readonly enableVolumeWeighting: boolean;
  private readonly outlierThresholdPercent: number;
  private readonly volumeLookbackSeconds: number;
  private readonly enableMaxPriceAge: boolean;
  private readonly maxPriceAgeMs: number;
  private readonly enableWeightedMedian: boolean;
  private readonly lambda: number;

  constructor(configOverrides: SmartCcxtFeedConfig = loadSmartFeedConfigFromEnv()) {
    super();
    this.enableOutlierFilter = configOverrides.enableOutlierFilter ?? true;
    this.enableVolumeWeighting = configOverrides.enableVolumeWeighting ?? true;
    this.outlierThresholdPercent = configOverrides.outlierThresholdPercent ?? 0.5;
    this.volumeLookbackSeconds = configOverrides.volumeLookbackSeconds ?? 3600;
    this.enableMaxPriceAge = configOverrides.enableMaxPriceAge ?? true;
    this.maxPriceAgeMs = configOverrides.maxPriceAgeMs ?? 30000;
    this.enableWeightedMedian = configOverrides.enableWeightedMedian ?? false;
    this.lambda = configOverrides.lambda ?? 0.00005;

    this.logger.log(
      `SmartCcxtFeed initialized with config: ${JSON.stringify({
        enableOutlierFilter: this.enableOutlierFilter,
        enableVolumeWeighting: this.enableVolumeWeighting,
        outlierThresholdPercent: this.outlierThresholdPercent,
        volumeLookbackSeconds: this.volumeLookbackSeconds,
        enableMaxPriceAge: this.enableMaxPriceAge,
        maxPriceAgeMs: this.maxPriceAgeMs,
        enableWeightedMedian: this.enableWeightedMedian,
        lambda: this.lambda,
      })}`
    );
  }

  protected override async getFeedPrice(feedId: FeedId): Promise<number | undefined> {
    const config = this.config.find(
      config => config.feed.category === feedId.category && config.feed.name === feedId.name
    );
    if (!config) {
      this.logger.warn(`No config found for feed ${JSON.stringify(feedId)}`);
      return undefined;
    }

    const now = Date.now();
    const freshPrices: { value: number; exchange: string }[] = [];

    for (const source of config.sources) {
      const info = this.latestPrice.get(source.symbol)?.get(source.exchange);
      if (!info || (this.enableMaxPriceAge && now - info.time > this.maxPriceAgeMs)) continue;

      let price = info.value;
      if (source.symbol.endsWith("USDT")) {
        const usdtToUsd = await this.getFeedPrice({ category: 1, name: "USDT/USD" });
        if (usdtToUsd === undefined) continue;
        price *= usdtToUsd;
      }

      freshPrices.push({ value: price, exchange: source.exchange });
    }

    if (freshPrices.length === 0) {
      this.logger.warn(`No fresh prices for feed ${JSON.stringify(feedId)}`);
      return undefined;
    }

    let pricesToUse = freshPrices;

    if (this.enableOutlierFilter) {
      const median = this.simpleMedian(freshPrices.map(p => p.value));
      const filteredPrices = freshPrices.filter(p => {
        const deviationPercent = (Math.abs(p.value - median) / median) * 100;
        return deviationPercent <= this.outlierThresholdPercent;
      });

      if (filteredPrices.length > 0) {
        pricesToUse = filteredPrices;
      }
    }

    return this.weightedAverage(pricesToUse, feedId.name);
  }

  private simpleMedian(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  private weightedAverage(prices: { value: number; exchange: string; time?: number }[], symbol: string): number {
    if (!this.enableVolumeWeighting) {
      return prices.reduce((sum, p) => sum + p.value, 0) / prices.length;
    }

    const volumeByExchange = this.volumes.get(symbol);
    let totalWeight = 0;
    let weightedSum = 0;
    const now = Date.now();

    for (const { value, exchange } of prices) {
      let volumeWeight = 1;
      const volumeStore = volumeByExchange?.get(exchange);
      const volume = volumeStore?.getVolume(this.volumeLookbackSeconds);
      if (volume && volume > 0) {
        volumeWeight = volume;
      }

      const info = this.latestPrice.get(symbol)?.get(exchange);
      const freshnessWeight =
        info && info.time ? (this.enableMaxPriceAge ? Math.max(0, 1 - (now - info.time) / this.maxPriceAgeMs) : 1) : 1;

      const finalWeight = volumeWeight * freshnessWeight;

      weightedSum += value * finalWeight;
      totalWeight += finalWeight;
    }

    if (totalWeight === 0) {
      this.logger.warn(`Total volume+freshness weight is zero for symbol ${symbol}, falling back to simple average`);
      return prices.reduce((sum, p) => sum + p.value, 0) / prices.length;
    }

    return weightedSum / totalWeight;
  }
}
