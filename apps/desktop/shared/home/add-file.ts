/**
 * "From a shared file": reads the text of a shared file and says, in counts and names, what opening it would do. It reuses the bundle logic of the
 * 0.7 prototype (`openExportedFile` for the check and the preview, `commitImport` for what would land), so what the person is shown is what happens.
 * The result never carries a file path: the preview's file list is not passed on. Pure: no React, no DOM, no clock.
 */
import { BUNDLE_LIMITS, commitImport } from '../world/bundle.js';
import { reduceStore } from '../world/store.js';
import type { StoreAction, StoreState } from '../world/store.js';
import { openExportedFile } from '../world/export-flow.js';
import type { Bundle, HarnessItem, ImportPreview, World } from '../world/types.js';

export type FileThingKind = 'skill' | 'agent' | 'tool' | 'note';

/** One thing the file would add. */
export interface FileThing { readonly kind: FileThingKind; readonly name: string }

/** What opening a file would do. */
export interface SharedFilePreview {
  readonly bundle: Bundle;
  /** Things that are new here. */
  readonly added: readonly FileThing[];
  /** Names of things that are already here with the same text, so they are not added again. */
  readonly alreadyHere: readonly string[];
  /** Names of things that are here with different text, so both copies are kept. */
  readonly differentCopies: readonly string[];
  /** How many new tools need a key from the person. */
  readonly keysNeeded: number;
  /** How many things the file points to (skills, tools, notes) that are in neither the file nor the person's setup. */
  readonly missing: number;
  /** True when the file is valid and holds nothing at all. */
  readonly empty: boolean;
}

/** Why a file was refused: too big, with too many things in it, nested too deeply, two parts with one id, or not readable for any other reason. */
export type FileFailure = 'unreadable' | 'too-large' | 'too-many' | 'too-deep' | 'same-id';

export type SharedFileResult =
  | { readonly ok: true; readonly preview: SharedFilePreview }
  | { readonly ok: false; readonly reason: FileFailure };

/** The most skills and agents a file may hold when a person opens it. Real files hold a few dozen; the bundle limit (2,000) is for the checks, not for the window. */
export const FILE_MAX_ITEMS = 200;

/** The reason for a refusal, from the plain sentence the bundle check gave. */
export function failureOf(message: string): FileFailure {
  if (/nested too deeply/i.test(message)) return 'too-deep';
  if (/same id/i.test(message)) return 'same-id';
  if (/too many/i.test(message)) return 'too-many';
  if (/larger than 2 MB/i.test(message)) return 'too-large';
  return 'unreadable';
}

/** What a person calls an item: a set of notes, or the kind it is. */
const kindOf = (item: HarnessItem): FileThingKind => ('sliceId' in item ? 'note' : item.kind);

/** The most bytes a shared file may hold. Past this the file is refused before it is read. */
export const FILE_MAX_BYTES = BUNDLE_LIMITS.textBytes;

/** The order kinds are listed in: skills, agents, tools, then notes. */
export const FILE_KIND_ORDER: readonly FileThingKind[] = Object.freeze(['skill', 'agent', 'tool', 'note'] as const);

/** The new things a commit adds: every item in `after` whose id `before` did not have, grouped by kind (the order in the file stays inside a kind). */
function addedThings(before: World, after: World, nameOf: (name: string) => string): FileThing[] {
  const known = new Set(before.items.map(i => i.id));
  const things = after.items.filter(i => !known.has(i.id)).map((i): FileThing => ({ kind: kindOf(i), name: nameOf(i.name) }));
  return FILE_KIND_ORDER.flatMap(kind => things.filter(t => t.kind === kind));
}

/** A list cut for the screen: the first `limit` items, and how many more there are. A single leftover item is shown, never summed up as "1 more". */
export function capList<T>(list: readonly T[], limit: number): { shown: readonly T[]; more: number } {
  return list.length > limit + 1 ? { shown: list.slice(0, limit), more: list.length - limit } : { shown: list, more: 0 };
}

function clashNames(preview: ImportPreview, reasons: readonly ImportPreview['clashes'][number]['reason'][], nameOf: (name: string) => string): string[] {
  return [...new Set(preview.clashes.filter(c => reasons.includes(c.reason)).map(c => nameOf(c.name)))];
}

/** Reads the text of a shared file against the world it would be added to. The world is not changed. */
export function readSharedFile(text: string, world: World, nameOf: (name: string) => string = n => n): SharedFileResult {
  if (new TextEncoder().encode(text).length > FILE_MAX_BYTES) return { ok: false, reason: 'too-large' };
  const opened = openExportedFile(text, world, FILE_MAX_ITEMS);
  if (!opened.ok) return { ok: false, reason: failureOf(opened.message) };
  let after: World;
  try { after = commitImport(opened.bundle, world); } catch { return { ok: false, reason: 'unreadable' }; }
  const { preview } = opened;
  return {
    ok: true,
    preview: {
      bundle: opened.bundle,
      added: addedThings(world, after, nameOf),
      alreadyHere: clashNames(preview, ['same-name'], nameOf),
      differentCopies: clashNames(preview, ['different-text', 'different-secret'], nameOf),
      keysNeeded: preview.secretsToAdd.length,
      missing: preview.missingRefs.length,
      empty: opened.bundle.items.length === 0 && opened.bundle.toolRefs.length === 0 && opened.bundle.sliceRules.length === 0,
    },
  };
}

/** The store action that adds a file's things to the draft (the same one `importFileAction` builds for the screen). */
export const fileAction = (bundle: Bundle): StoreAction => ({ type: 'importBundle', bundle });

/** What adding a file would do: the action to send, and whether it would really change the draft. A file that adds nothing is no change and sends nothing. */
export function stageFile(state: StoreState, bundle: Bundle): { readonly action: StoreAction; readonly changed: boolean } {
  const action = fileAction(bundle);
  return { action, changed: reduceStore(state, action) !== state };
}

/** How many things of one kind the file adds. */
export const countOf = (preview: SharedFilePreview, kind: FileThingKind): number => preview.added.filter(t => t.kind === kind).length;

/** True when the file adds nothing at all. */
export const addsNothing = (preview: SharedFilePreview): boolean => preview.added.length === 0;

/** Where the "From a shared file" tab is: waiting, reading, showing what opening would do, refused, or done. */
export type FileStep =
  | { readonly step: 'idle' }
  | { readonly step: 'reading' }
  | { readonly step: 'preview'; readonly preview: SharedFilePreview }
  | { readonly step: 'failed'; readonly reason: FileFailure }
  | { readonly step: 'done'; readonly count: number };

export const FILE_IDLE: FileStep = Object.freeze({ step: 'idle' });

/** The step after a file was read. */
export const stepFromResult = (result: SharedFileResult): FileStep => (result.ok ? { step: 'preview', preview: result.preview } : { step: 'failed', reason: result.reason });

/** The step after the person added what the preview showed. Any other step stays as it is. */
export const stepAfterAdd = (step: FileStep): FileStep => (step.step === 'preview' ? { step: 'done', count: step.preview.added.length } : step);
