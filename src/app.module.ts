import { Module } from "@nestjs/common";
import { ProviderService } from "./app.service";
import { ProviderController } from "./app.controller";
import { CcxtFeed } from "./data-feeds/ccxt-provider-service";
import { RandomFeed } from "./data-feeds/random-feed";
import { BaseDataFeed } from "./data-feeds/base-feed";
import { FixedFeed } from "./data-feeds/fixed-feed";
import { FtsoCcxtFeed } from "./data-feeds/ftso-ccxt-feed";
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
        } else if (providerImpl === "ftsoccxt") {
          const ftsoCcxtFeed = new FtsoCcxtFeed();
          await ftsoCcxtFeed.start();
          dataFeed = ftsoCcxtFeed;
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
