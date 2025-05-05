import { Trade } from "ccxt";
import { Logger } from "@nestjs/common";

const HISTORY_SEC = 3600;

export class VolumeStore {
  private readonly logger = new Logger(VolumeStore.name);
  private readonly volumeSec = new Array<number>(HISTORY_SEC).fill(0);
  private lastTs: number | undefined = undefined;

  /** Test helper to access volumeSec (not for production!) */
  __getVolumeSecArrayForTestOnly(): number[] {
    return this.volumeSec;
  }

  processTrades(trades: Trade[]) {
    for (const trade of trades) {
      if (!trade.timestamp) {
        this.logger.warn(`Trade with missing timestamp: ${JSON.stringify(trade)}`);
        continue;
      }

      if (trade.timestamp < this.lastTs) {
        this.logger.debug(
          `Trade with timestamp ${trade.timestamp} is older than last processed trade ${this.lastTs}, skipping. Trade: ${JSON.stringify(trade)}`
        );
        continue;
      }

      const tSec = Math.floor(trade.timestamp / 1000);
      const lastTSec = this.lastTs ? this.toSec(this.lastTs) : tSec;

      for (let t = lastTSec + 1; t <= tSec; t++) {
        this.volumeSec[t % HISTORY_SEC] = 0;
      }

      const volume = this.calculateVolume(trade);
      this.volumeSec[tSec % HISTORY_SEC] += volume;
      this.lastTs = trade.timestamp;
      //this.logger.debug(`Trade verarbeitet für ${trade.symbol} mit Volumen: ${volume}`);
    }
  }

  getVolume(windowSec: number) {
    if (windowSec > HISTORY_SEC) {
      throw new Error(`Requested volume for ${windowSec} seconds, but only have ${HISTORY_SEC} seconds of history`);
    }
    if (!this.lastTs) {
      return 0;
    }

    const startSec = this.toSec(Date.now()) - windowSec;
    const endSec = this.toSec(this.lastTs);

    let volume = 0;
    for (let t = startSec; t < endSec; t++) {
      volume += this.volumeSec[t % HISTORY_SEC];
    }

    return volume;
  }

  private calculateVolume(trade: Trade) {
    return trade.amount * trade.price;
  }

  private toSec(ms: number) {
    return Math.floor(ms / 1000);
  }
}
