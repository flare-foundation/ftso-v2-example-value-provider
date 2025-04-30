import { FixedFeed } from "./fixed-feed";
import { FeedId } from "../dto/provider-requests.dto";

describe("FixedFeed", () => {
  let service: FixedFeed;

  beforeEach(() => {
    service = new FixedFeed();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should return the default value for a feed", async () => {
    const feed: FeedId = { category: 1, name: "Test" };
    const result = await service.getValue(feed);
    expect(result.value).toBe(0.01);
    expect(result.feed).toEqual(feed);
  });

  it("should return default values for multiple feeds", async () => {
    const feeds: FeedId[] = [
      { category: 1, name: "Test1" },
      { category: 2, name: "Test2" },
    ];
    const results = await service.getValues(feeds);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.value).toBe(0.01);
    }
  });

  it("should return empty volumes array", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test1" }];
    const result = await service.getVolumes(feeds, 3600);
    expect(result).toEqual([]);
  });
});
