/**
 * The revision of a definition (section 9, rule 1; section 12, check 6): a hash over its canonical files, stable across
 * runs and machines.
 *
 * Canonical form of one file:
 * - Path: relative to the `.bowerloom` folder, `/` separators, Unicode NFC.
 * - The five machine files at the top (`harness.json`, `guardrails.json`, `hooks.json`, `mcp.json`, `sources.json`):
 *   the `canonicalJson` of the parsed value, so key order and spacing do not count. Array order counts.
 * - Any other file that is strict UTF-8 with no NUL: the text with CRLF and CR turned into LF.
 * - Any other file: its bytes.
 * Files are sorted by the UTF-8 bytes of their canonical path. The hash is SHA-256 over
 *   `bowerloom/harness-revision/v1\n`, then for each file `<path>\n<byte length>\n<bytes>\n`.
 * File modes, times, owners, and the folder location do not count.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { decodeText, parseStrictJson, toLf } from './json.js';
import type { DefinitionFile } from './types.js';

export const REVISION_PREFIX = 'sha256:' as const;
const DOMAIN = 'bowerloom/harness-revision/v1\n';
const MACHINE_JSON = new Set(['harness.json', 'guardrails.json', 'hooks.json', 'mcp.json', 'sources.json']);

/** The canonical bytes of one file, as the revision hashes them. */
export function canonicalBytes(file: DefinitionFile): Buffer {
  const text = decodeText(file.bytes);
  if (text === null) return Buffer.from(file.bytes);
  if (MACHINE_JSON.has(file.path)) {
    const parsed = parseStrictJson(text);
    if (parsed.ok) return Buffer.from(canonicalJson(parsed.value), 'utf8');
  }
  return Buffer.from(toLf(text), 'utf8');
}

/** The revision of a set of definition files. Two files with the same canonical path are a caller fault. */
export function computeRevision(files: readonly DefinitionFile[]): string {
  const rows = files.map(file => ({ path: Buffer.from(file.path.normalize('NFC'), 'utf8'), bytes: canonicalBytes(file) }));
  rows.sort((a, b) => Buffer.compare(a.path, b.path));
  const hash = createHash('sha256').update(DOMAIN, 'utf8');
  rows.forEach((row, i) => {
    if (i > 0 && Buffer.compare(rows[i - 1]!.path, row.path) === 0) throw new Error('computeRevision: two files share one canonical path.');
    hash.update(row.path).update(`\n${row.bytes.length}\n`, 'utf8').update(row.bytes).update('\n', 'utf8');
  });
  return REVISION_PREFIX + hash.digest('hex');
}
