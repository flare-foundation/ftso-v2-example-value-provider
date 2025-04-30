import { Test, TestingModule } from "@nestjs/testing";
import { RandomExampleProviderModule } from "./app.module";
import { ExampleProviderController } from "./app.controller";

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

  it("should provide ExampleProviderController", () => {
    const controller = module.get<ExampleProviderController>(ExampleProviderController);
    expect(controller).toBeDefined();
  });
});
