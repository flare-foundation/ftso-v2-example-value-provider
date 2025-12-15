import { Body, Controller, Param, DefaultValuePipe, ParseIntPipe, Post, Inject, Logger, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExampleProviderService } from "./app.service";
import {
  FeedValuesRequest,
  FeedValuesResponse,
  FeedVolumesResponse,
  RoundFeedValuesResponse,
} from "./dto/provider-requests.dto";

@ApiTags("Feed Value Provider API")
@Controller()
export class ExampleProviderController {
  private logger = new Logger(ExampleProviderController.name);

  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly providerService: ExampleProviderService) {}

  @Post("feed-values/:votingRoundId")
  async getFeedValues(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: FeedValuesRequest
  ): Promise<RoundFeedValuesResponse> {
    if (!body || !body.feeds) {
      throw new Error("Invalid request body: feeds array is required");
    }
    const values = await this.providerService.getValues(body.feeds);
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
    @Query("window", new DefaultValuePipe("60"), ParseIntPipe) windowSec: number
  ): Promise<FeedVolumesResponse> {
    const values = await this.providerService.getVolumes(body.feeds, windowSec);
    this.logger.log(`Feed volumes for last ${windowSec} seconds: ${JSON.stringify(values)}`);
    return {
      data: values,
    };
  }
}
