import { Test, TestingModule } from "@nestjs/testing";
import { ExampleProviderService } from "./app.service";
import { BaseDataFeed } from "./data-feeds/base-feed";
import { FeedId } from "./dto/provider-requests.dto";

describe("ExampleProviderService", () => {
  let service: ExampleProviderService;
  let dataFeed: BaseDataFeed;

  beforeEach(async () => {
    const dataFeedMock: BaseDataFeed = {
      getValue: jest.fn(),
      getValues: jest.fn(),
      getVolumes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: BaseDataFeed,
          useValue: dataFeedMock,
        },
        ExampleProviderService,
      ],
    }).compile();

    service = module.get<ExampleProviderService>(ExampleProviderService);
    dataFeed = module.get<BaseDataFeed>(BaseDataFeed);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should delegate getValue to dataFeed", async () => {
    const feed: FeedId = { category: 1, name: "Test" };
    (dataFeed.getValue as jest.Mock).mockResolvedValue({ feed, value: 42 });

    const result = await service.getValue(feed);

    expect(dataFeed.getValue).toHaveBeenCalledWith(feed);
    expect(result.value).toBe(42);
  });

  it("should delegate getValues to dataFeed", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test1" }];
    (dataFeed.getValues as jest.Mock).mockResolvedValue([{ feed: feeds[0], value: 42 }]);

    const result = await service.getValues(feeds);

    expect(dataFeed.getValues).toHaveBeenCalledWith(feeds);
    expect(result).toHaveLength(1);
  });

  it("should delegate getVolumes to dataFeed", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test1" }];
    (dataFeed.getVolumes as jest.Mock).mockResolvedValue([]);

    const result = await service.getVolumes(feeds, 60);

    expect(dataFeed.getVolumes).toHaveBeenCalledWith(feeds, 60);
    expect(result).toEqual([]);
  });
});
