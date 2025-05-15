import { FeedId, FeedValueData, FeedVolumeData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { CcxtFeed } from "./ccxt-provider-service";
import {
  getFeedDecimals,
  getFeedOnchainDecimals,
  getFeedId,
  getPriceHistory,
  storeSubmittedPrice,
  updateOnchainDecimalsIfNull,
} from "../utils/mysql";
import { priceStrategie01 } from "../utils/price-strategie01";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { FEED_MAP } from "../utils/feed-mapping";

type OnchainFeedEntry = {
  value: number;
  decimals: number;
};

export class FtsoCcxtFeed extends CcxtFeed implements BaseDataFeed {
  private currentVotingRoundId?: number;
  private onchainPriceMap: Map<string, OnchainFeedEntry> = new Map();

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const result = await super.getValue(feed); // ccxt price
    this.debug(`🔎 [${feed.name}] Live-Preis (CCXT): ${result.value}`);

    const dbDecimals = (await getFeedDecimals(feed.name)) ?? 8;
    let dbOnchainDecimals = await getFeedOnchainDecimals(feed.name);

    const onchain = this.onchainPriceMap.get(feed.name);
    const onchainValueRow = onchain?.value ?? 0;

    if (!dbOnchainDecimals) {
      await updateOnchainDecimalsIfNull(feed.name, onchain.decimals);
      dbOnchainDecimals = onchain.decimals;
    }

    const onchainDecimals = onchain?.decimals ?? dbDecimals;
    const onchainPriceDecimal = onchainValueRow / 10 ** onchainDecimals;
    this.debug(
      `🔗 [${feed.name}] Live-Preis (On-Chain): ${onchainPriceDecimal} (Scaled: ${onchainValueRow}, Decimals: ${onchainDecimals})`
    );
    // Hier kann man seine Preisstrategie Bauen Aktuell wird auf die Fungtion PriceStrategie01 verlinkt
    const adjustedValue = await this.PriceStrategie(
      result.value,
      feed,
      dbDecimals,
      dbOnchainDecimals,
      onchainPriceDecimal
    );

    //this.debug(`📝 [${feed.name}] Aktuelle VotingRoundId = ${this.currentVotingRoundId}`);

    if (this.currentVotingRoundId) {
      const submittedScaled = Math.round(adjustedValue * 10 ** dbDecimals);
      const ccxtScaled = Math.round(result.value * 10 ** dbDecimals);
      /*
      if (this.isDebug())
        this.logger.debug(
          `📤 [${feed.name}] Speichere Preisabgabe:\n` +
            `     Round         = ${this.currentVotingRoundId}\n` +
            `     Adjusted      = ${adjustedValue} (scaled=${submittedScaled})\n` +
            `     CCXT Raw      = ${result.value} (scaled=${ccxtScaled})\n` +
            `     Decimals      = ${dbDecimals}\n` +
            `     Onchain       = ${onchainPriceDecimal} (scaled=${onchainValueRow})`
        );
      */
      if (this.shouldStorePrices()) {
        await storeSubmittedPrice(feed.name, this.currentVotingRoundId, submittedScaled, ccxtScaled, onchainValueRow);
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
    for (const [symbol, entry] of Object.entries(onchainPrices)) {
      this.onchainPriceMap.set(symbol, entry);
    }

    return Promise.all(feeds.map(feed => this.getValue(feed)));
  }

  async getOnchainFeedValues(): Promise<Record<string, OnchainFeedEntry>> {
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
    const prices: Record<string, OnchainFeedEntry> = {};

    for (let i = 0; i < feedKeys.length; i++) {
      prices[feedKeys[i]] = {
        value: values[i],
        decimals: decimals[i],
      };
    }

    this.debug(`📊 On-chain Preise geladen – Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
    return prices;
  }

  async getVolumes(feeds: FeedId[], window: number): Promise<FeedVolumeData[]> {
    return super.getVolumes(feeds, window);
  }

  private async PriceStrategie(
    ccxt_price: number,
    feed: FeedId,
    decimals: number,
    onchaindecimals: number,
    onchainPrice: number
  ): Promise<number> {
    const feedId = await getFeedId(feed.name);
    if (!feedId) return ccxt_price;
    const history = await getPriceHistory(feedId, 30);
    //console.debug("[DEBUG] History raw:\n" + JSON.stringify(history, null, 2));
    let price: number | PromiseLike<number>;
    if (["USDT/USD", "USDC/USD", "USDX/USD", "USDS/USD"].includes(feed.name)) {
      if (this.isDebug()) {
        this.logger.debug(
          `\n######################################################################\n` +
            `📊 [${feed.name}] Aktuelle Preisanpassung (Strategie price last VotingRound)\n` +
            `────────────────────────────────────────────\n` +
            `   Adjusted Price       : ${history?.[0]?.ftso_price}\n` +
            `   CCXT Price (live)    : ${ccxt_price}\n` +
            `   ONCHAIN Price (live) : ${onchainPrice}\n` +
            `######################################################################\n`
        );
      }

      price = history?.[0]?.ftso_price;
    } else if (["BNB/USD"].includes(feed.name)) {
      price = priceStrategie01(feed, ccxt_price, onchainPrice, decimals, onchaindecimals, history, this.logger);
    } else {
      this.logger.debug(
        `\n######################################################################\n` +
          `📊 [${feed.name}] Aktuelle Preisanpassung (Default CCXT Price)\n` +
          `────────────────────────────────────────────\n` +
          `   Adjusted Price       : ${ccxt_price}\n` +
          `   CCXT Price (live)    : ${ccxt_price}\n` +
          `   ONCHAIN Price (live) : ${onchainPrice}\n` +
          `######################################################################\n`
      );
      price = ccxt_price;
    }
    return price;
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
