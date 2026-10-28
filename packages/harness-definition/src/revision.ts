/**
 * The revision of a definition (section 9, rule 1; section 12, check 6): a hash over its canonical files, stable across
 * runs and machines.
 *
 * Canonical form of one file:
 * - Path: relative to the `.bowerloom` folder, `/` separators, Unicode NFC.
 * - The five machine files at the top (`harness.json`, `guardrails.json`, `hooks.json`, `mcp.json`, `sources.json`):
 *   the `canonicalJson` of the parsed value, so key order and spacing do not count. Array order counts. A machine file
 *   that is not strict JSON has no canonical form: `canonicalBytes` throws.
 * - A Markdown file (`.md`) outside `scripts/` and `engines/`: the text with CRLF and CR turned into LF.
 * - Any other file: its bytes, unchanged. Scripts and engine-private files are hashed exactly as written.
 * - The execute bit: `x` or `-`.
 * Files are sorted by the UTF-8 bytes of their canonical path. The hash is SHA-256 over
 *   `bowerloom/harness-revision/v2\n`, then for each file `<path>\n<x or ->\n<byte length>\n<bytes>\n`.
 * Times, owners, other mode bits, and the folder location do not count. A file system with no execute bit, such as
 * one on Windows, reads every file as not executable.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { decodeText, parseStrictJson, toLf } from './json.js';
import type { DefinitionFile } from './types.js';

export const REVISION_PREFIX = 'sha256:' as const;
const DOMAIN = 'bowerloom/harness-revision/v2\n';
const MACHINE_JSON = new Set(['harness.json', 'guardrails.json', 'hooks.json', 'mcp.json', 'sources.json']);

/** The canonical bytes of one file, as the revision hashes them. */
export function canonicalBytes(file: DefinitionFile): Buffer {
  if (MACHINE_JSON.has(file.path)) {
    const text = decodeText(file.bytes);
    const parsed = text === null ? null : parseStrictJson(text);
    if (!parsed?.ok) throw new Error(`canonicalBytes: ${file.path} is not strict JSON, so it has no canonical form.`);
    return Buffer.from(canonicalJson(parsed.value), 'utf8');
  }
  if (file.path.endsWith('.md') && !/^(?:scripts|engines)\//.test(file.path)) {
    const text = decodeText(file.bytes);
    if (text !== null) return Buffer.from(toLf(text), 'utf8');
  }
  return Buffer.from(file.bytes);
}

/** The revision of a set of definition files. Two files with the same canonical path are a caller fault. */
export function computeRevision(files: readonly DefinitionFile[]): string {
  const rows = files.map(file => ({ path: Buffer.from(file.path.normalize('NFC'), 'utf8'), x: file.executable === true, bytes: canonicalBytes(file) }));
  rows.sort((a, b) => Buffer.compare(a.path, b.path));
  const hash = createHash('sha256').update(DOMAIN, 'utf8');
  rows.forEach((row, i) => {
    if (i > 0 && Buffer.compare(rows[i - 1]!.path, row.path) === 0) throw new Error('computeRevision: two files share one canonical path.');
    hash.update(row.path).update(`\n${row.x ? 'x' : '-'}\n${row.bytes.length}\n`, 'utf8').update(row.bytes).update('\n', 'utf8');
  });
  return REVISION_PREFIX + hash.digest('hex');
}
