/**
 * A bound on the work the loader does before it does it. The loader (`harness-definition`) is synchronous, and two of its costs depend on the content, not only on the size:
 *  - YAML: a parse costs about 0.7 microseconds a byte, and every `.yml` and `.yaml` file, and the frontmatter of every `.md` file, is parsed (twice or more);
 *  - the secret scan: its cost is in the number of places in a long token where a pattern can start, so 31 MiB of `a?a=a?a=` text took 7.4 s, where the same size of prose
 *    takes under one second.
 * Both costs are linear, so the sizes already bound them; these two budgets bound them tighter, from a quick count, so a small hostile bundle cannot take seconds. A bundle
 * over a budget is `BUNDLE_TOO_LARGE`. The worst bundle that passes both costs the loader a few seconds; the README, Work budgets, gives the figures measured.
 */
import type { DefinitionFile } from '../../harness-definition/src/index.js';
import { BundleRefusal } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import { turnTaker } from './turn.js';

/** The longest frontmatter block the loader reads (`DEFINITION_LIMITS.frontmatterBytes` is 64 KiB); a bit more is searched for its end. */
const FRONTMATTER_SEARCH = 70_000;
/** The fence of the loader (`packages/context-slices/src/frontmatter.ts`): `---`, then spaces or tabs, then the end of the line. */
const OPEN_FENCE = /^---[ \t]*(?:\n|$)/;
const CLOSE_FENCE = /\n---[ \t]*(?:\n|$)/;

/**
 * True for a character that ends a token of the secret scan, exactly as the scanner splits (`SPLIT` in `harness-definition/src/secrets.ts`): a character of `\s` in
 * JavaScript, or a quote, a bracket, a comma, a semicolon, a bar, a backslash. Not U+0085 and not the other control characters, which the scanner keeps inside a token.
 */
const ends = (c: number): boolean =>
  (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x22 || c === 0x27 || c === 0x60 || c === 0x2c || c === 0x3b || c === 0x28 || c === 0x29 || c === 0x5b || c === 0x5d
  || c === 0x3c || c === 0x3e || c === 0x7c || c === 0x5c || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f
  || c === 0x205f || c === 0x3000 || c === 0xfeff;

/**
 * The same for a file the scanner reads as bytes (not UTF-8, a BOM, or a NUL): `BINARY_SPLIT` there is every byte outside `!` to `~`, and the quote and bracket set. Such a
 * file has no `name: value` reading, only the patterns at the start of each run in a token of 8 or more printable characters.
 */
const endsBinary = (c: number): boolean =>
  c < 0x21 || c > 0x7e || c === 0x22 || c === 0x27 || c === 0x60 || c === 0x2c || c === 0x3b || c === 0x28 || c === 0x29 || c === 0x5b || c === 0x5d || c === 0x3c || c === 0x3e
  || c === 0x7c || c === 0x5c;

/**
 * The places in a text where the secret scan does work that depends on the content:
 *  - in each token of 8 or more characters, each start of a run of letters and digits (the scan tries its patterns there);
 *  - in each token that holds a `:` or an `=` (a `name: value` or `name=value`), one place, and one more for each `?` and `&` in it (the scan reads each piece).
 * It stops counting at `cap`.
 */
export function scanUnits(text: string, cap: number, binary = false): number {
  let units = 0, length = 0, runs = 0, inRun = false, assign = false, pieces = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (binary ? endsBinary(c) : ends(c)) {
      if (length >= 8) units += runs;
      if (assign) units += 1 + pieces;
      if (units > cap) return units;
      length = 0; runs = 0; inRun = false; assign = false; pieces = 0;
      continue;
    }
    length += 1;
    if (binary) { /* no name: value reading of a binary file */ } else if (c === 0x3a || c === 0x3d) assign = true;
    else if (c === 0x3f || c === 0x26) pieces += 1;
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      if (!inRun) { runs += 1; inRun = true; }
    } else inRun = false;
  }
  return units + (length >= 8 ? runs : 0) + (assign ? 1 + pieces : 0);
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Bytes that the loader parses as YAML: a `.yml` or `.yaml` file whole, and the frontmatter block of a `.md` file, found by the loader's own rule. The file must open with a
 * fence line (`---`, then spaces or tabs); the block runs to the next fence line, or, with none in the first 70,000 bytes, to the end of that head. A line such as `---x: 1`
 * is not a fence, so it cannot end the count early. Line breaks are read as the loader reads them (`\r\n` and `\r` are `\n`).
 */
export function yamlBytes(file: DefinitionFile): number {
  const lower = file.path.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return file.bytes.length;
  if (!lower.endsWith('.md') || file.bytes.length < 3 || file.bytes[0] !== 0x2d || file.bytes[1] !== 0x2d || file.bytes[2] !== 0x2d) return 0;
  const head = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, Math.min(file.bytes.length, FRONTMATTER_SEARCH)).toString('latin1').replace(/\r\n?/g, '\n');
  if (!OPEN_FENCE.test(head)) return 0;
  const end = CLOSE_FENCE.exec(head.slice(3));
  return end === null ? head.length : end.index + 3;
}

/** Refuses `BUNDLE_TOO_LARGE` when the files pass the YAML budget or the scan budget. Takes turns between files. */
export async function checkWorkBudget(files: readonly DefinitionFile[]): Promise<void> {
  const turn = turnTaker();
  let yaml = 0, units = 0;
  for (const file of files) {
    yaml += yamlBytes(file);
    if (yaml > BUNDLE_LIMITS.yamlBytes) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    // The loader reads a file as text when it is strict UTF-8 with no byte order mark and no NUL, and as bytes otherwise (`decodeText` in harness-definition).
    let text: string | null = null;
    if (!(file.bytes[0] === 0xef && file.bytes[1] === 0xbb && file.bytes[2] === 0xbf)) {
      try { text = utf8.decode(file.bytes); } catch { text = null; }
      if (text !== null && text.includes('\0')) text = null;
    }
    units += text !== null
      ? scanUnits(text, BUNDLE_LIMITS.scanUnits - units)
      : scanUnits(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.length).toString('latin1'), BUNDLE_LIMITS.scanUnits - units, true);
    if (units > BUNDLE_LIMITS.scanUnits) throw new BundleRefusal('BUNDLE_TOO_LARGE');
    const wait = turn(); if (wait) await wait;
  }
}
