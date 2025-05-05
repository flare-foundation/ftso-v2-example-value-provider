import { Module } from "@nestjs/common";
import { ProviderService } from "./app.service";
import { ProviderController } from "./app.controller";
import { CcxtFeed } from "./data-feeds/ccxt-provider-service";
import { RandomFeed } from "./data-feeds/random-feed";
import { BaseDataFeed } from "./data-feeds/base-feed";
import { FixedFeed } from "./data-feeds/fixed-feed";
import { loadSmartFeedConfigFromEnv, SmartCcxtFeed } from "./data-feeds/smart-ccxt-feed";
import { Test1CcxtFeed } from "./data-feeds/test1-ccxt-feed";
import { Test2CcxtFeed } from "./data-feeds/test2-ccxt-feed";
import { Test3CcxtFeed } from "./data-feeds/test3-ccxt-feed";
import { Test4CcxtFeed } from "./data-feeds/test4-ccxt-feed";
import { Test5CcxtFeed } from "./data-feeds/test5-ccxt-feed";
import dotenv from "dotenv";

dotenv.config();

@Module({
  imports: [],
  controllers: [ProviderController],
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
        } else if (providerImpl === "test1ccxt") {
          const test1CcxtFeed = new Test1CcxtFeed();
          await test1CcxtFeed.start();
          dataFeed = test1CcxtFeed;
        } else if (providerImpl === "test2ccxt") {
          const test2CcxtFeed = new Test2CcxtFeed();
          await test2CcxtFeed.start();
          dataFeed = test2CcxtFeed;
        } else if (providerImpl === "test3ccxt") {
          const test3CcxtFeed = new Test3CcxtFeed();
          await test3CcxtFeed.start();
          dataFeed = test3CcxtFeed;
        } else if (providerImpl === "test4ccxt") {
          const test4CcxtFeed = new Test4CcxtFeed();
          await test4CcxtFeed.start();
          dataFeed = test4CcxtFeed;
        } else if (providerImpl === "test5ccxt") {
          const test5CcxtFeed = new Test5CcxtFeed();
          await test5CcxtFeed.start();
          dataFeed = test5CcxtFeed;
        } else {
          const ccxtFeed = new CcxtFeed();
          await ccxtFeed.start();
          dataFeed = ccxtFeed;
        }

        return new ProviderService(dataFeed);
      },
    },
  ],
})
export class RandomExampleProviderModule {}
