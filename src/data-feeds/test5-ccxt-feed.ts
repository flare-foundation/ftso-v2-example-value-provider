import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getFeedDecimals, storeSubmittedPrice, getPriceHistory, getFeedId } from "../utils/mysql";
import * as ccxt from "ccxt";

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

      if (this.isDebug()) {
        this.logger.debug(`[${feed.name}] Filtered: ${filtered.length}, Over: ${over.length}, Under: ${under.length}`);

        if (over.length > 0) {
          this.logger.debug(`[${feed.name}] Over Details:`);
          over.forEach((r, i) => {
            const diff = r.ccxt_price / scale - r.ftso_value;
            const submitted_unscaled = r.submitted ? r.submitted / scale : null;

            this.logger.debug(
              `  #${i + 1}: CCXT=${(r.ccxt_price / scale).toFixed(8)}, FTSO=${r.ftso_value}, Submitted=${submitted_unscaled}, Diff=${diff.toFixed(8)}`
            );
          });
        }

        if (under.length > 0) {
          this.logger.debug(`[${feed.name}] Under Details:`);
          under.forEach((r, i) => {
            const diff = r.ftso_value - r.ccxt_price / scale;
            const submitted_unscaled = r.submitted ? r.submitted / scale : null;

            this.logger.debug(
              `  #${i + 1}: CCXT=${(r.ccxt_price / scale).toFixed(8)}, FTSO=${r.ftso_value}, Submitted=${submitted_unscaled}, Diff=${diff.toFixed(8)}`
            );
          });
        }
      }

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
        else adjusted -= avgOver / scale;
      }

      if (this.isDebug()) {
        this.logger.debug(
          `📊 [${feed.name}] Preisanpassung:\n` +
            `     Trend         = ${trend}\n` +
            `     avgOver       = ${avgOver}\n` +
            `     avgUnder      = ${avgUnder}\n` +
            `     forceOver     = ${forceOver}\n` +
            `     forceUnder    = ${forceUnder}\n` +
            `     Adjusted Price= ${adjusted}`
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

    const trendChecks = config.sources.map(async ({ exchange: exchangeName, symbol }) => {
      try {
        // Reuse exchange instance
        if (!this.trendExchanges.has(exchangeName)) {
          const ExchangeClass = ccxt[exchangeName as keyof typeof ccxt];
          if (typeof ExchangeClass !== "function") return null;
          const instance = new (ExchangeClass as unknown as new (params: any) => ccxt.Exchange)({
            enableRateLimit: true,
          });
          this.trendExchanges.set(exchangeName, instance);
        }
        const exchange = this.trendExchanges.get(exchangeName);

        // Load markets once per exchange
        const marketKey = `${exchangeName}:${symbol}`;
        if (!this.trendMarketsLoaded.has(marketKey)) {
          await exchange.loadMarkets();
          if (!(symbol in exchange.markets)) return null;
          this.trendMarketsLoaded.add(marketKey);
        }

        const candles = await exchange.fetchOHLCV(symbol, "1m", undefined, 2);
        if (candles.length < 2) return null;

        const open = candles[0][1];
        const close = candles.at(-1)?.[4];
        return close > open ? "up" : close < open ? "down" : "flat";
      } catch (err) {
        this.logger.warn(`⚠️ Trend-Check-Fehler bei ${exchangeName}/${symbol}: ${(err as Error).message}`);
        return null;
      }
    });

    const resultsRaw = await Promise.allSettled(trendChecks);
    const results = resultsRaw
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<"up" | "down" | "flat">).value);

    if (results.includes("up") && !results.includes("down")) return "up";
    if (results.includes("down") && !results.includes("up")) return "down";
    return "flat";
  }

  private isDebug(): boolean {
    return process.env.LOG_LEVEL?.toLowerCase() === "debug";
  }
}
