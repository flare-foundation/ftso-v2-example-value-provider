import { Module } from "@nestjs/common";
import { ExampleProviderService } from "./app.service";
import { ExampleProviderController } from "./app.controller";
import { CcxtFeed } from "./data-feeds/ccxt-provider-service";
import { RandomFeed } from "./data-feeds/random-feed";
import { BaseDataFeed } from "./data-feeds/base-feed";
import { FixedFeed } from "./data-feeds/fixed-feed";

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [
    {
      provide: "EXAMPLE_PROVIDER_SERVICE",
      useFactory: async () => {
        let dataFeed: BaseDataFeed;

        if (process.env.VALUE_PROVIDER_IMPL == "fixed") {
          dataFeed = new FixedFeed();
        } else if (process.env.VALUE_PROVIDER_IMPL == "random") {
          dataFeed = new RandomFeed();
        } else {
          const ccxtFeed = new CcxtFeed();
          await ccxtFeed.start();
          dataFeed = ccxtFeed;
        }

        const service = new ExampleProviderService(dataFeed);
        return service;
      },
    },
  ],
})
export class RandomExampleProviderModule {}
