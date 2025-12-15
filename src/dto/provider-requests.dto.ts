export class FeedId {
  category: number;
  name: string;
}

export class Volume {
  exchange: string;
  volume: number;
}

export class FeedValuesRequest {
  feeds: FeedId[];
}

export class FeedValueData {
  feed: FeedId;
  /** Value in base units as float */
  value: number;
}

export class FeedVolumeData {
  feed: FeedId;
  volumes: Volume[];
}

export class RoundFeedValuesResponse {
  votingRoundId: number;
  data: FeedValueData[];
}

export class FeedValuesResponse {
  data: FeedValueData[];
}
export class FeedVolumesResponse {
  data: FeedVolumeData[];
}
