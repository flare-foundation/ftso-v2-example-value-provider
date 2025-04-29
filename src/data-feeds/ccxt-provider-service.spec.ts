import { Test, TestingModule } from "@nestjs/testing";
import { CcxtFeed } from "./ccxt-provider-service";

describe("CcxtFeed", () => {
  let service: CcxtFeed;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CcxtFeed],
    }).compile();

    service = module.get<CcxtFeed>(CcxtFeed);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
