import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getFeedDecimals, storeSubmittedPrice, getPriceHistory, getFeedId } from "../utils/mysql";
import { adjustPrice } from "../utils/price-adjustment";

export class FtsoCcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    if (this.isDebug()) this.logger.debug(`🔎 [${feed.name}] Live-Preis (CCXT): ${result.value}`);

    const decimals = (await getFeedDecimals(feed.name)) ?? 8;
    if (this.isDebug()) this.logger.debug(`ℹ️ [${feed.name}] Decimals aus DB: ${decimals}`);

    const adjustedValue = await this.adjustPrice(result.value, feed, decimals);

    if (this.isDebug()) this.logger.debug(`📝 [${feed.name}] Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

    if (this.currentVotingRoundId) {
      const submittedScaled = Math.round(adjustedValue * 10 ** decimals);
      const ccxtScaled = Math.round(result.value * 10 ** decimals);

      if (this.isDebug())
        this.logger.debug(
          `📤 [${feed.name}] Speichere Preisabgabe:\n` +
            `     Round         = ${this.currentVotingRoundId}\n` +
            `     Adjusted      = ${adjustedValue} (scaled=${submittedScaled})\n` +
            `     CCXT Raw      = ${result.value} (scaled=${ccxtScaled})\n` +
            `     Decimals      = ${decimals}`
        );

      if (this.currentVotingRoundId && this.shouldStorePrices()) {
        await storeSubmittedPrice(feed.name, this.currentVotingRoundId, submittedScaled, ccxtScaled);
      }
    } else {
      this.logger.warn(`⚠️ [${feed.name}] Keine VotingRoundId gesetzt – Preis wird NICHT gespeichert.`);
    }

    return {
      feed,
      value: adjustedValue,
    };
  }

  async getValues(feeds: FeedId[], votingRoundId?: number): Promise<FeedValueData[]> {
    if (votingRoundId !== undefined) {
      if (this.isDebug()) this.logger.debug(`🆔 Setze VotingRoundId auf ${votingRoundId}`);
      this.currentVotingRoundId = votingRoundId;
    }

    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private async adjustPrice(original: number, feed: FeedId, decimals: number): Promise<number> {
    const feedId = await getFeedId(feed.name);
    if (!feedId) return original;
    const [history, trend] = await Promise.all([getPriceHistory(feedId, 30), this.getTrend15s(feed.name)]);
    return adjustPrice(feed, original, decimals, history, trend, this.logger);
  }

  private async getTrend15s(feedName: string): Promise<"up" | "down" | "flat"> {
    const config = this.config.find(f => f.feed.name === feedName);
    if (!config || config.sources.length === 0) {
      this.logger.warn(`❗ Kein Source-Eintrag für ${feedName} gefunden.`);
      return "flat";
    }

    const prices: number[] = [];

    for (const { exchange, symbol } of config.sources) {
      const priceMap = this.latestPrice.get(symbol);
      const info = priceMap?.get(exchange);
      if (!info) continue;

      const age = Date.now() - info.time;
      if (age > 30_000) continue;

      prices.push(info.value); // Wichtig: unskaliert
    }

    if (prices.length < 2) return "flat";

    const [first, last] = [prices[0], prices.at(-1)!];
    const pct = ((last - first) / first) * 100;
    const trend = pct > 0.03 ? "up" : pct < -0.03 ? "down" : "flat";

    if (this.isDebug()) {
      this.logger.debug(`[${feedName}] 🔍 Preisentwicklung (live): ${first} → ${last} = ${pct.toFixed(4)}%`);
      this.logger.debug(`[${feedName}] 🔍 Berechneter Trend: ${trend.toUpperCase()} (${pct.toFixed(4)}%)`);
    }

    return trend;
  }

  private shouldStorePrices(): boolean {
    return process.env.ENABLE_PRICE_STORAGE?.toLowerCase() === "true";
  }

  private isDebug(): boolean {
    return process.env.LOG_LEVEL?.toLowerCase() === "debug";
  }
}
