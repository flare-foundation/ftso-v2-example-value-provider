import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getVotingHistory } from "../utils/mysql";
import { getBias, setBias, saveBiases, loadBiases } from "../utils/bias-storage";

export class Test3CcxtFeed extends CcxtFeed implements BaseDataFeed {
  private learningRate = 0.1;
  private currentVotingRoundId?: number;

  constructor() {
    super();
    void loadBiases().then(() => {
      this.logger.log("✅ Biases geladen:", JSON.stringify(globalThis.biases || {}, null, 2));
    });
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed);
    const adjustedValue = await this.adjustPrice(result.value, feed);

    this.logger.debug(`Test3: ${feed.name}: Original=${result.value}, Adjusted=${adjustedValue}`);
    return { feed, value: adjustedValue };
  }

  async getValues(feeds: FeedId[], votingRoundId?: number): Promise<FeedValueData[]> {
    this.currentVotingRoundId = votingRoundId;
    const results = await Promise.all(feeds.map(feed => this.getValue(feed)));
    await saveBiases(); // Biases nach der Runde speichern
    return results;
  }

  private async adjustPrice(original: number, feed: FeedId): Promise<number> {
    try {
      const history = await getVotingHistory(feed.name, 10);
      if (history.length < 3) return original;

      const last = history[0];
      const bandMid = (last.first_quartile + last.third_quartile) / 2;
      const deviation = original - bandMid;

      const avgDeviation = history
        .map(e => e.value - (e.first_quartile + e.third_quartile) / 2)
        .reduce((a, b) => a + b, 0) / history.length;

      const prevBias = getBias(feed.name);
      const updatedBias = prevBias - this.learningRate * avgDeviation;

      // Bias begrenzen auf ±10 % vom Originalpreis
      const maxBias = original * 0.1;
      const boundedBias = Math.max(Math.min(updatedBias, maxBias), -maxBias);

      setBias(feed.name, boundedBias);

      const corrected = original - deviation * 0.5 + boundedBias;

      this.logger.debug(
        `📈 Runde ${this.currentVotingRoundId ?? "?"} ${feed.name} | ` +
        `Orig=${original}, BandMid=${bandMid.toFixed(8)}, Deviation=${deviation.toFixed(8)}, ` +
        `Bias=${boundedBias.toFixed(8)}, New=${corrected.toFixed(8)}`
      );

      return corrected;
    } catch (err) {
      this.logger.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
      return original;
    }
  }

  async init() {
    await loadBiases();
    return this;
  }
}
