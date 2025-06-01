// utils/onchain.ts

import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { FEED_MAP } from "./feed-mapping";
import { readFileSync } from "fs";
import { join } from "path";

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

export type OnchainFeedEntry = {
  value: number;
  decimals: number;
};

export async function fetchOnchainPrices(
  rpcUrl: string,
  fallbackPath: string,
  logger: { log: Function; warn: Function; error: Function }
): Promise<Record<string, OnchainFeedEntry>> {
  const web3 = new Web3(rpcUrl);
  const contract = new web3.eth.Contract(ABI, "0x7BDE3Df0624114eDB3A67dFe6753e62f4e7c1d20");
  const feedIds = Object.values(FEED_MAP).map(hex => web3.utils.hexToBytes(hex));

  try {
    const raw = await contract.methods.getFeedsById(feedIds).call({ value: "1" });

    const valuesRaw = raw[0];
    const decimalsRaw = raw[1];
    const timestampRaw = raw[2];

    if (!Array.isArray(valuesRaw) || !Array.isArray(decimalsRaw) || (!timestampRaw && timestampRaw !== 0)) {
      const fallbackRaw = JSON.stringify(raw, (_, v) => (typeof v === "bigint" ? v.toString() : v));
      logger.warn(`⚠️ Unerwartete Struktur vom RPC erhalten. Verwende Fallbacks. Raw: ${fallbackRaw}`);
      return loadFallbackPricesFromDisk(fallbackPath, logger);
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

    logger.log(`📊 On-chain Preise geladen – Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
    return prices;
  } catch (e) {
    logger.error(`❌ RPC Fehler – nutze Fallbacks: ${(e as Error).message}`);
    return loadFallbackPricesFromDisk(fallbackPath, logger);
  }
}

function loadFallbackPricesFromDisk(
  fallbackPath: string,
  logger: { warn: Function }
): Record<string, OnchainFeedEntry> {
  const result: Record<string, OnchainFeedEntry> = {};

  try {
    const raw = readFileSync(fallbackPath, "utf-8");
    const fallback: Record<string, number> = JSON.parse(raw);

    for (const [symbol, value] of Object.entries(fallback)) {
      result[symbol] = {
        value,
        decimals: 8,
      };
    }
  } catch (err) {
    logger.warn(`⚠️ fallback-prices.json konnte nicht geladen werden: ${err}`);
  }

  return result;
}
