import { RandomFeed } from "./random-feed";
import { FeedId } from "../dto/provider-requests.dto";

describe("RandomFeed", () => {
  let service: RandomFeed;

  beforeEach(() => {
    service = new RandomFeed();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should return a value between 0.025 and 0.075", async () => {
    const feed: FeedId = { category: 1, name: "Test" };
    const result = await service.getValue(feed);
    expect(result.value).toBeGreaterThanOrEqual(0.025);
    expect(result.value).toBeLessThanOrEqual(0.075);
    expect(result.feed).toEqual(feed);
  });

  it("should return values for multiple feeds", async () => {
    const feeds: FeedId[] = [
      { category: 1, name: "Test1" },
      { category: 2, name: "Test2" },
    ];
    const results = await service.getValues(feeds);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.value).toBeGreaterThanOrEqual(0.025);
      expect(result.value).toBeLessThanOrEqual(0.075);
    }
  });

  it("should return empty volumes array", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test1" }];
    const result = await service.getVolumes(feeds, 3600);
    expect(result).toEqual([]);
  });
});
