import { VolumeStore } from "./volumes";
import { Trade } from "ccxt";

describe("VolumeStore", () => {
  let volumeStore: VolumeStore;

  beforeEach(() => {
    volumeStore = new VolumeStore();
  });

  it("should correctly process a single trade", () => {
    const tradeTimestampMs = Date.now();
    const tradeTimestampSec = Math.floor(tradeTimestampMs / 1000);

    const trade: Trade = {
      id: "1",
      timestamp: tradeTimestampMs,
      datetime: new Date(tradeTimestampMs).toISOString(),
      symbol: "BTC/USDT",
      order: "order-id",
      side: "buy",
      price: 50000,
      amount: 0.05,
      cost: 2500,
      fee: undefined,
      takerOrMaker: undefined,
      type: undefined,
      info: {},
    };

    volumeStore.processTrades([trade]);

    // Zugriff über die Test-Hilfsmethode
    const volumeSec = volumeStore.__getVolumeSecArrayForTestOnly();
    const volumeIndex = tradeTimestampSec % 3600;
    const storedVolume = volumeSec[volumeIndex];

    expect(storedVolume).toBeCloseTo(2500, 2); // direkt prüfen
  });
});
