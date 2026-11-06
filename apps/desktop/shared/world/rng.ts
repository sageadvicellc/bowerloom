/**
 * A seeded number generator for the prototype's sample data (mulberry32, a 32-bit generator).
 * The same seed always gives the same numbers, so the sample world is the same on every run and every machine.
 * It reads no clock and no system random source. Every function here is pure apart from the generator's own counter.
 */

/** The generator: `next` draws from 0 up to (not including) 1, `int` from min to max inclusive, `pick` one list element, `shuffle` a new list. */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  shuffle<T>(list: readonly T[]): T[];
}

/** Makes a generator from a finite number. A seed with a fraction is cut to its whole part. */
export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) throw new Error('The seed must be a finite number.');
  let state = Math.trunc(seed) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`int needs whole numbers with min <= max, got ${min} and ${max}.`);
    return min + Math.floor(next() * (max - min + 1));
  };
  const pick = <T>(list: readonly T[]): T => {
    if (list.length === 0) throw new Error('Cannot pick from an empty list.');
    return list[int(0, list.length - 1)]!;
  };
  const shuffle = <T>(list: readonly T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const held = out[i]!;
      out[i] = out[j]!; out[j] = held;
    }
    return out;
  };
  return { next, int, pick, shuffle };
}
