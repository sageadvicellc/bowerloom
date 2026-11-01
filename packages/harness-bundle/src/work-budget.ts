/**
 * A bound on the work the loader does before it does it. The loader (`harness-definition`) is synchronous, and two of its costs depend on the content, not only on the size:
 *  - YAML: a parse costs about 0.7 microseconds a byte, and every `.yml` and `.yaml` file, and the frontmatter of every `.md` file, is parsed (twice or more);
 *  - the secret scan: its cost is in the number of places in a long token where a pattern can start, so 31 MiB of `a?a=a?a=` text took 7.4 s, where the same size of prose
 *    takes under one second.
 * Both costs are linear, so the sizes already bound them; these two budgets bound them tighter, from a quick count, so a small hostile bundle cannot take seconds. A bundle
 * over a budget is `BUNDLE_TOO_LARGE`. With the budgets, the worst bundle that passes costs the loader about 2 seconds on a recent laptop (README, "Limits").
 */
import type { DefinitionFile } from '../../harness-definition/src/index.js';
import { BundleRefusal } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import { turnTaker } from './turn.js';

/** The longest frontmatter block the loader reads (`DEFINITION_LIMITS.frontmatterBytes` is 64 KiB); a bit more is searched for its end. */
const FRONTMATTER_SEARCH = 70_000;

/** True for a character that ends a token of the secret scan: a space of any kind, a quote, a bracket, a separator, a bar, a backslash. */
const ends = (c: number): boolean =>
  c <= 0x20 || c === 0x22 || c === 0x27 || c === 0x60 || c === 0x2c || c === 0x3b || c === 0x28 || c === 0x29 || c === 0x5b || c === 0x5d || c === 0x3c || c === 0x3e
  || c === 0x7c || c === 0x5c || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f
  || c === 0x3000 || c === 0xfeff;

/**
 * The places in a text where the secret scan tries its patterns: in each token of 8 or more characters, each start of a run of letters and digits. It stops counting at `cap`.
 */
export function scanUnits(text: string, cap: number): number {
  let units = 0, length = 0, runs = 0, inRun = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (ends(c)) {
      if (length >= 8) { units += runs; if (units > cap) return units; }
      length = 0; runs = 0; inRun = false;
      continue;
    }
    length += 1;
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      if (!inRun) { runs += 1; inRun = true; }
    } else inRun = false;
  }
  return length >= 8 ? units + runs : units;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Bytes that the loader parses as YAML: a `.yml` or `.yaml` file whole, and the frontmatter block of a `.md` file. */
export function yamlBytes(file: DefinitionFile): number {
  const lower = file.path.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return file.bytes.length;
  if (!lower.endsWith('.md') || file.bytes.length < 4 || file.bytes[0] !== 0x2d || file.bytes[1] !== 0x2d || file.bytes[2] !== 0x2d) return 0;
  const head = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, Math.min(file.bytes.length, FRONTMATTER_SEARCH));
  const end = head.indexOf('\n---');
  return end === -1 ? head.length : end;
}

/** Refuses `BUNDLE_TOO_LARGE` when the files pass the YAML budget or the scan budget. Takes turns between files. */
export async function checkWorkBudget(files: readonly DefinitionFile[]): Promise<void> {
  const turn = turnTaker();
  let yaml = 0, units = 0;
  for (const file of files) {
    yaml += yamlBytes(file);
    if (yaml > BUNDLE_LIMITS.yamlBytes) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    let text: string;
    try { text = utf8.decode(file.bytes); } catch { text = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.length).toString('latin1'); }
    units += scanUnits(text, BUNDLE_LIMITS.scanUnits - units);
    if (units > BUNDLE_LIMITS.scanUnits) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    const wait = turn(); if (wait) await wait;
  }
}
