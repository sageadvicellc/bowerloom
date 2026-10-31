/**
 * The difference between two versions (spec 6.6), worked out from the two snapshot texts. It reports what a person would name:
 * items (skills, agents, tools, slices shown as items), slice rules, and the project choices that hide or replace an item.
 * Names come out sorted, so the same pair always gives the same answer. Bad text is reported as `unreadable`, never thrown.
 * Pure: no clock, no random number, no file.
 */

export type DiffKind = 'skill' | 'agent' | 'tool' | 'slice' | 'override';
export type DiffChange = 'added' | 'removed' | 'changed';

/** One line of the difference, for a list on screen. */
export interface DiffEntry { readonly change: DiffChange; readonly kind: DiffKind; readonly name: string }

export interface VersionDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly entries: readonly DiffEntry[];
  /** True when one of the two texts is not a harness snapshot. */
  readonly unreadable: boolean;
}

type Snap = string | { readonly snapshotJson: string };
type Keyed = Map<string, { name: string; kind: DiffKind; body: string }>;

/** The same value as text with the keys in order, so two equal values always give the same text. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback);

function keyed(snapshot: Snap): Keyed | null {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof snapshot === 'string' ? snapshot : snapshot.snapshotJson); } catch { return null; }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) return null;
  const out: Keyed = new Map();
  const items = list(parsed.items).filter(isRecord);
  const itemName = new Map(items.map(i => [str(i.id, ''), str(i.name, 'unnamed')]));
  const scopeName = new Map(list(parsed.scopes).filter(isRecord).map(s => [str(s.id, ''), str(s.name, 'a project')]));
  for (const i of items) {
    // A slice is shown as an item too. It is compared as a slice below, so that it is named once.
    if (i.kind === 'context-slice') continue;
    const kind = i.kind === 'skill' || i.kind === 'agent' ? i.kind : 'tool';
    out.set(`item\u0000${str(i.id, '')}`, { name: str(i.name, 'unnamed'), kind, body: canon(i) });
  }
  for (const s of list(parsed.slices).filter(isRecord)) out.set(`slice\u0000${str(s.id, '')}`, { name: str(s.name, 'unnamed'), kind: 'slice', body: canon(s) });
  for (const o of list(parsed.overrides).filter(isRecord)) {
    const item = itemName.get(str(o.itemId, '')) ?? 'an item', scope = scopeName.get(str(o.scopeId, '')) ?? 'a project';
    const replacement = itemName.get(str(o.replacementItemId, '')) ?? 'another item';
    const words = o.mode === 'hide' ? `${scope} hides ${item}` : o.mode === 'replace' ? `${scope} replaces ${item} with ${replacement}` : `${scope} keeps ${item}`;
    out.set(`override\u0000${str(o.scopeId, '')}\u0000${str(o.itemId, '')}`, { name: words, kind: 'override', body: canon(o) });
  }
  return out;
}

const byName = (a: DiffEntry, b: DiffEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/** What changed from `a` (the earlier) to `b` (the later): the names added, removed and changed. */
export function diffVersions(a: Snap, b: Snap): VersionDiff {
  const from = keyed(a), to = keyed(b);
  if (from === null || to === null) return { added: [], removed: [], changed: [], entries: [], unreadable: true };
  const entries: DiffEntry[] = [];
  for (const [key, now] of to) {
    const before = from.get(key);
    if (before === undefined) entries.push({ change: 'added', kind: now.kind, name: now.name });
    else if (before.body !== now.body) entries.push({ change: 'changed', kind: now.kind, name: now.name });
  }
  for (const [key, before] of from) if (!to.has(key)) entries.push({ change: 'removed', kind: before.kind, name: before.name });
  const sorted = entries.sort(byName);
  const names = (change: DiffChange): string[] => sorted.filter(e => e.change === change).map(e => e.name);
  return { added: names('added'), removed: names('removed'), changed: names('changed'), entries: sorted, unreadable: false };
}

/** How many things differ. */
export function diffCount(d: VersionDiff): number {
  return d.entries.length;
}
