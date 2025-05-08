import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getVotingHistory, storeSubmittedPrice, getFeedDecimals } from "../utils/mysql";

export class Test4CcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    this.logger.debug(`🔎 [${feed.name}] Unkorrigierter Preis (CCXT): ${result.value}`);

    const decimals = (await getFeedDecimals(feed.name)) ?? 8;
    this.logger.debug(`ℹ️ [${feed.name}] Decimals aus DB: ${decimals}`);

    const adjustedValue = await this.adjustPrice(result.value, feed, decimals);

    this.logger.debug(`📝 [${feed.name}] Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

    if (this.currentVotingRoundId) {
      const submittedScaled = Math.round(adjustedValue * 10 ** decimals);
      const ccxtScaled = Math.round(result.value * 10 ** decimals);

      this.logger.debug(
        `📤 [${feed.name}] Speichere Preisabgabe:\n` +
          `     Round         = ${this.currentVotingRoundId}\n` +
          `     Adjusted      = ${adjustedValue} (scaled=${submittedScaled})\n` +
          `     CCXT Raw      = ${result.value} (scaled=${ccxtScaled})\n` +
          `     Decimals      = ${decimals}`
      );

      await storeSubmittedPrice(feed.name, this.currentVotingRoundId, submittedScaled, ccxtScaled);
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
      this.logger.debug(`🆔 Setze VotingRoundId auf ${votingRoundId}`);
      this.currentVotingRoundId = votingRoundId;
    }

    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private async adjustPrice(original: number, feed: FeedId, decimals: number): Promise<number> {
    try {
      const history = await getVotingHistory(feed.name, 1);
      if (history.length === 0) return original;

      const { first_quartile, third_quartile } = history[0];
      const scale = 10 ** decimals;

      const original_scaled = Math.round(original * scale);
      const bandMid = Math.round((first_quartile + third_quartile) / 2);

      const deviation = original_scaled - bandMid;
      const corrected_scaled = Math.round(original_scaled - deviation * 0.6);
      const corrected = corrected_scaled / scale;

      this.logger.debug(
        `🎯 [${feed.name}] Banddaten:\n` +
          `     Q1           = ${first_quartile}\n` +
          `     Q3           = ${third_quartile}\n` +
          `     Mid          = ${bandMid}\n` +
          `     Orig.scaled  = ${original_scaled}\n` +
          `     Deviation    = ${deviation}\n` +
          `     Corr.scaled  = ${corrected_scaled}\n` +
          `     Final        = ${corrected}`
      );

      return corrected;
    } catch (err) {
      this.logger.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
      return original;
    }
  }
}
