import { Injectable } from "@nestjs/common";
import { FeedId, FeedValueData } from "./dto/provider-requests.dto";
import { BaseDataFeed } from "./data-feeds/base-feed";

@Injectable()
export class ExampleProviderService {
  constructor(private readonly dataFeed: BaseDataFeed) {}

  async getValue(feed: FeedId): Promise<FeedValueData> {
    return this.dataFeed.getValue(feed);
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    return this.dataFeed.getValues(feeds);
  }
}
