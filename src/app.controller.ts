import { Body, Controller, Param, ParseIntPipe, Post, Inject, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExampleProviderService } from "./app.service";
import { FeedValuesRequest, FeedValuesResponse } from "./dto/provider-requests.dto";

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
}
