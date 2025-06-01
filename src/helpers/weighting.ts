import { TradeInfo } from "../types/market-data-types";

export function applyDecayWeighting(
  trades: TradeInfo[],
  lambda: number,
  now: number
): { price: number; weight: number }[] {
  return trades.map(t => {
    const decay = Math.exp(-lambda * (now - t.timestamp));
    const weight = t.amount * decay;
    return { price: t.price, weight };
  });
}

export function applyDecayWithCapAndStats(
  trades: TradeInfo[],
  lambda: number,
  maxTradeUsd: number,
  now: number
): {
  weighted: { price: number; weight: number; exchange: string }[];
  exchangeStats: Map<string, { weight: number; count: number }>;
} {
  const exchangeStats = new Map<string, { weight: number; count: number }>();

  const weighted = trades
    .map(t => {
      const age = now - t.timestamp;
      const decay = Math.exp(-lambda * age);
      const usdVolume = t.amount * t.price;
      const cappedVolume = Math.min(usdVolume, maxTradeUsd);
      const weight = cappedVolume * decay;
      if (!exchangeStats.has(t.exchange)) {
        exchangeStats.set(t.exchange, { weight: 0, count: 0 });
      }
      exchangeStats.get(t.exchange)!.weight += weight;
      exchangeStats.get(t.exchange)!.count += 1;

      return { price: t.price, weight, exchange: t.exchange };
    })
    .filter(w => w.weight > 0);

  return { weighted, exchangeStats };
}

export function normalizeAndSort(weighted: { price: number; weight: number }[]): { price: number; weight: number }[] {
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) return [];
  return weighted
    .map(w => ({
      price: w.price,
      weight: w.weight / totalWeight,
    }))
    .sort((a, b) => a.price - b.price);
}

export function computeWeightedAverageAndStdDev(entries: { price: number; weight: number }[]): {
  avg: number;
  stdDev: number;
} {
  const avg = entries.reduce((sum, x) => sum + x.price * x.weight, 0);
  const variance = entries.reduce((sum, x) => {
    const diff = x.price - avg;
    return sum + x.weight * diff * diff;
  }, 0);
  return { avg, stdDev: Math.sqrt(variance) };
}
