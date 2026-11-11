/**
 * A small reader for Prometheus text. It takes the names it is asked for and nothing else. It never evaluates a value as code: a value is a plain decimal number
 * (a sign, digits, a dot, an exponent) or it is dropped. NaN, infinity and a number too large to hold are dropped, so a figure is never invented.
 */

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** A line longer than this is not a metric line of a llama-server. It is skipped without being read further. */
const MAX_LINE = 1024;

/** The value of each wanted metric that has one plain number. A name with labels is skipped. A name that appears twice keeps its first value. */
export function parsePrometheus(text: unknown, wanted: readonly string[]): Map<string, number> {
  const found = new Map<string, number>();
  if (typeof text !== 'string' || wanted.length === 0) return found;
  const names = new Set(wanted);
  for (const raw of text.split('\n')) {
    if (raw.length > MAX_LINE) continue;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) continue;
    const name = parts[0] as string, value = parts[1] as string;
    if (!names.has(name) || found.has(name)) continue;
    if (!NUMBER.test(value)) continue;
    const number = Number(value);
    if (Number.isFinite(number)) found.set(name, number);
  }
  return found;
}
