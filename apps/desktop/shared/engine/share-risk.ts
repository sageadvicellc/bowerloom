/**
 * The one rule for which rows of a bundle summary come first before a list is cut at SHARE_LIST_LIMIT (shared/engine/types.ts). The sample bridge and main both import it,
 * so a cut never hides a row that starts a program, reaches a host, or sends a value further than another. A row with a higher key comes first; rows with an equal key keep
 * the order of the file. The cut changes what is SHOWN only: the acknowledgement of a plan hashes every row of the bundle, shown or not.
 */
import { SHARE_LIST_LIMIT } from './types.js';
import type { ShareCodeFile, ShareSecret, ShareTool } from './types.js';

/** Puts the rows with the highest risk first (stable among equals), then cuts the list at SHARE_LIST_LIMIT and counts what the cut left out. */
export function capRiskFirst<T>(rows: readonly T[], risk: (row: T) => number): { readonly rows: readonly T[]; readonly more: number } {
  const sorted = rows.map((row, i) => ({ row, i, r: risk(row) })).sort((a, b) => b.r - a.r || a.i - b.i).map(x => x.row);
  return { rows: sorted.slice(0, SHARE_LIST_LIMIT), more: Math.max(0, sorted.length - SHARE_LIST_LIMIT) };
}
/** A tool that starts a program ranks above one that reaches a host, which ranks above the rest; an odd address adds one. */
export const toolRisk = (t: ShareTool): number => (t.runsCode ? 4 : 0) + (t.host !== null ? 2 : 0) + (t.flags.length > 0 ? 1 : 0);
/** A file that runs ranks above a manifest or a code name, which rank above a file that is only not plain data. */
export const codeRisk = (f: ShareCodeFile): number => ({ executable: 5, hook: 5, script: 4, shebang: 4, binary: 4, manifest: 3, extension: 2, 'not-data': 1 })[f.why];
/** A value in an address, an argument, a command or a header goes further than one in an environment value; a named host ranks above none. */
export const secretRisk = (s: ShareSecret): number => Math.max(0, ...s.sinks.map(k => ({ url: 4, arg: 3, command: 3, header: 3, env: 1 })[k.field] + (k.host !== null ? 1 : 0)));
