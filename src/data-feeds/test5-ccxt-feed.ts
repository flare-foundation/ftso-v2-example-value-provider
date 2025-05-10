import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getFeedDecimals, storeSubmittedPrice, getPriceHistory, getFeedId } from "../utils/mysql";

export class Test5CcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    if (this.isDebug()) this.logger.debug(`🔎 [${feed.name}] Unkorrigierter Preis (CCXT): ${result.value}`);

    const decimals = (await getFeedDecimals(feed.name)) ?? 8;
    if (this.isDebug()) this.logger.debug(`ℹ️ [${feed.name}] Decimals aus DB: ${decimals}`);

    const adjustedValue = await this.adjustPrice(result.value, feed, decimals);

    if (this.isDebug()) this.logger.debug(`📝 [${feed.name}] Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

    if (this.currentVotingRoundId) {
      const submittedScaled = Math.round(adjustedValue * 10 ** decimals);
      const ccxtScaled = Math.round(result.value * 10 ** decimals);

      if (this.isDebug())
        this.logger.debug(
          `📤 [${feed.name}] Speichere Preisabgabe:\n` +
            `     Round         = ${this.currentVotingRoundId}\n` +
            `     Adjusted      = ${adjustedValue} (scaled=${submittedScaled})\n` +
            `     CCXT Raw      = ${result.value} (scaled=${ccxtScaled})\n` +
            `     Decimals      = ${decimals}`
        );
      await storeSubmittedPrice(feed.name, this.currentVotingRoundId, submittedScaled, ccxtScaled);
    } else {
      this.logger.warn(`⚠️ [${feed.name}] Keine VotingRoundId gesetzt – Preis wird NICHT gespeichert.`);
    }

    return {
      feed,
      value: adjustedValue,
    };
  }

  async getValues(feeds: FeedId[], votingRoundId?: number): Promise<FeedValueData[]> {
    if (votingRoundId !== undefined) {
      if (this.isDebug()) this.logger.debug(`🆔 Setze VotingRoundId auf ${votingRoundId}`);
      this.currentVotingRoundId = votingRoundId;
    }

    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private async adjustPrice(original: number, feed: FeedId, decimals: number): Promise<number> {
    try {
      const scale = 10 ** decimals;
      const feedId = await getFeedId(feed.name);
      if (!feedId) return original;

      const [history, trend] = await Promise.all([getPriceHistory(feedId, 30), this.getTrend15s(feed.name)]);
      const ccxtPrice = original;

      if (this.isDebug()) {
        this.logger.debug(`📚 [${feed.name}] Historie der letzten Preisabweichungen:`);
        history.forEach((entry, i) => {
          const ccxt = entry.ccxt_price / scale;
          const ftso = entry.ftso_value;
          const submitted = entry.submitted ? entry.submitted / scale : null;
          const diffPct = ((ccxt - ftso) / ftso) * 100;

          this.logger.debug(
            `  #${i + 1}: voting_round_id=${entry.voting_round_id}` +
              `, CCXT=${ccxt.toFixed(8)}` +
              `, FTSO=${ftso.toFixed(8)}` +
              (submitted !== null ? `, Submitted=${submitted.toFixed(8)}` : "") +
              `, Diff=${diffPct.toFixed(4)}%`
          );
        });
      }

      const tolerance = 0.05;
      this.logger.debug(`[${feed.name}] Toleranz für Filterung: ${tolerance}%`);
      const filtered = history.filter(row => {
        const ftso_scaled = Math.round(row.ftso_value * scale);
        const ccxt_unscaled = row.ccxt_price / scale;
        const submitted_unscaled = row.submitted ? row.submitted / scale : null;

        const diffPct = Math.abs((row.ccxt_price - ftso_scaled) / ftso_scaled) * 100;

        const keep = diffPct <= tolerance;

        if (this.isDebug()) {
          this.logger.debug(
            `[${feed.name}] Prüfe Datenpunkt:` +
              ` CCXT=${ccxt_unscaled.toFixed(8)},` +
              ` FTSO=${row.ftso_value.toFixed(8)},` +
              (submitted_unscaled !== null ? ` Submitted=${submitted_unscaled.toFixed(8)},` : "") +
              ` Diff=${diffPct.toFixed(4)}% → ${keep ? "✅ behalten" : "❌ verworfen"}`
          );
        }
        return keep;
      });

      const over = filtered.filter(r => r.ccxt_price / scale > r.ftso_value);
      const under = filtered.filter(r => r.ccxt_price / scale < r.ftso_value);

      const avgOver = over.length
        ? over.reduce((sum, r) => sum + ((r.submitted ?? r.ccxt_price) / scale - r.ftso_value), 0) / over.length
        : 0;

      const avgUnder = under.length
        ? under.reduce((sum, r) => sum + (r.ftso_value - (r.submitted ?? r.ccxt_price) / scale), 0) / under.length
        : 0;

      const last2 = history.slice(0, 2);
      const forceOver = trend === "up" && last2.every(r => r.ccxt_price > r.ftso_value);
      const forceUnder = trend === "down" && last2.every(r => r.ccxt_price < r.ftso_value);

      this.logger.debug(
        `[${feed.name}] Last 2 diffs: ${last2.map(r => (r.ccxt_price - r.ftso_value).toFixed(6)).join(", ")}`
      );

      let adjusted = ccxtPrice;
      if (forceOver) adjusted -= avgOver / scale;
      else if (forceUnder) adjusted += avgUnder / scale;
      else {
        if (trend === "up") adjusted += avgUnder / scale;
        else if (trend === "down") adjusted -= avgOver / scale;
        else adjusted += (avgUnder - avgOver) / (2 * scale);
      }

      if (this.isDebug()) {
        this.logger.debug(
          `📊 [${feed.name}] Preisanpassung:\n` +
            `     Trend         = ${trend}\n` +
            `     avgOver       = ${avgOver}\n` +
            `     avgUnder      = ${avgUnder}\n` +
            `     forceOver     = ${forceOver}\n` +
            `     forceUnder    = ${forceUnder}\n` +
            `     Adjusted Price= ${adjusted}\n` +
            `     CCXT Price= ${ccxtPrice}`
        );
      }

      return adjusted;
    } catch (err) {
      this.logger.error(`❌ Fehler in adjustPrice(${feed.name}):`, err);
      return original;
    }
  }

  private async getTrend15s(feedName: string): Promise<"up" | "down" | "flat"> {
    const config = this.config.find(f => f.feed.name === feedName);
    if (!config || config.sources.length === 0) {
      this.logger.warn(`❗ Kein Source-Eintrag für ${feedName} gefunden.`);
      return "flat";
    }

    const priceDiffs: number[] = [];

    for (const { exchange, symbol } of config.sources) {
      const priceMap = this.latestPrice.get(symbol);
      const info = priceMap?.get(exchange);

      if (!info) continue;

      const ageMs = Date.now() - info.time;
      if (ageMs > 30_000) continue;

      priceDiffs.push(info.value);
    }

    if (priceDiffs.length < 2) return "flat";

    const first = priceDiffs[0];
    const last = priceDiffs.at(-1)!;
    const diff = last - first;
    const pct = (diff / first) * 100;

    if (this.isDebug()) {
      this.logger.debug(`[${feedName}] Preisentwicklung: ${first} → ${last} = ${pct.toFixed(4)}%`);
    }

    const trend = pct > 0.03 ? "up" : pct < -0.03 ? "down" : "flat";

    if (this.isDebug()) {
      this.logger.debug(`[${feedName}] 🔍 Berechneter Trend: ${trend.toUpperCase()} (${pct.toFixed(4)}%)`);
    }

    return trend;
  }

  private isDebug(): boolean {
    return process.env.LOG_LEVEL?.toLowerCase() === "debug";
  }
}
