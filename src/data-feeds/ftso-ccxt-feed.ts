import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import { getFeedDecimals, getFeedId, getPriceHistory, storeSubmittedPrice } from "../utils/mysql";
import { adjustPrice } from "../utils/price-adjustment";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { FEED_MAP } from "../utils/feed-mapping";

export class FtsoCcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;
  private onchainPriceMap: Map<string, number> = new Map();

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    this.debug(`🔎 [${feed.name}] Live-Preis (CCXT): ${result.value}`);

    const decimals = (await getFeedDecimals(feed.name)) ?? 8;
    this.debug(`ℹ️ [${feed.name}] Decimals aus DB: ${decimals}`);

    const onchainPrice = this.onchainPriceMap.get(feed.name);
    this.debug(`🔗 [${feed.name}] On-Chain Preis (aus Cache): ${onchainPrice}`);

    const adjustedValue = await this.adjustPrice(result.value, feed, decimals);

    this.debug(`📝 [${feed.name}] Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

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

      if (this.shouldStorePrices()) {
        await storeSubmittedPrice(feed.name, this.currentVotingRoundId, submittedScaled, ccxtScaled, onchainPrice);
      }
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
      this.debug(`🆔 getValues Setze VotingRoundId auf ${votingRoundId}`);
      this.currentVotingRoundId = votingRoundId;
    }

    const onchainPrices = await this.getOnchainFeedValues();
    this.onchainPriceMap.clear();
    for (const [symbol, value] of Object.entries(onchainPrices)) {
      this.onchainPriceMap.set(symbol, value);
    }

    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getOnchainFeedValues(): Promise<Record<string, number>> {
    const web3 = new Web3(this.getFlareRPC());

    const ABI: AbiItem[] = [
      {
        name: "getFeedsById",
        type: "function",
        stateMutability: "payable",
        inputs: [{ internalType: "bytes21[]", name: "_feedIds", type: "bytes21[]" }],
        outputs: [
          { internalType: "uint256[]", name: "", type: "uint256[]" },
          { internalType: "int8[]", name: "", type: "int8[]" },
          { internalType: "uint64", name: "", type: "uint64" },
        ],
      },
    ];

    const contract = new web3.eth.Contract(ABI, "0x7BDE3Df0624114eDB3A67dFe6753e62f4e7c1d20");
    const feedIds = Object.values(FEED_MAP).map(hex => web3.utils.hexToBytes(hex));

    let raw: unknown;
    try {
      raw = await contract.methods.getFeedsById(feedIds).call({ value: "1" });
    } catch (e) {
      throw new Error(`❌ Smart Contract call failed: ${(e as Error).message}`);
    }

    // → Zugriff wie auf Tuple-Array simulieren
    const valuesRaw = raw[0];
    const decimalsRaw = raw[1];
    const timestampRaw = raw[2];

    if (!Array.isArray(valuesRaw) || !Array.isArray(decimalsRaw) || (!timestampRaw && timestampRaw !== 0)) {
      const fallback = JSON.stringify(raw, (_, v) => (typeof v === "bigint" ? v.toString() : v));
      throw new Error(`FTSO RPC call returned unexpected structure. Raw: ${fallback}`);
    }

    const values = valuesRaw.map(v => Number(v));
    const decimals = decimalsRaw.map(v => Number(v));
    const timestamp = Number(timestampRaw);

    const feedKeys = Object.keys(FEED_MAP);
    const prices: Record<string, number> = {};

    for (let i = 0; i < feedKeys.length; i++) {
      prices[feedKeys[i]] = values[i] / 10 ** decimals[i];
    }

    this.debug(`📊 On-chain Preise geladen – Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
    return prices;
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private async adjustPrice(original: number, feed: FeedId, decimals: number): Promise<number> {
    const feedId = await getFeedId(feed.name);
    if (!feedId) return original;
    const [history, trend] = await Promise.all([getPriceHistory(feedId, 30), this.getTrend15s(feed.name)]);

    let price: number | PromiseLike<number>;
    if (["USDT/USD", "USDC/USD", "USDX/USD", "USDS/USD"].includes(feed.name)) {
      price = history?.[0]?.ftso_value;
    } else if (["ADA/USD", "AAVE/USD", "SGB/USD"].includes(feed.name)) {
      price = original;
    } else {
      price = adjustPrice(feed, original, decimals, history, trend, this.logger);
    }
    return price;
  }

  private async getTrend15s(feedName: string): Promise<"up" | "down" | "flat"> {
    const config = this.config.find(f => f.feed.name === feedName);
    if (!config || config.sources.length === 0) {
      this.logger.warn(`❗ Kein Source-Eintrag für ${feedName} gefunden.`);
      return "flat";
    }

    const prices: number[] = [];

    for (const { exchange, symbol } of config.sources) {
      const priceMap = this.latestPrice.get(symbol);
      const info = priceMap?.get(exchange);
      if (!info) continue;

      const age = Date.now() - info.time;
      if (age > 30_000) continue;

      prices.push(info.value);
    }

    if (prices.length < 2) return "flat";

    const [first, last] = [prices[0], prices.at(-1)!];
    const pct = ((last - first) / first) * 100;
    const trend = pct > 0.03 ? "up" : pct < -0.03 ? "down" : "flat";

    if (this.isDebug()) {
      this.logger.debug(`[${feedName}] 🔍 Preisentwicklung (live): ${first} → ${last} = ${pct.toFixed(4)}%`);
      this.logger.debug(`[${feedName}] 🔍 Berechneter Trend: ${trend.toUpperCase()} (${pct.toFixed(4)}%)`);
    }

    return trend;
  }


  private getFlareRPC(): string {
    return process.env.FLARE_RPC;
  }

  private shouldStorePrices(): boolean {
    return process.env.ENABLE_PRICE_STORAGE?.toLowerCase() === "true";
  }

  private isDebug(): boolean {
    return process.env.LOG_LEVEL?.toLowerCase() === "debug";
  }

  private debug(msg: string) {
    if (this.isDebug()) this.logger.debug(msg);
  }
}
