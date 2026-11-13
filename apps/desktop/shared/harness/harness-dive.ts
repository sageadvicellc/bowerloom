/**
 * The dive: what the Harnesses and Library screens show when a person opens a harness and then one of its parts.
 * Pure. It reads the state the screens already hold, so it adds no call to the engine API.
 */
import type { Harness, HarnessState, MissingRef, Part, PartKind } from './types.js';

/** The kinds in the order the dive lists them: skills and agents first. */
export const DIVE_KIND_ORDER: readonly PartKind[] = Object.freeze(['skill', 'agent', 'tool', 'context']);

export interface DiveGroup { readonly kind: PartKind; readonly parts: readonly Part[]; readonly missing: readonly MissingRef[] }

export interface DiveView {
  readonly groups: readonly DiveGroup[];
  /** Ids the manifest lists that the state holds no part for, and that `harness.missing` does not name. Each is reported, never dropped. */
  readonly unresolved: readonly string[];
  /** Ids this harness holds that two or more parts of the state share. The dive shows the first part of each. */
  readonly duplicates: readonly string[];
  /** True only when the manifest lists no part and names none as missing. */
  readonly empty: boolean;
}

/**
 * The parts of one harness, grouped by kind in dive order, with what could not be shown. A kind with nothing in it is left out.
 * A repeated id in the manifest counts once, so no row repeats.
 */
export function diveView(state: HarnessState, harness: Harness): DiveView {
  // One lookup table, so a harness of many parts costs one pass.
  const byId = new Map<string, Part>(), counts = new Map<string, number>();
  for (const p of state.parts) { counts.set(p.id, (counts.get(p.id) ?? 0) + 1); if (!byId.has(p.id)) byId.set(p.id, p); }
  const ids = [...new Set(harness.partIds)];
  const missingById = new Map<string, MissingRef>();
  for (const m of harness.missing) if (!missingById.has(m.id)) missingById.set(m.id, m);
  const parts: Part[] = [], unresolved: string[] = [], duplicates: string[] = [];
  for (const id of ids) {
    const part = byId.get(id);
    if (part !== undefined) { parts.push(part); if ((counts.get(id) ?? 0) > 1) duplicates.push(id); } else if (!missingById.has(id)) unresolved.push(id);
  }
  const missingAll = [...missingById.values()];
  const groups: DiveGroup[] = [];
  for (const kind of DIVE_KIND_ORDER) {
    const held = parts.filter(p => p.kind === kind), missing = missingAll.filter(m => m.kind === kind);
    if (held.length > 0 || missing.length > 0) groups.push({ kind, parts: held, missing });
  }
  return { groups, unresolved, duplicates, empty: harness.partIds.length === 0 && harness.missing.length === 0 };
}

export const diveGroups = (state: HarnessState, harness: Harness): DiveGroup[] => [...diveView(state, harness).groups];

export interface PartOrigin {
  /**
   * `found`: a place the reader scanned. `harness-folder`: a folder whose own harness names the part. `source-missing`: the part names a source the scan does not hold.
   * `unknown`: the part names no place at all.
   */
  readonly how: 'found' | 'harness-folder' | 'source-missing' | 'unknown';
  /** The label the part carries, such as "Made by you" or "Caveman plug-in". */
  readonly label: string;
  /** The folder the reader found it in, written with `~`. Never a full path. Null when the source has no label. */
  readonly place: string | null;
  /** The name of the source, for `found`. */
  readonly sourceName: string | null;
  readonly scope: 'home' | 'project' | null;
  readonly interfaceName: string | null;
  readonly version: string | null;
  /** The name of the file, with its extension. Null unless the last segment of the path ends in a known file extension, so no folder name of the person leaks. */
  readonly fileName: string | null;
  /** The folder name of the harness that names the part, for `harness-folder`. */
  readonly folder: string | null;
  /** How many other skills hold the same text. Skills only. */
  readonly sameTextElsewhere: number;
}

/** The file extensions the dive shows. Any other last segment may be a folder with a dot in its name, so it is never shown. */
const FILE_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'mdc', 'markdown', 'json', 'jsonc', 'toml', 'yaml', 'yml', 'txt']);

/** The last part of a path, split on either slash. Null unless it is a name with a known file extension, so a folder path never shows. */
export function plainFileName(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? name : null;
}

export function originOf(state: HarnessState, part: Part): PartOrigin {
  const base = { label: part.source, version: part.version ?? null, fileName: plainFileName(part.path) };
  const sameTextElsewhere = part.kind !== 'skill' || part.contentHash === undefined || part.contentHash === '' ? 0
    : state.parts.filter(p => p.id !== part.id && p.kind === 'skill' && p.contentHash === part.contentHash).length;
  if (part.fromHarness !== undefined) return { ...base, how: 'harness-folder', place: null, sourceName: null, scope: null, interfaceName: null, fileName: null, folder: part.fromHarness, sameTextElsewhere };
  if (part.origin === '') return { ...base, how: 'unknown', place: null, sourceName: null, scope: null, interfaceName: null, folder: null, sameTextElsewhere };
  const source = state.sources.find(s => s.id === part.origin);
  if (source === undefined) return { ...base, how: 'source-missing', place: null, sourceName: null, scope: null, interfaceName: null, folder: null, sameTextElsewhere };
  return {
    ...base, how: 'found', place: source.label === undefined || source.label === '' ? null : source.label, sourceName: source.name, scope: source.scope ?? null,
    interfaceName: source.interfaceName === '' ? null : source.interfaceName, folder: null, sameTextElsewhere,
  };
}

/** The lines of "Where it comes from", in simple words. Each is one short sentence. */
export function originLines(o: PartOrigin): string[] {
  const lines: string[] = [];
  if (o.label !== '') lines.push(`Comes from ${o.label}.`);
  if (o.how === 'found') {
    if (o.place === null) lines.push(`Found in the source ${o.sourceName}.`);
    else lines.push(`Found in ${o.place}, ${o.scope === 'home' ? 'your home folder' : o.scope === 'project' ? 'a project folder' : 'a folder'}.`);
    if (o.interfaceName !== null) lines.push(`Read for ${o.interfaceName}.`);
  } else if (o.how === 'harness-folder') lines.push(`Named by the harness of the folder ${o.folder}. Bowerloom did not read its file.`);
  else if (o.how === 'source-missing') lines.push('The source of this part is not in the scan.');
  else lines.push('Bowerloom has no record of the place it was found in.');
  if (o.version !== null) lines.push(`Version ${o.version}.`);
  if (o.fileName !== null) lines.push(`File: ${o.fileName}.`);
  if (o.sameTextElsewhere > 0) lines.push(`Same text in ${o.sameTextElsewhere} other ${o.sameTextElsewhere === 1 ? 'place' : 'places'}.`);
  return lines;
}
