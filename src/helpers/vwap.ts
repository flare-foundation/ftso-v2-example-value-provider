import { TradeInfo } from "../types/market-data-types";

export function getVWAP(trades: TradeInfo[]): number | undefined {
  const recent = trades.filter(t => Date.now() - t.timestamp < 5 * 60_000);
  const volSum = recent.reduce((sum, t) => sum + t.amount, 0);
  if (volSum === 0) return undefined;
  const pvSum = recent.reduce((sum, t) => sum + t.price * t.amount, 0);
  return pvSum / volSum;
}
