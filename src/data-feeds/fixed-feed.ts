import { Logger } from "@nestjs/common";
import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";

/** Safe value that will not overflow for all default feeds. */
const DEFAULT_VALUE = 0.01;

export class FixedFeed implements BaseDataFeed {
  private readonly logger = new Logger(FixedFeed.name);

  constructor() {
    this.logger.warn(`Initializing FixedFeed, will return ${DEFAULT_VALUE} for all feeds.`);
  }
  async getValue(feed: FeedId): Promise<FeedValueData> {
    return {
      feed,
      value: DEFAULT_VALUE,
    };
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    const promises = feeds.map(feed => this.getValue(feed));
    return Promise.all(promises);
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    return Promise.resolve([]);
  }
}
