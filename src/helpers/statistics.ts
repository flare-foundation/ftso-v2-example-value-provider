export function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mad(arr: number[]): number {
  const m = median(arr);
  const deviations = arr.map(x => Math.abs(x - m));
  return median(deviations);
}

export function getWeightedMedian(entries: { price: number; weight: number }[]): number | undefined {
  const sorted = entries.slice().sort((a, b) => a.price - b.price);
  let cumWeight = 0;
  for (const n of sorted) {
    cumWeight += n.weight;
    if (cumWeight >= 0.5) return n.price;
  }
  return sorted.at(-1)?.price;
}
