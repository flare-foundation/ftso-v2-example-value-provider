import { Body, Controller, Get, Param, ParseIntPipe, Post, Inject, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExampleProviderService } from "./app.service";
import { FeedValuesRequest, FeedValuesResponse, FeedId, FeedValueResponse } from "./dto/provider-requests.dto";

@ApiTags("Feed Value Provider API")
@Controller()
export class ExampleProviderController {
  private logger = new Logger(ExampleProviderController.name);
  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly providerService: ExampleProviderService) {}

  @Post("feed-values/:votingRoundId")
  async getFeedValues(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: FeedValuesRequest
  ): Promise<FeedValuesResponse> {
    const values = await this.providerService.getValues(body.feeds);
    this.logger.log(`Feed values for voting round ${votingRoundId}: ${JSON.stringify(values)}`);
    return {
      votingRoundId,
      data: values,
    };
  }

  @Get("feed-value/:votingRoundId/:feed")
  async getFeedValue(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("feed") feed: FeedId
  ): Promise<FeedValueResponse> {
    const value = await this.providerService.getValue(feed);
    this.logger.log(`Feed value for voting round ${votingRoundId}: ${JSON.stringify(value)}`);

    return {
      votingRoundId,
      data: value,
    };
  }
}
