import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";

export abstract class BaseDataFeed {
  abstract getValue(feed: FeedId): Promise<FeedValueData>;

  abstract getValues(feeds: FeedId[]): Promise<FeedValueData[]>;

  abstract getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]>;
}
