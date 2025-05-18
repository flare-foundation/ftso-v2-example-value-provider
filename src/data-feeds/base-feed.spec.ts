import { BaseDataFeed } from "./base-feed";
import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";

describe("BaseDataFeed", () => {
  class TestDataFeed extends BaseDataFeed {
    getValue(feed: FeedId): Promise<FeedValueData> {
      return Promise.resolve({ feed, value: 42 });
    }
    getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
      return Promise.resolve(feeds.map(feed => ({ feed, value: 42 })));
    }
    getVolumes(_feeds: FeedId[], _volumeWindow: number): Promise<FeedVolumeData[]> {
      return Promise.resolve([]);
    }
  }

  let service: BaseDataFeed;

  beforeEach(() => {
    service = new TestDataFeed();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should return a value", async () => {
    const result = await service.getValue({ category: 1, name: "Test" });
    expect(result.value).toBe(42);
  });
});
