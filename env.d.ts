/// <reference types="node" />

declare namespace NodeJS {
  interface ProcessEnv {
    LOG_LEVEL?: string;
    VALUE_PROVIDER_CLIENT_PORT?: string;
    VALUE_PROVIDER_IMPL?: string;
    MEDIAN_DECAY?: string;
    TRADES_HISTORY_SIZE?: string;

    ENABLE_OUTLIER_FILTER?: "true" | "false";
    ENABLE_VOLUME_WEIGHTING?: "true" | "false";
    OUTLIER_THRESHOLD_PERCENT?: string;
    VOLUME_LOOKBACK_SECONDS?: string;
  }
}