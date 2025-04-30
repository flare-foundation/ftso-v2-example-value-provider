import { Test, TestingModule } from "@nestjs/testing";
import { RandomExampleProviderModule } from "./app.module";
import { ProviderController } from "./app.controller";

describe("RandomExampleProviderModule", () => {
  jest.setTimeout(30000);
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [RandomExampleProviderModule],
    }).compile();
  });

  it("should compile the module", () => {
    expect(module).toBeDefined();
  });

  it("should provide ProviderController", () => {
    const controller = module.get<ProviderController>(ProviderController);
    expect(controller).toBeDefined();
  });
});
