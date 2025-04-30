import { Test, TestingModule } from "@nestjs/testing";
import { ExampleProviderController } from "./app.controller";
import { ExampleProviderService } from "./app.service";
import { FeedId, FeedValuesRequest } from "./dto/provider-requests.dto";

describe("ExampleProviderController", () => {
  let controller: ExampleProviderController;
  let service: ExampleProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [
        {
          provide: "EXAMPLE_PROVIDER_SERVICE",
          useValue: {
            getValues: jest.fn(),
            getVolumes: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ExampleProviderController>(ExampleProviderController);
    service = module.get<ExampleProviderService>("EXAMPLE_PROVIDER_SERVICE");
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should get feed values for voting round", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test" }];
    const body: FeedValuesRequest = { feeds };
    const mockResponse = [{ feed: feeds[0], value: 42 }];

    (service.getValues as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.getFeedValues(123, body);

    expect(result.votingRoundId).toBe(123);
    expect(result.data).toEqual(mockResponse);
    expect(service.getValues).toHaveBeenCalledWith(feeds);
  });

  it("should get current feed values", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test" }];
    const body: FeedValuesRequest = { feeds };
    const mockResponse = [{ feed: feeds[0], value: 42 }];

    (service.getValues as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.getCurrentFeedValues(body);

    expect(result.data).toEqual(mockResponse);
    expect(service.getValues).toHaveBeenCalledWith(feeds);
  });

  it("should get feed volumes", async () => {
    const feeds: FeedId[] = [{ category: 1, name: "Test" }];
    const body: FeedValuesRequest = { feeds };
    const mockResponse = [{ feed: feeds[0], volumes: [{ exchange: "binance", volume: 1000 }] }];

    (service.getVolumes as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.getFeedVolumes(body, 120);

    expect(result.data).toEqual(mockResponse);
    expect(service.getVolumes).toHaveBeenCalledWith(feeds, 120);
  });
});
