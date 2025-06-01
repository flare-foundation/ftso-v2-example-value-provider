import { getFeedId, getPriceHistory } from "../utils/mysql";
import { strategyDefault } from "./strategy-default";
import { strategyLastEpochPrice } from "./strategy-last-epoch-price";
import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";

import { strategyVolatilityWeighted } from "./strategy-volatility";
import { strategyLowTrades } from "./strategy-low-trades";
import { strategyTop3ExchangeMedian } from "./strategy-top3-exchange-median";
import { strategyWeightedVWAP } from "./strategy-weighted-vwap";
import { strategyTrimmedMean } from "./strategy-trimmed-mean";
import { strategyTrendMomentum } from "./strategy-trend-momentum";
import { strategyRollingMADFilter } from "./strategy-rolling-mad-filter";
import { strategySmartBlend } from "./strategy-smart-blend";
import { strategyBjSgb } from "./strategy-bj-sgb";

export async function applyPriceStrategy(
  feed: FeedId,
  onchainPrice: number,
  _decimals: number,
  _onchainDecimals: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const strategyLogger = context.logger;
  const feedId = await getFeedId(feed.name);
  const usdtfeedId = await getFeedId("USDT/USD");
  const history = await getPriceHistory(feedId, 1);
  const history_usdt = await getPriceHistory(usdtfeedId, 1);
  const lastFtsoPrice = history?.[0]?.ftso_price;
  const lastUSDTFtsoPrice = history_usdt?.[0]?.ftso_price;

  const StableCoins = ["USDT/USD", "USDC/USD", "USDX/USD", "USDS/USD"];
  if (StableCoins.includes(feed.name.toUpperCase())) {
    if (lastFtsoPrice != null) {
      strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyLastEpochPrice`);
      return strategyLastEpochPrice(feed, onchainPrice, lastFtsoPrice, context);
    } else {
      strategyLogger.warn(`⚠️ [${feed.name}] Kein historischer Preis gefunden – wechsle zu Defaults`);
    }
  }

  const LowTradesCoins = ["JOULE/USD"];
  if (LowTradesCoins.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyLowTrades`);
    return strategyLowTrades(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const VolatilityCoins = ["BTC/USD"];
  if (VolatilityCoins.includes(feed.name.toUpperCase())) {
    context.logger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyVolatilityWeighted`);
    return strategyVolatilityWeighted(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const top3ExchangeMedianCoins = ["LTC/USD"];
  if (top3ExchangeMedianCoins.includes(feed.name.toUpperCase())) {
    context.logger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyTop3ExchangeMedian`);
    return strategyTop3ExchangeMedian(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const WeightedVWAPCoins = ["BNB/USD"];
  if (WeightedVWAPCoins.includes(feed.name.toUpperCase())) {
    context.logger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyWeightedVWAP`);
    return strategyWeightedVWAP(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const trimmedMeanCoins = ["AVAX/USD"];
  if (trimmedMeanCoins.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyTrimmedMean`);
    return strategyTrimmedMean(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const TrendMomentuCoins = ["ADA/USD"];
  if (TrendMomentuCoins.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyTrendMomentum`);
    return strategyTrendMomentum(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const RollingMADFilterCoins = ["XLM/USD"];
  if (RollingMADFilterCoins.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategyRollingMADFilter`);
    return strategyRollingMADFilter(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const SmartBlendCoins = ["ETH/USD"];
  if (SmartBlendCoins.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: strategySmartBlend`);
    return strategySmartBlend(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  const BjSGB = ["SGB/USD"];
  if (BjSGB.includes(feed.name.toUpperCase())) {
    strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: BjSGB`);
    return strategyBjSgb(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
  }

  // Hier wird die Standardstrategie geladen, wenn das Pear nicht zuvor schon bearbeitet wurde
  strategyLogger.debug(`🧠 [${feed.name}] Strategie verwendet: Defaults`);
  return strategyDefault(feed, onchainPrice, lastFtsoPrice, lastUSDTFtsoPrice, context);
}
