/**
 * The approval drafts of the harness commands: a person's approval of one weakened or absent fidelity line, kept
 * between the plan run and the apply run. A record's `when` enters the plan revision, so a draft is written once and
 * keeps its time: the plan run and the apply run read the same bytes and so compute the same revision.
 *
 * The file is `approvals.json` of the shared layout (harness-state.ts), mode 0600, read against a strict shape. Each
 * draft is checked by `parseFidelityApproval`. A draft is dropped once a receipt records it, and on removal.
 */
import fs from 'node:fs';
import { entryHash, parseFidelityApproval } from '../../harness-definition/src/index.js';
import type { Definition, FidelityApproval } from '../../harness-definition/src/index.js';
import { refuse, syncDir } from './portable-files.js';
import {
  checkLayout, ensureRecordFolder, readPrivateJson, recordExists, refuseHarness, writePrivateJson,
} from './harness-state.js';
import type { HarnessStateDirs } from './harness-state.js';

export const APPROVAL_DRAFTS_FORMAT = 'bowerloom/harness-approval-drafts/v1' as const;
const NAME = 'approvals.json';
const LIMIT = 10_000;

/** A draft as a caller gives it: an approval with no time. The time is set when the draft is first written. */
export type ApprovalDraftInput = Omit<FidelityApproval, 'when'>;
export interface AddApprovalDraftOptions {
  /** The definition now. The draft's entry hash must be the hash of its entry in it. */
  readonly definition: Definition;
  /** The present time. Default: the clock. */
  readonly now?: Date;
}
export interface ReadApprovalDraftsOptions {
  /** When given, a draft whose entry changed or is gone is left out. */
  readonly definition?: Definition;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isoSeconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;
/** One fidelity line: part, entry, field, and engine. */
const lineKey = (a: FidelityApproval): string => JSON.stringify([a.part, a.entry, a.field ?? null, a.engine]);
const byKey = (a: FidelityApproval, b: FidelityApproval): number => Buffer.compare(Buffer.from(lineKey(a)), Buffer.from(lineKey(b)));
const sameLine = (a: FidelityApproval, b: FidelityApproval): boolean => lineKey(a) === lineKey(b) && a.result === b.result && a.entryHash === b.entryHash;

/** The definition's entry for an approval, found as the fidelity check finds it. */
function entryOf(def: Definition, part: string, id: string): object | undefined {
  const e = def.entries;
  const list: readonly { id: string }[] = part === 'skills' ? e.skills : part === 'subagents' ? e.subagents
    : part === 'guardrails' ? [...e.rules, ...e.sandbox] : part === 'hooks' ? e.hooks : part === 'mcp' ? e.mcp : [];
  return list.find(x => x.id === id);
}
const current = (def: Definition, a: FidelityApproval): boolean => {
  const entry = entryOf(def, a.part, a.entry);
  return entry !== undefined && entryHash(entry) === a.entryHash;
};
const isDefinition = (v: unknown): v is Definition => isObj(v) && isObj(v.entries);

/** The drafts on disk, checked against the shape. Empty when there is no file. */
function load(layout: HarnessStateDirs, projectDir: string): { drafts: FidelityApproval[]; present: boolean } {
  if (!recordExists(layout)) return { drafts: [], present: false };
  const raw = readPrivateJson(layout.approvals, NAME);
  if (raw === null) return { drafts: [], present: false };
  const bad = (): never => refuse('PORTABLE_STATE_INVALID', [NAME]);
  if (!isObj(raw) || Object.keys(raw).length !== 3 || !['format', 'projectDir', 'drafts'].every(k => Object.hasOwn(raw, k))) bad();
  const o = raw as Record<string, unknown>;
  if (o.format !== APPROVAL_DRAFTS_FORMAT || typeof o.projectDir !== 'string' || !Array.isArray(o.drafts) || o.drafts.length > LIMIT) bad();
  const drafts = (o.drafts as unknown[]).map(x => { const r = parseFidelityApproval(x); return r.ok ? r.approval : bad(); });
  if (new Set(drafts.map(lineKey)).size !== drafts.length) bad();
  if (o.projectDir !== projectDir) refuse('PORTABLE_STATE_FOREIGN');
  return { drafts, present: true };
}
function save(layout: HarnessStateDirs, projectDir: string, drafts: readonly FidelityApproval[]): void {
  if (drafts.length === 0) {
    try { fs.unlinkSync(layout.approvals); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    syncDir(layout.base);
    return;
  }
  ensureRecordFolder(layout);
  writePrivateJson(layout.approvals, { format: APPROVAL_DRAFTS_FORMAT, projectDir, drafts: [...drafts].sort(byKey) });
}

/**
 * The approval drafts of a project, in a stable order. Reads only. With `definition`, a draft whose entry changed or
 * is gone is left out. A damaged file refuses PORTABLE_STATE_INVALID, a file of another project PORTABLE_STATE_FOREIGN,
 * and a link or a file or folder open to others PORTABLE_STATE_UNSAFE.
 */
export function readApprovalDrafts(dirs: HarnessStateDirs, projectDir: string, options: ReadApprovalDraftsOptions = {}): readonly FidelityApproval[] {
  const layout = checkLayout(dirs, projectDir);
  if (!isObj(options) || (options.definition !== undefined && !isDefinition(options.definition))) refuse('PORTABLE_USAGE');
  const { drafts } = load(layout, projectDir);
  const def = options.definition;
  return def === undefined ? drafts : drafts.filter(a => current(def, a));
}

/**
 * Adds the draft of one line and returns the draft as stored. A draft of the same line, result, and entry hash already
 * stored is kept as it is, with its first time, and nothing is written. A draft of the same line with another result
 * or hash is replaced. Drafts whose entry changed or is gone are dropped in the same write. A draft whose entry hash is
 * not the hash of its entry in `definition` refuses HARNESS_APPROVAL_STALE; a draft that is not a valid approval, or
 * that carries its own time, refuses PORTABLE_USAGE. The write is atomic.
 */
export function addApprovalDraft(dirs: HarnessStateDirs, projectDir: string, draft: ApprovalDraftInput, options: AddApprovalDraftOptions): FidelityApproval {
  const layout = checkLayout(dirs, projectDir);
  if (!isObj(options) || !isDefinition(options.definition) || (options.now !== undefined && !(options.now instanceof Date && !Number.isNaN(options.now.getTime())))) refuse('PORTABLE_USAGE');
  if (!isObj(draft) || Object.hasOwn(draft, 'when')) refuse('PORTABLE_USAGE');
  const now = options.now ?? new Date();
  const parsed = parseFidelityApproval({ ...draft, when: isoSeconds(now) }, { now });
  if (!parsed.ok) return refuse('PORTABLE_USAGE');
  const approval = parsed.approval, def = options.definition;
  if (!current(def, approval)) refuseHarness('HARNESS_APPROVAL_STALE');
  const { drafts } = load(layout, projectDir);
  const same = drafts.find(d => sameLine(d, approval));
  if (same !== undefined) return same;
  const kept = drafts.filter(d => lineKey(d) !== lineKey(approval) && current(def, d));
  save(layout, projectDir, [...kept, approval]);
  return approval;
}

/**
 * Drops drafts and returns how many it dropped. With `recorded`, the approvals a receipt now holds, it drops each
 * draft of the same line, result, and entry hash; with none, it drops every draft (on removal). The file goes when no
 * draft is left. A damaged file is refused and kept.
 */
export function dropApprovalDrafts(dirs: HarnessStateDirs, projectDir: string, recorded?: readonly FidelityApproval[]): number {
  const layout = checkLayout(dirs, projectDir);
  if (recorded !== undefined && (!Array.isArray(recorded) || recorded.length > LIMIT)) refuse('PORTABLE_USAGE');
  const covered: readonly FidelityApproval[] | null = recorded === undefined ? null
    : recorded.map(x => { const r = parseFidelityApproval(x); return r.ok ? r.approval : refuse('PORTABLE_USAGE'); });
  const { drafts, present } = load(layout, projectDir);
  if (!present) return 0;
  const kept = covered === null ? [] : drafts.filter(d => !covered.some(r => sameLine(r, d)));
  if (kept.length === drafts.length && drafts.length > 0) return 0;
  save(layout, projectDir, kept);
  return drafts.length - kept.length;
}
