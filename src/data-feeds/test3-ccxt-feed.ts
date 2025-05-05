import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";

export class Test3CcxtFeed extends CcxtFeed implements BaseDataFeed {
  constructor() {
    super(); // nutzt dieselbe Konfiguration wie CcxtFeed
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed);

    // 👇 hier kannst du feinjustieren
    const adjustedValue = this.adjustPrice(result.value, feed);

    this.logger.debug(`Test1: Originalwert für ${feed.name}: ${result.value}, angepasst: ${adjustedValue}`);

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
   * 🔧 Hier kannst du alle Anpassungen vornehmen.
   * Aktuell: kleine positive Verschiebung von 0.01 %
   */
  private adjustPrice(original: number, feed: FeedId): number {
    // Beispiel: kleine lineare Korrektur je nach Symbol
    if (feed.name === "BTC/USD") {
      return original * 1.00001; // +0.001 %
    }

    return original; // Default: keine Änderung
  }
}
