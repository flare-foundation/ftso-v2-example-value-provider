import { Module } from "@nestjs/common";
import { ExampleProviderService } from "./app.service";
import { ExampleProviderController } from "./app.controller";
import { CcxtFeed } from "./data-feeds/ccxt-provider-service";
import { RandomFeed } from "./data-feeds/random-feed";
import { BaseDataFeed } from "./data-feeds/base-feed";
import { FixedFeed } from "./data-feeds/fixed-feed";
import { SmartCcxtFeed, loadSmartFeedConfigFromEnv } from "./data-feeds/smart-ccxt-feed";
import dotenv from "dotenv";

dotenv.config();

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [
    {
      provide: "EXAMPLE_PROVIDER_SERVICE",
      useFactory: async () => {
        let dataFeed: BaseDataFeed;

        const providerImpl = (process.env.VALUE_PROVIDER_IMPL ?? "").toLowerCase();

        if (providerImpl === "fixed") {
          dataFeed = new FixedFeed();
        } else if (providerImpl === "random") {
          dataFeed = new RandomFeed();
        } else if (providerImpl === "smartccxt") {
          const smartCcxtFeed = new SmartCcxtFeed(loadSmartFeedConfigFromEnv());
          await smartCcxtFeed.start();
          dataFeed = smartCcxtFeed;
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
