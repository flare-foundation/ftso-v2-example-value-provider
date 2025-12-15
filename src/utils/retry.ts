import { ILogger } from "./ILogger";
import { asError, errorString } from "./error";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export async function sleepFor(ms: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await new Promise((resolve: any) => {
    setTimeout(() => resolve(), ms);
  });
}

export class RetryError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause: cause });
  }
}
/** Retries the {@link action} {@link maxRetries} times until it completes without an error. */
export async function retry<T>(
  action: () => T,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  initialBackOffMs: number = DEFAULT_INITIAL_BACKOFF_MS,
  logger?: ILogger
): Promise<T> {
  let attempt = 1;
  let backoffMs = initialBackOffMs;
  while (attempt <= maxRetries) {
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      return await action();
    } catch (e) {
      const error = asError(e);
      logger?.warn(`Error in retry attempt ${attempt}/${maxRetries}: ${errorString(error)}`);
      attempt++;
      if (attempt > maxRetries) {
        throw new RetryError(`Failed to execute action after ${maxRetries} attempts`, error);
      }
      const randomisedBackOffMs = backoffMs / 2 + Math.floor(backoffMs * Math.random());
      await sleepFor(randomisedBackOffMs);
      backoffMs *= DEFAULT_BACKOFF_MULTIPLIER;
    }
  }

  throw new Error("Unreachable");
}
