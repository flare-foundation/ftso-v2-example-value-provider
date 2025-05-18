export interface ILogger {
  log(message: unknown, ...optionalParams: unknown[]): unknown;
  error(message: unknown, ...optionalParams: unknown[]): unknown;
  warn(message: unknown, ...optionalParams: unknown[]): unknown;
  debug?(message: unknown, ...optionalParams: unknown[]): unknown;
  verbose?(message: unknown, ...optionalParams: unknown[]): unknown;
  fatal?(message: unknown, ...optionalParams: unknown[]): unknown;
  dir?(message: unknown, ...optionalParams: unknown[]): unknown;
}
