import { Body, Controller, Param, ParseIntPipe, Post, Inject, Logger, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ProviderService } from "./app.service";
import {
  FeedValuesRequest,
  FeedValuesResponse,
  FeedVolumesResponse,
  RoundFeedValuesResponse,
} from "./dto/provider-requests.dto";

@ApiTags("Feed Value Provider API")
@Controller()
export class ProviderController {
  private logger = new Logger(ProviderController.name);

  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly providerService: ProviderService) {}

  @Post("feed-values/:votingRoundId")
  async getFeedValues(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: FeedValuesRequest
  ): Promise<RoundFeedValuesResponse> {
    const values = await this.providerService.getValues(body.feeds, votingRoundId);
    this.logger.log(`Feed values for voting round ${votingRoundId}: ${JSON.stringify(values)}`);
    return {
      votingRoundId,
      data: values,
    };
  }

  @Post("feed-values/")
  async getCurrentFeedValues(@Body() body: FeedValuesRequest): Promise<FeedValuesResponse> {
    const values = await this.providerService.getValues(body.feeds);
    this.logger.log(`Current feed values: ${JSON.stringify(values)}`);
    return {
      data: values,
    };
  }

  @Post("volumes/")
  async getFeedVolumes(
    @Body() body: FeedValuesRequest,
    @Query("window") windowSec: number = 60
  ): Promise<FeedVolumesResponse> {
    const values = await this.providerService.getVolumes(body.feeds, windowSec);
    this.logger.log(`Feed volumes for last ${windowSec} seconds: ${JSON.stringify(values)}`);
    return {
      data: values,
    };
  }
}
