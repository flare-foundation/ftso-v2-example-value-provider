import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";

const baseValue = 0.05;

export class RandomFeed implements BaseDataFeed {
  async getValue(feed: FeedId): Promise<FeedValueData> {
    return {
      feed,
      value: baseValue * (0.5 + Math.random()),
    };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    const promises = feeds.map(feed => this.getValue(feed));
    return Promise.all(promises);
  }

  async getVolumes(_feeds: FeedId[], _volumeWindow: number): Promise<FeedVolumeData[]> {
    return Promise.resolve([]);
  }
}
