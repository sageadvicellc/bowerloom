/**
 * The dive: what the Harnesses and Library screens show when a person opens a harness and then one of its parts.
 * Pure. It reads the state the screens already hold, so it adds no call to the engine API.
 */
import type { Harness, HarnessState, MissingRef, Part, PartKind } from './types.js';
import { fileNameOf } from './frontmatter.js';

/** The kinds in the order the dive lists them: skills and agents first. */
export const DIVE_KIND_ORDER: readonly PartKind[] = Object.freeze(['skill', 'agent', 'tool', 'context']);

export interface DiveGroup { readonly kind: PartKind; readonly parts: readonly Part[]; readonly missing: readonly MissingRef[] }

/** The parts of one harness, grouped by kind in dive order. A kind with nothing in it is left out. */
export function diveGroups(state: HarnessState, harness: Harness): DiveGroup[] {
  // One lookup table, so a harness of many parts costs one pass.
  const byId = new Map<string, Part>();
  for (const p of state.parts) if (!byId.has(p.id)) byId.set(p.id, p);
  const parts: Part[] = [];
  for (const id of harness.partIds) { const part = byId.get(id); if (part !== undefined) parts.push(part); }
  const groups: DiveGroup[] = [];
  for (const kind of DIVE_KIND_ORDER) {
    const held = parts.filter(p => p.kind === kind), missing = harness.missing.filter(m => m.kind === kind);
    if (held.length > 0 || missing.length > 0) groups.push({ kind, parts: held, missing });
  }
  return groups;
}

export interface PartOrigin {
  /** `found`: a place the reader scanned. `harness-folder`: a folder whose own harness names the part. `unknown`: the state holds no place for it. */
  readonly how: 'found' | 'harness-folder' | 'unknown';
  /** The label the part carries, such as "Made by you" or "Caveman plug-in". */
  readonly label: string;
  /** The place the reader found it in, written with `~`. Never a full path. */
  readonly place: string | null;
  readonly scope: 'home' | 'project' | null;
  readonly interfaceName: string | null;
  readonly version: string | null;
  readonly fileName: string | null;
  /** The folder name of the harness that names the part, for `harness-folder`. */
  readonly folder: string | null;
  /** How many other places hold a skill with the same text. */
  readonly sameTextElsewhere: number;
}

export function originOf(state: HarnessState, part: Part): PartOrigin {
  const source = part.fromHarness === undefined ? state.sources.find(s => s.id === part.origin) : undefined;
  const base = { label: part.source, version: part.version ?? null, fileName: part.path === '' ? null : fileNameOf(part.path) };
  const sameTextElsewhere = part.contentHash === undefined ? 0 : state.parts.filter(p => p.id !== part.id && p.kind === part.kind && p.contentHash === part.contentHash).length;
  if (part.fromHarness !== undefined) return { ...base, how: 'harness-folder', place: null, scope: null, interfaceName: null, fileName: null, folder: part.fromHarness, sameTextElsewhere };
  if (source === undefined) return { ...base, how: 'unknown', place: null, scope: null, interfaceName: null, folder: null, sameTextElsewhere };
  return { ...base, how: 'found', place: source.label ?? source.name, scope: source.scope ?? null, interfaceName: source.interfaceName === '' ? null : source.interfaceName, folder: null, sameTextElsewhere };
}

/** The lines of "Where it comes from", in simple words. Each is one short sentence. */
export function originLines(o: PartOrigin): string[] {
  const lines: string[] = [];
  if (o.label !== '') lines.push(`Comes from ${o.label}.`);
  if (o.how === 'found') {
    const kind = o.scope === 'home' ? 'your home folder' : o.scope === 'project' ? 'a project folder' : 'a folder';
    lines.push(`Found in ${o.place}, ${kind}.`);
    if (o.interfaceName !== null) lines.push(`Read for ${o.interfaceName}.`);
  } else if (o.how === 'harness-folder') lines.push(`Named by the harness of the folder ${o.folder}. Bowerloom did not read its file.`);
  else lines.push('Bowerloom has no record of the place it was found in.');
  if (o.version !== null) lines.push(`Version ${o.version}.`);
  if (o.fileName !== null) lines.push(`File: ${o.fileName}.`);
  if (o.sameTextElsewhere > 0) lines.push(`Same text in ${o.sameTextElsewhere} other ${o.sameTextElsewhere === 1 ? 'place' : 'places'}.`);
  return lines;
}
