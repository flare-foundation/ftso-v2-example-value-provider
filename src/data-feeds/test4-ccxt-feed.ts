import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getVotingHistory, storeSubmittedPrice } from "../utils/mysql";

export class Test4CcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    const adjustedValue = await this.adjustPrice(result.value, feed);

    this.logger.debug(`📝 ${feed.name}: Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

    if (this.currentVotingRoundId) {
      this.logger.debug(
        `📤 Speichere Preisabgabe: Feed=${feed.name}, Round=${this.currentVotingRoundId}, ` +
          `Submitted=${adjustedValue}, CCXT=${result.value}`
      );
      await storeSubmittedPrice(feed.name, this.currentVotingRoundId, adjustedValue, result.value);
    } else {
      this.logger.warn(`⚠️ ${feed.name}: Keine VotingRoundId gesetzt – Preis wird NICHT gespeichert.`);
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

  private async adjustPrice(original: number, feed: FeedId): Promise<number> {
    try {
      //const history = await getVotingHistory(feed.name, 1);
      //if (history.length === 0) return original;

      //const { first_quartile, third_quartile } = history[0];
      //const bandMid = (first_quartile + third_quartile) / 2;

      //const original_scaled = Math.round(original * 1e8);

      //const deviation = original_scaled - bandMid;
      //const corrected = original_scaled - deviation * 0.6;

      //this.logger.debug(
      //  `🎯 ${feed.name} Band [${first_quartile}, ${third_quartile}], ` +
      //    `Mid=${bandMid.toFixed(0)}, Orig=${original_scaled}, Corr=${corrected.toFixed(0)}`
      //);

      //return corrected;
      return original;
    } catch (err) {
      this.logger.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
      return original;
    }
  }
}
