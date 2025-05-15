import { FeedId } from "../dto/provider-requests.dto";
import { PriceHistoryEntry } from "./mysql";
import { ILogger } from "./ILogger";

/** === Parameter ============================== */
const MAX_HISTORY = 10; // wie viele Runden einbeziehen
const DECAY_LAMBDA = 0.075; // Gewichts-Halbwertszeit ~ ln(2)/λ Runden
const ONCHAIN_BLEND = 0.25; // Gewicht, falls |Δ| > THRESHOLD_BPS
const THRESHOLD_BPS = 15; // 0,15 % Schwellwert für On-Chain-Blend
const JITTER_BPS = 0.05; // ±0,05 bp = 0,0005 %
/** ============================================ */

export async function priceStrategie01(
  feed: FeedId,
  ccxtLive: number,
  onchainLive: number,
  _decimals: number,
  _onchainDecimals: number,
  history: PriceHistoryEntry[],
  logger?: ILogger
): Promise<number> {
  try {
    /* ---------- 1. History vorbereiten ----------------------------------- */
    const trimmed = history
      .slice(0, MAX_HISTORY) // jüngste N Runden
      .map((h, i) => ({
        price: h.ccxt_price,
        weight: Math.exp(-DECAY_LAMBDA * i), // jüngere > ältere
      }))
      // Outlier via Median-Absolute-Deviation k=3
      .filter(({ price }, _, arr) => {
        const med = median(arr.map(a => a.price));
        const mad = median(arr.map(a => Math.abs(a.price - med))) || 1e-9;
        return Math.abs(price - med) / mad < 3;
      });

    const histMedian = weightedMedian(trimmed);

    /* ---------- 2. Live-Preis vs. History mergen ------------------------- */
    // 60 % Live-Preis, 40 % History-Median (kannst du via ENV shiften)
    let adjusted = 0.6 * ccxtLive + 0.4 * histMedian;

    /* ---------- 3. On-Chain als Fallback-Korrektor ------------------------ */
    const relDiffBps = Math.abs((adjusted - onchainLive) / adjusted) * 1e4;
    if (relDiffBps > THRESHOLD_BPS) {
      adjusted = (1 - ONCHAIN_BLEND) * adjusted + ONCHAIN_BLEND * onchainLive;
    }

    /* ---------- 4. Mini-Jitter gegen Reward-Splits ----------------------- */
    const jitter = (Math.random() - 0.5) * JITTER_BPS * 1e-4 * adjusted;
    adjusted += jitter;

    /* ---------- 5. Logging ------------------------------------------------ */
    if (logger) {
      logger.debug(
        `\n######################################################################\n` +
          `📊 [${feed.name}] Aktuelle Preisanpassung (priceStrategie01)\n` +
          `────────────────────────────────────────────\n` +
          `   Adjusted Price       : ${adjusted}\n` +
          `   CCXT Price (live)    : ${ccxtLive}\n` +
          `   Hist. W-Median       : ${histMedian}\n` +
          `   ONCHAIN Price (live) : ${onchainLive}\n` +
          `   |Δadj-onchain| (bps) : ${relDiffBps.toFixed(2)}\n` +
          `######################################################################\n`
      );
    }

    return adjusted;
  } catch (err) {
    logger?.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
    return ccxtLive;
  }
}

/* ---------- Hilfsfunktionen --------------------------------------------- */

/** einfacher Median – O(n log n) reicht bei ≤ 30 Elementen */
function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** gewichteter Median (s.u.) */
function weightedMedian(data: { price: number; weight: number }[]): number {
  if (!data.length) return NaN;
  const sorted = [...data].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  let acc = 0;
  for (const { price, weight } of sorted) {
    acc += weight;
    if (acc >= total / 2) return price;
  }
  return sorted[sorted.length - 1].price;
}
