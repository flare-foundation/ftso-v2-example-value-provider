import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getVotingHistory } from "../utils/mysql";

export class Test4CcxtFeed extends CcxtFeed implements BaseDataFeed {
  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed);
    const adjustedValue = await this.adjustPrice(result.value, feed);

    this.logger.debug(`Test4: ${feed.name} | Original=${result.value}, Adjusted=${adjustedValue}`);

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

  private async adjustPrice(original: number, feed: FeedId): Promise<number> {
    try {
      const history = await getVotingHistory(feed.name, 1);
      if (history.length === 0) return original;

      const { first_quartile, third_quartile } = history[0];
      const bandMid = (first_quartile + third_quartile) / 2;

      const deviation = original - bandMid;

      // Sanfte Rückführung Richtung Band-Mitte
      const corrected = original - deviation * 0.6;

      this.logger.debug(
        `🎯 ${feed.name} Band [${first_quartile}, ${third_quartile}], ` +
          `Mid=${bandMid.toFixed(8)}, Orig=${original}, Corr=${corrected.toFixed(8)}`
      );

      return corrected;
    } catch (err) {
      this.logger.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
      return original;
    }
  }
}
