import { FeedId, FeedValueData } from "../dto/provider-requests.dto";

export abstract class BaseDataFeed {
  abstract getValue(feed: FeedId): Promise<FeedValueData>;
  abstract getValues(feeds: FeedId[]): Promise<FeedValueData[]>;
}
