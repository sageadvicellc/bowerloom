/**
 * The acknowledgements: the hashes a person's tick names. They depend on the summary only.
 * A tick covers what the person was shown. So the hash binds the plan (`revision`) and the content of each thing shown: the whole entry of each tool that
 * runs code (`BundleTool.sha256`), the `(path, sha256)` of each file that can run, and each foreign-path hit with the hash of its text. A change to any of them
 * changes the hash, and main refuses a write whose acknowledgement is not the one it computes now (IMPORT_NEEDS_ACKNOWLEDGEMENT, EXPORT_NEEDS_ACKNOWLEDGEMENT).
 */
import { createHash } from 'node:crypto';
import { BundleRefusal } from './codes.js';
import { HIGH_RISK_SINK_FIELDS } from './types.js';
import type { BundleSummary } from './types.js';

const checkedRevision = (revision: unknown): string => {
  if (typeof revision !== 'string' || revision === '' || revision.length > 200) throw new BundleRefusal('BUNDLE_USAGE');
  return revision;
};
const rows = (list: readonly (readonly unknown[])[]): string[] => list.map(row => JSON.stringify(row)).sort();
const hashOf = (domain: string, revision: string, parts: Record<string, readonly string[]>): string =>
  createHash('sha256').update(JSON.stringify([domain, revision, parts])).digest('hex');

/** The foreign paths of a summary as rows: where, which line, and the hash of the matched text. */
const foreignRows = (summary: BundleSummary): string[] => rows(summary.foreignPaths.map(f => [f.path, f.line ?? null, f.sha256]));

/**
 * The hash that an export acknowledgement names: the revision of the plan and the foreign paths of the summary (path, line, hash of the text). Lowercase hex, 64
 * characters. Null when there are no foreign paths, so nothing needs a tick. `revision` is the plan's revision, the lowercase hex SHA-256 of the bundle bytes.
 */
export function exportAcknowledgement(summary: BundleSummary, revision: string): string | null {
  const rev = checkedRevision(revision);
  const foreign = foreignRows(summary);
  return foreign.length === 0 ? null : hashOf('bowerloom/acknowledge-export/v1', rev, { foreign });
}

/**
 * The hash that an import acknowledgement names. It binds the plan's `revision` (the save plan's revision) and, for what the person was shown:
 *  - every tool that runs code (a stdio MCP server, a hook) or reaches a host (a remote MCP server): its kind, name and the hash of its whole entry. A bundle with
 *    only an `mcp.json` is covered;
 *  - every reference that sits in a url, an argument, a command or a header (HIGH_RISK_SINK_FIELDS): its name, kind and sinks. A reference in `env` alone (a stdio
 *    server, already ticked as a tool) adds nothing;
 *  - every file that can run: `(path, why, sha256)`;
 *  - `executables`, the paths a save would write with an execute bit;
 *  - every foreign-path hit: `(path, line, hash of the text)`.
 * `executables` may repeat and come in any order: the hash is of the sorted, unique list. Lowercase hex, 64 characters. Null when all five are empty.
 */
export function importAcknowledgement(summary: BundleSummary, executables: readonly string[], revision: string): string | null {
  const rev = checkedRevision(revision);
  // A tool needs a tick when it runs code or reaches a host (a remote server is a host the file chose).
  const tools = rows(summary.tools.filter(t => t.runsCode || t.host !== undefined).map(t => [t.kind, t.name, t.sha256]));
  const secrets = rows(summary.secrets
    .map(s => [s.kind, s.name, rows(s.sinks.filter(k => HIGH_RISK_SINK_FIELDS.includes(k.field)).map(k => [k.tool, k.field, k.host ?? null]))] as const)
    .filter(([, , sinks]) => sinks.length > 0));
  const files = rows(summary.codeFiles.map(f => [f.path, f.why, f.sha256]));
  const exec = rows([...new Set(executables)].map(p => [p]));
  const foreign = foreignRows(summary);
  if (tools.length + secrets.length + files.length + exec.length + foreign.length === 0) return null;
  return hashOf('bowerloom/acknowledge-import/v1', rev, { tools, secrets, files, exec, foreign });
}
