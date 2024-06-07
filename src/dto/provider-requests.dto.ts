export class FeedId {
  category: number;
  name: string;
}

export class FeedValuesRequest {
  feeds: FeedId[];
}

export class FeedValueData {
  feed: FeedId;
  /** Value in base units as float */
  value: number;
}

export class RoundFeedValuesResponse {
  votingRoundId: number;
  data: FeedValueData[];
}

export class FeedValuesResponse {
  data: FeedValueData[];
}
