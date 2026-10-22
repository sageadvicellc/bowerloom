/**
 * The token estimate of `context measure` (spec 05, section 3.11). Bytes are exact. Tokens are bytes divided by a
 * constant, in integer math, because Claude has no public offline tokenizer. A token ratio therefore equals the byte
 * ratio. Pure.
 */
export const DEFAULT_BYTES_PER_TOKEN_MILLI = 4000;

/** `ceil(bytes * 1000 / round(bytesPerToken * 1000))`, with the second factor passed in thousandths. */
export function estimateTokens(bytes: number, bytesPerTokenMilli: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(bytesPerTokenMilli) || bytesPerTokenMilli <= 0) throw new RangeError('estimateTokens takes whole numbers.');
  const num = BigInt(bytes) * 1000n, den = BigInt(bytesPerTokenMilli);
  return Number((num + den - 1n) / den);
}
/** `floor(a * 1000000 / b)`: parts per million, floored. 0 when `b` is 0. */
export function ratioPpm(a: number, b: number): number {
  if (b === 0) return 0;
  return Number(BigInt(a) * 1000000n / BigInt(b));
}
const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** Tokens in thousands, floored to one decimal, with comma groups and a `k` suffix. */
export function formatThousands(tokens: number): string {
  return `${group(Math.floor(tokens / 1000))}.${Math.floor((tokens % 1000) / 100)}k`;
}
/** A ratio in parts per million as a percent, floored to two decimals. */
export function formatPercent(ppm: number): string {
  const hundredths = Math.floor(ppm / 100);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`;
}
/** `--bytes-per-token`: a decimal from 1.0 to 10.0 with at most three decimals. Returns thousandths, or null. */
export function parseBytesPerToken(text: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text);
  if (m === null) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return milli >= 1000 && milli <= 10000 ? milli : null;
}
/** The band text of the output. */
export const ESTIMATE_BAND = Object.freeze({ low: '3.0', high: '4.5' });
