import { FeedId } from "../dto/provider-requests.dto";
import { StrategyContext, StrategyResult } from "./types";

export async function strategyLastEpochPrice(
  feed: FeedId,
  onchainPrice: number,
  lastFtsoPrice: number,
  context: StrategyContext
): Promise<StrategyResult> {
  const logger = context.logger;
  const fallbackPrice = onchainPrice || 0.01;
  const resultPrice = lastFtsoPrice || fallbackPrice;

  logger.debug(`[strategyLastEpochPrice] 📊 Strategie für ${feed.name}`);
  logger.debug(`[strategyLastEpochPrice] Letzter FTSO-Preis: ${lastFtsoPrice}`);
  logger.debug(`[strategyLastEpochPrice] Onchain-Preis:      ${onchainPrice}`);
  logger.debug(`[strategyLastEpochPrice] Rückgabe:           ${resultPrice}`);

  return {
    value: resultPrice,
    ccxt: resultPrice, // kein CCXT vorhanden → gleichgesetzt
    onchain: onchainPrice,
    meta: [
      0, // keine Trades
      lastFtsoPrice ?? 0, // letzter FTSO-Preis
    ],
    strategyName: "LastEpochPrice",
  };
}
