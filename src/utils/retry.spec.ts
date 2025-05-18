import { retry, sleepFor, RetryError } from "./retry";
import { ILogger } from "./ILogger";

describe("Retry Utils", () => {
  describe("sleepFor", () => {
    it("should sleep at least given time", async () => {
      const start = Date.now();
      await sleepFor(100);
      const end = Date.now();
      expect(end - start).toBeGreaterThanOrEqual(90); // kleine Toleranz wegen Timerungenauigkeit
    });
  });

  describe("retry", () => {
    it("should succeed without retry", async () => {
      const result = await retry(() => Promise.resolve("success"));
      expect(result).toBe("success");
    });

    it("should retry on failure and eventually succeed", async () => {
      let attempts = 0;
      const result = await retry(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Fail");
        }
        return Promise.resolve("success");
      }, 5);
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should throw RetryError after max retries", async () => {
      let attempts = 0;
      await expect(
        retry(() => {
          attempts++;
          throw new Error("Always fail");
        }, 3)
      ).rejects.toThrow(RetryError);
      expect(attempts).toBe(3);
    });

    it("should pass logger warnings if provided", async () => {
      const logger: ILogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        fatal: jest.fn(),
        dir: jest.fn(),
      };

      await expect(
        retry(
          () => {
            throw new Error("Always fail");
          },
          2,
          10,
          logger
        )
      ).rejects.toThrow(RetryError);

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
