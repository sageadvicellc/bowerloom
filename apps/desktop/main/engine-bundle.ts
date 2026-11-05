/**
 * Export and import of a harness (0.8.0-beta.1, journey 4) in the main process: the six share calls of shared/engine/types.ts.
 *  - The window never holds a path, file bytes or an environment value. It names a folder by the id main gave it, a bundle by `bundle-<n>`, and a notes folder by its
 *    notes id. The SHAPE of every argument is checked first, before any lookup (a bundle id by exact string, the choices by own properties, a revision and an
 *    acknowledgement as 64 lowercase hex characters); then the folder, the bundle and the names are looked up.
 *  - Main owns both native dialogs (the save dialog of export, the open dialog of import) and each write question. A bundle file is read once; what is previewed
 *    and written is what was decoded from those bytes.
 *  - The heavy work (decode, inspect, encode, the target of an import, the plan and the write) runs in a worker thread (engine-bundle-work.ts, started by
 *    engine-bundle-host.ts), with a timeout. A worker that stops is a refusal in words, never a crash, and the bundles it held are gone (UNKNOWN_BUNDLE).
 *  - Every summary that reaches the window, and every acknowledgement hash, is built here or in the worker from the bundle main holds, in the same call, never from a field
 *    the window sent. Every string that came from a file passes `visible()` (through the folder's scrub) before it leaves.
 *  - An import is a save. Its write is the journaled save of packages/adoption, with a save point before and after (engine-bundle-work.ts). It is the only write.
 *    Export writes one new file with `writeBundleFile`, and replaces a file only with the identity the save dialog found.
 */
import { realpathSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import {
  BUNDLE_FILE_SUFFIX, BundleRefusal, bundleTargetIdentity, exportAcknowledgement, importChoicesOf, readBundleFile, writeBundleFile,
} from '../../../packages/harness-bundle/src/index.js';
import type { BundleSummary, ImportChoices } from '../../../packages/harness-bundle/src/index.js';
import type { KnowledgeSource } from '../../../packages/harness-definition/src/index.js';
import { capRiskFirst, codeRisk, secretRisk, toolRisk } from '../shared/engine/share-risk.js';
import type { Scrub } from '../shared/engine/scrub.js';
import {
  EXPORT_NEEDS_ACKNOWLEDGEMENT, IMPORT_NEEDS_ACKNOWLEDGEMENT, NOT_THE_PLAN_SHOWN, SHARE_BUNDLE_ID, SHARE_HELD_BUNDLES, SHARE_LIST_LIMIT, SHARE_MAIN_WORDS,
  SHARE_NAME_LIMIT, SHARE_NOTES_LIMIT, SHARE_TEXT_LIMIT, EXPORT_TARGET_IN_HARNESS_WORDS,
} from '../shared/engine/types.js';
import type {
  Answer, BundleView, DefinitionView, ExportView, ExportWritten, ImportNoteRow, ImportView, SaveWritten, ShareList, ShareSummary, SourceView,
} from '../shared/engine/types.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { ASK, cancelled, canonical, notTheShownPlan } from './engine-consent.js';
import type { Ask, SaveMarks, ShownPlan, ShownPlans } from './engine-consent.js';
import { UNKNOWN_BUNDLE_MARK } from './engine-bundle-mark.js';
import { CodedRefusal } from './engine-bundle-host.js';
import type { BundleHost } from './engine-bundle-host.js';
import type { DecodedView, EncodedView, PlanResult, WireChoices, WriteResult } from './engine-bundle-work.js';
import { copiedExecutables, changeViews } from './engine-save.js';
import type { SourceOf } from './engine-save.js';

/** A save place inside the harness folder's own `.bowerloom`, refused by main, in main's own words (a code of main, as EXPORT_NO_DEFINITION is). */
export const EXPORT_TARGET_IN_HARNESS = 'EXPORT_TARGET_IN_HARNESS';
export { EXPORT_TARGET_IN_HARNESS_WORDS };
/** The read of a bundle file that does not end in time. */
const READ_TIMED_OUT = 'Reading the file took longer than Bowerloom allows, so it stopped. Nothing was read or written. Check that the disk or the network folder answers, then try again.';

// ---- views ------------------------------------------------------------------------------------------------------------------

const cut = (text: string): string => (text.length > SHARE_TEXT_LIMIT ? `${text.slice(0, SHARE_TEXT_LIMIT).replace(/[\ud800-\udbff]$/, '')}…` : text);
const plainList = <T,>(rows: readonly T[]): ShareList<T> => ({ rows: rows.slice(0, SHARE_LIST_LIMIT), more: Math.max(0, rows.length - SHARE_LIST_LIMIT) });

/**
 * What a bundle holds, for the window: every string passed through `scrub` (which writes hidden characters out and replaces this computer's paths), every list cut at
 * SHARE_LIST_LIMIT with the rows that run code or reach a host first (`capRiskFirst`, the rule the sample uses too). Built from the package's own summary.
 * What a person ticks is never cut here: the command, the arguments, the host and the event of a tool are shown whole (the package refuses a bundle whose text passes
 * its display limits, so a tick never covers text the window did not show).
 */
export function shareSummary(s: BundleSummary, scrub: Scrub): ShareSummary {
  const t = (text: string): string => cut(scrub(text));
  return {
    harness: t(s.harness), engines: [...s.engines], instructions: s.instructions, counts: { ...s.counts },
    tools: capRiskFirst(s.tools.map(x => ({
      name: t(x.name), kind: x.kind, transport: x.transport ?? null, runsCode: x.runsCode, command: x.command === undefined ? null : scrub(x.command),
      args: (x.args ?? []).map(a => scrub(a)), host: x.host === undefined ? null : scrub(x.host), event: x.event === undefined ? null : scrub(x.event), flags: [...(x.addressFlags ?? [])],
      // What else the tick binds is shown whole too: the variables of a stdio server, the headers and the path of a remote one (additive; left out when the tool has none).
      ...(x.env === undefined ? {} : { env: x.env.map(v => ({ name: scrub(v.name), value: scrub(v.value) })) }),
      ...(x.headers === undefined ? {} : { headers: x.headers.map(v => ({ name: scrub(v.name), value: scrub(v.value) })) }),
      ...(x.path === undefined ? {} : { path: scrub(x.path) }),
      ...(x.hiddenFields === undefined || x.hiddenFields.length === 0 ? {} : { hiddenFields: x.hiddenFields.map(n => scrub(n)) }),
    })), toolRisk),
    codeFiles: capRiskFirst(s.codeFiles.map(x => ({ path: t(x.path), why: x.why })), codeRisk),
    secrets: capRiskFirst(s.secrets.map(x => ({ kind: x.kind, name: t(x.name), sinks: x.sinks.map(k => ({ tool: t(k.tool), field: k.field, host: k.host === undefined ? null : scrub(k.host) })) })), secretRisk),
    notes: plainList(s.notes.map(n => ({ name: t(n.name), readBy: n.readBy.map(t) }))),
    borrowed: plainList(s.borrowed.map(b => ({ name: t(b.name), marketplace: t(b.marketplace), version: t(b.version) }))),
    foreignPaths: plainList(s.foreignPaths.map(p => ({ path: t(p.path), line: p.line ?? null, text: t(p.text) }))),
  };
}

// ---- arguments --------------------------------------------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/;
const NOTES_ID = /^notes-[0-9]{1,6}$/;
const FOLDER_ID = /^folder-[0-9]{1,6}$/;
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** What the share calls need of the service. The service owns the folders, the plans and the gate. */
export interface ShareFolder { readonly id: string; readonly dir: string; readonly label: string; readonly scrub: Scrub; readonly dirs: HarnessStateDirs; readonly adoptState: string; readonly portableState: string }
export interface ShareEnv {
  readonly host: BundleHost;
  readonly now: () => Date;
  /** The real path of the home folder, and the user name, matched literally in the files of an export. */
  readonly home: string;
  readonly user: string;
  readonly plans: ShownPlans;
  readonly scrubAll: Scrub;
  /** Main's own dialogs. Null when the person closed one. */
  readonly chooseBundleOpen: () => Promise<string | null>;
  readonly chooseBundleSave: (suggested: string) => Promise<string | null>;
  readonly confirm: (ask: Ask) => Promise<boolean>;
  /** The longest a read of a bundle file may take, in milliseconds. */
  readonly readTimeoutMs: number;
  /** Throws the call's own short refusal (BAD_ARGUMENT or UNKNOWN_BUNDLE). */
  readonly bad: () => never;
  readonly unknownBundle: () => never;
  readonly folderOf: (id: unknown) => ShareFolder;
  readonly answer: <T>(f: { readonly id: string; readonly scrub: Scrub } | null, run: () => Promise<T> | T) => Promise<Answer<T>>;
  /**
   * The serial queue of the engine. The share calls that open a native dialog (the open dialog, the save dialog, a write question) take it only for the steps that touch a
   * folder or the worker, never across a dialog, so a person looking at a dialog blocks no other call and a window that died has nothing to wait for. The plan a write names is
   * checked again inside the queue, after the dialog, so a plan that changed meanwhile is never written.
   */
  readonly serial: <T>(run: () => Promise<T>) => Promise<T>;
  /** Counts a call as busy for as long as it runs, outside the queue too, so a quit knows an open dialog and the write that follows it are work in progress. */
  readonly track: <T>(run: () => Promise<T>) => Promise<T>;
  readonly whileStopped: (f: ShareFolder) => void;
  /** The stored path of a notes folder, by the id main gave it (throws its own refusal). */
  readonly sourcePathOf: (f: ShareFolder, notesId: string) => string;
  readonly hasNotes: (notesId: string) => boolean;
  readonly notesLabel: (notesId: string) => string;
  readonly sourceViewOf: (f: ShareFolder) => SourceOf;
  readonly scrubbed: (f: ShareFolder, d: DefinitionView) => DefinitionView;
  /** Clears every plan a write of this folder makes stale. Called after any import write, done or refused. */
  readonly afterImport: (f: ShareFolder) => void;
  readonly record: (input: Readonly<Record<string, unknown>>) => void;
}

interface Held {
  readonly id: string; readonly name: string; readonly bytes: number; readonly sha256: string; readonly harness: string; readonly summary: BundleSummary;
  readonly noteNames: ReadonlySet<string>; readonly generation: number;
}
/** The notes choices after the shape check and before the names are looked up. */
interface ChoicesShape { readonly link: readonly (readonly [string, string])[]; readonly leave: readonly string[] }
/** What a window sent as the notes choices, checked: notes names the bundle holds, each linked to a notes id main gave out, or left out. */
interface Choices { readonly link: ReadonlyMap<string, string>; readonly leave: ReadonlySet<string> }

export interface ShareCalls {
  planExport(folderId: unknown): Promise<Answer<ExportView>>;
  runExport(folderId: unknown, revision: unknown, acknowledged: unknown): Promise<Answer<ExportWritten>>;
  chooseBundle(): Promise<Answer<BundleView> | null>;
  planImport(folderId: unknown, bundleId: unknown, choices: unknown): Promise<Answer<ImportView>>;
  runImport(folderId: unknown, revision: unknown, bundleId: unknown, choices: unknown, acknowledged: unknown): Promise<Answer<SaveWritten>>;
  discardBundle(bundleId: unknown): Promise<boolean>;
  close(): Promise<void>;
}

const refusal = (code: string, message: string): { ok: false; refusal: { code: string; message: string; paths: readonly string[] } } => ({ ok: false, refusal: { code, message, paths: [] } });
const staleWords = (): string => notTheShownPlan().refusal.message;
const codeOf = (error: unknown): string => { const c = (error as { code?: unknown } | null)?.code; return typeof c === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(c) ? c : 'FAILED'; };
/** The refusals that say "this is not the plan shown" or "tick first": a stale or unticked plan is not a failure of the product, and the usage log leaves it out. */
const UNRECORDED = new Set([NOT_THE_PLAN_SHOWN, EXPORT_NEEDS_ACKNOWLEDGEMENT, IMPORT_NEEDS_ACKNOWLEDGEMENT]);

/** True when `dir` is `inside` or a folder below it, compared by device and inode of each folder up the chain, so a case variant or a link cannot slip by. */
function isInside(dir: string, inside: string): boolean {
  let want;
  try { want = statSync(inside); } catch { return false; }
  for (let at = dir; ;) {
    // A folder up the chain that cannot be read is treated as inside: the place is refused rather than trusted.
    try { const st = statSync(at); if (st.dev === want.dev && st.ino === want.ino) return true; } catch { return true; }
    const up = dirname(at);
    if (up === at) return false;
    at = up;
  }
}

export function createShare(env: ShareEnv): ShareCalls {
  const held = new Map<string, Held>();
  let counter = 0;
  /** What the last export plan of each folder offered: the file name and its size, for main's question. */
  const facts = new Map<string, { readonly file: string; readonly bytes: number }>();

  /** Runs a step and writes its line of the usage log: the step and the code only, never a name or a path. A stale or unticked plan writes none. */
  async function recorded<T>(step: string, run: () => Promise<T>): Promise<T> {
    try { const r = await run(); env.record({ kind: 'scenario', step, outcome: 'done' }); return r; } catch (error) {
      const code = codeOf(error);
      if (!UNRECORDED.has(code)) env.record({ kind: 'scenario', step, outcome: 'refused', code });
      throw error;
    }
  }

  // ---- the shape of each argument, before any lookup
  const revisionArg = (v: unknown): string => (typeof v === 'string' && HEX64.test(v) ? v : env.bad());
  const ackArg = (v: unknown): string | null => (v === null ? null : revisionArg(v));
  const folderArg = (v: unknown): string => (typeof v === 'string' && FOLDER_ID.test(v) ? v : env.bad());
  const bundleArg = (v: unknown): string => (typeof v === 'string' && SHARE_BUNDLE_ID.test(v) ? v : env.bad());
  /**
   * The shape of the notes choices: a plain object with exactly `link` and `leave`; at most SHARE_NOTES_LIMIT names in all, each at most SHARE_NAME_LIMIT characters; a link to
   * an id in the form of a notes id; no name twice in `leave`. Own properties only, read without indexing by a name.
   */
  const choicesShape = (raw: unknown): ChoicesShape => {
    if (!plain(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'link') || !Object.hasOwn(raw, 'leave')) return env.bad();
    const linkIn = raw.link, leaveIn = raw.leave;
    if (!plain(linkIn) || !Array.isArray(leaveIn)) return env.bad();
    const entries = Object.entries(linkIn);
    if (entries.length + leaveIn.length > SHARE_NOTES_LIMIT) return env.bad();
    const link: [string, string][] = [];
    for (const [name, id] of entries) {
      if (name.length > SHARE_NAME_LIMIT || typeof id !== 'string' || !NOTES_ID.test(id)) return env.bad();
      link.push([name, id]);
    }
    const leave: string[] = [];
    for (const name of leaveIn as unknown[]) {
      if (typeof name !== 'string' || name.length > SHARE_NAME_LIMIT) return env.bad();
      leave.push(name);
    }
    if (new Set(leave).size !== leave.length) return env.bad();
    return { link, leave };
  };
  // ---- the lookups, after every shape is known
  const bundleOf = (id: string): Held => {
    const b = held.get(id);
    if (b === undefined) return env.unknownBundle();
    // The worker restarted since: it no longer holds this bundle.
    if (b.generation !== env.host.generation()) { held.delete(id); return env.unknownBundle(); }
    return b;
  };
  /** The names a bundle holds, each linked to a notes id main gave out or left out; a name in both lists, or one the bundle does not hold, is refused. */
  const choicesFor = (b: Held, shape: ChoicesShape): Choices => {
    const link = new Map<string, string>(), leave = new Set<string>();
    for (const [name, id] of shape.link) {
      if (!b.noteNames.has(name) || !env.hasNotes(id)) return env.bad();
      link.set(name, id);
    }
    for (const name of shape.leave) {
      if (!b.noteNames.has(name) || link.has(name)) return env.bad();
      leave.add(name);
    }
    return { link, leave };
  };
  /** The choices as the worker takes them: a name to a STORED path (main maps each notes id), checked by the package. */
  const wireOf = (f: ShareFolder, b: Held, c: Choices): WireChoices => {
    const paths = new Map<string, string>();
    for (const [name, id] of c.link) paths.set(name, env.sourcePathOf(f, id));
    const checked: ImportChoices = importChoicesOf({ link: paths, leave: c.leave }, [...b.noteNames]);
    return { link: checked.link, leave: checked.leave };
  };
  /** The choices of a plan as it is recorded: the bundle by its own hash, the links by notes id, the names left out, and the acknowledgement the plan asks for. */
  const recordOf = (b: Held, c: Choices, acknowledged: string | null): unknown => ({
    bundle: b.sha256, link: [...c.link].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)), leave: [...c.leave].sort(), acknowledged,
  });

  // ---- export -------------------------------------------------------------------------------------------------------------

  async function planExport(folderId: unknown): Promise<Answer<ExportView>> {
    const f = env.folderOf(folderArg(folderId));
    env.plans.clear(f.id, 'export'); facts.delete(f.id);
    return env.answer(f, async () => {
      env.whileStopped(f);
      const e = await env.host.call<EncodedView>({ op: 'encode', projectDir: f.dir, home: env.home, user: env.user, wantBytes: false });
      const acknowledge = exportAcknowledgement(e.summary, e.sha256);
      const file = `${e.summary.harness}${BUNDLE_FILE_SUFFIX}`;
      const value: ExportView = { folder: f.label, file: f.scrub(file), bytes: e.size, summary: shareSummary(e.summary, f.scrub), revision: e.sha256, acknowledge };
      env.plans.set(f.id, 'export', { revision: e.sha256, choices: canonical({ acknowledged: acknowledge }), ask: null });
      facts.set(f.id, { file: value.file, bytes: e.size });
      return value;
    });
  }

  /**
   * Where the person chose to save: an absolute path whose folder is resolved now (with the system's own case, so a case variant of a name is the same folder), not inside
   * the harness folder's `.bowerloom` (compared by device and inode up the chain of folders), and the identity of a file already there.
   */
  async function exportTarget(f: ShareFolder, picked: unknown): Promise<{ path: string; name: string; where: string; identity: Awaited<ReturnType<typeof bundleTargetIdentity>> }> {
    if (typeof picked !== 'string' || !isAbsolute(picked) || picked.includes('\u0000')) throw new BundleRefusal('BUNDLE_USAGE');
    const name = basename(picked);
    if (name === '' || name === '.' || name === '..' || Buffer.byteLength(name) > 255) throw new BundleRefusal('BUNDLE_USAGE');
    let parent: string;
    try { parent = realpathSync.native(dirname(picked)); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new BundleRefusal('BUNDLE_FILE_FAILED', [], [], typeof code === 'string' ? code : undefined);
    }
    if (isInside(parent, join(f.dir, '.bowerloom'))) throw new DefinitionError(EXPORT_TARGET_IN_HARNESS, EXPORT_TARGET_IN_HARNESS_WORDS);
    const path = join(parent, name);
    return { path, name, where: env.scrubAll(parent), identity: await bundleTargetIdentity(path) };
  }

  async function runExport(folderId: unknown, revision: unknown, acknowledged: unknown): Promise<Answer<ExportWritten>> {
    const folder = folderArg(folderId), rev = revisionArg(revision), ack = ackArg(acknowledged);
    const f = env.folderOf(folder);
    // First step, in the queue: the folder is not stopped, the plan is the one shown, and the acknowledgement is the one it asked for. No dialog yet.
    const first = await env.serial(async (): Promise<Answer<{ readonly file: string; readonly bytes: number }>> => {
      const stopped = await env.answer(f, () => env.whileStopped(f));
      if (!stopped.ok) return stopped;
      const shown = env.plans.peek(f.id, 'export'), fact = facts.get(f.id);
      if (shown === null || fact === undefined || shown.revision !== rev) return notTheShownPlan();
      // The acknowledgement the plan asked for, before any dialog.
      if ((JSON.parse(shown.choices) as { acknowledged: string | null }).acknowledged !== ack) return refusal(EXPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.EXPORT_NEEDS_ACKNOWLEDGEMENT);
      return { ok: true, value: { file: fact.file, bytes: fact.bytes } };
    });
    if (!first.ok) return first;
    const fact = first.value;
    // Main's own save dialog: the window gets the file name back only. The queue is free while it is open.
    const picked = await env.chooseBundleSave(fact.file);
    if (picked === null) return cancelled();
    // After the dialog, in the queue: the plan must still be the one shown, before any question is asked about it.
    const target = await env.serial(async () => {
      const still = env.plans.peek(f.id, 'export');
      if (still === null || still.revision !== rev) return notTheShownPlan();
      return env.answer(f, () => exportTarget(f, picked));
    });
    if (!target.ok) return target;
    const { path, name, where, identity } = target.value;
    // The question is asked with the size main recorded for this plan; the plan is checked again below, in the queue, once the person has said yes.
    if (!(await env.confirm(ASK.exportBundle(f.label, name, fact.bytes, rev, identity !== null, where)))) return cancelled();
    return env.serial(async () => {
      const still = env.plans.peek(f.id, 'export');
      if (still === null || still.revision !== rev) return notTheShownPlan();
      const again = await env.answer(f, () => env.whileStopped(f));
      if (!again.ok) return again;
      env.plans.clear(f.id, 'export');
      return env.answer(f, () => recorded('export', async () => {
        // The file is encoded again now; when the harness changed since the plan, it is not the plan shown, and nothing is written.
        const e = await env.host.call<EncodedView>({ op: 'encode', projectDir: f.dir, home: env.home, user: env.user, wantBytes: true });
        if (e.sha256 !== rev || e.bytes === null) throw new DefinitionError(NOT_THE_PLAN_SHOWN, staleWords());
        if (exportAcknowledgement(e.summary, rev) !== ack) throw new DefinitionError(EXPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.EXPORT_NEEDS_ACKNOWLEDGEMENT);
        // `replace` only with the identity of the file the dialog found, which the package compares again right before the rename.
        await writeBundleFile(path, e.bytes, identity === null ? undefined : { replace: identity });
        return { name: f.scrub(name), bytes: e.bytes.length };
      }));
    });
  }

  // ---- import: choose the file -------------------------------------------------------------------------------------------

  /** Reads the bundle file with a timer, so a file on a stalled volume does not hold the queue of every engine call. The read itself ends when the system lets it. */
  async function readWithin(path: string): Promise<Uint8Array> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CodedRefusal('FAILED', READ_TIMED_OUT, [], 'READ_TIMED_OUT')), env.readTimeoutMs); });
    try { return await Promise.race([readBundleFile(path), late]); } finally { clearTimeout(timer); }
  }

  async function chooseBundle(): Promise<Answer<BundleView> | null> {
    // The open dialog runs outside the queue; the read and the decode run inside it.
    const picked = await env.chooseBundleOpen();
    if (picked === null) return null;
    return env.serial(() => env.answer(null, () => recorded('bundle-open', async () => {
      if (typeof picked !== 'string' || !isAbsolute(picked) || picked.includes('\u0000')) throw new BundleRefusal('BUNDLE_USAGE');
      const read = await readWithin(picked);
      // The worker takes the buffer itself. A view onto a larger buffer is copied first, so no other view is cut off.
      const bytes = read.byteOffset === 0 && read.byteLength === read.buffer.byteLength ? read : Uint8Array.from(read);
      counter += 1;
      const id = `bundle-${counter}`;
      const d = await env.host.call<DecodedView>({ op: 'decode', key: id, bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
      const name = env.scrubAll(basename(picked));
      held.set(id, { id, name, bytes: d.bytes, sha256: d.sha256, harness: d.harness, summary: d.summary, noteNames: new Set(d.summary.notes.map(n => n.name)), generation: env.host.generation() });
      while (held.size > SHARE_HELD_BUNDLES) { const old = held.keys().next().value!; held.delete(old); env.host.tell({ op: 'drop', key: old }); }
      return { bundleId: id, name, bytes: d.bytes, harness: env.scrubAll(d.harness), summary: shareSummary(d.summary, env.scrubAll) } satisfies BundleView;
    })));
  }

  // ---- import: plan and write ---------------------------------------------------------------------------------------------

  /** The files that can run, as the native question names them: each path written out and cut, so a long or look-alike name cannot fill or fool the question. */
  const marksOf = (r: PlanResult): SaveMarks => ({
    executables: r.changes.filter(c => r.executables.includes(c.path)).map(c => cut(env.scrubAll(`.bowerloom/${c.path}`))),
    modeOnly: [], deletes: r.changes.filter(c => c.action === 'delete').length,
  });

  async function planImport(folderId: unknown, bundleId: unknown, choices: unknown): Promise<Answer<ImportView>> {
    const folder = folderArg(folderId), bundle = bundleArg(bundleId), shape = choicesShape(choices);
    const f = env.folderOf(folder), b = bundleOf(bundle), c = choicesFor(b, shape);
    env.plans.clear(f.id, 'import');
    return env.answer(f, async () => {
      env.whileStopped(f);
      const r = await env.host.call<PlanResult>({ op: 'plan', key: b.id, choices: wireOf(f, b, c), projectDir: f.dir, adoptState: f.adoptState }).catch(unknownAsCall);
      const running = new Set(r.executables);
      const changes = changeViews(r.changes, rel => (running.has(rel) ? b.name : undefined), f.scrub);
      const sourceOf = env.sourceViewOf(f);
      const sources: SourceView[] = r.outline.sources.map(s => sourceOf({ name: s.name, kind: s.kind, path: s.label } as KnowledgeSource));
      const notes: ImportNoteRow[] = b.summary.notes.map(n => {
        const id = c.link.get(n.name);
        return { name: env.scrubAll(n.name), choice: id === undefined ? 'leave' : 'link', label: id === undefined ? null : env.notesLabel(id), readBy: n.readBy.map(x => env.scrubAll(x)) };
      });
      const value: ImportView = {
        folder: f.label, changes, definition: env.scrubbed(f, { ...r.outline, sources }), noop: changes.length === 0, revision: r.revision, removedSources: [],
        copiedExecutables: copiedExecutables(changes), acknowledge: r.acknowledge, bundleId: b.id, summary: shareSummary(b.summary, f.scrub), notes, makesHarness: r.makes,
      };
      const ask: Ask | null = value.noop ? null : ASK.importBundle(f.label, r.changes.length, r.revision, marksOf(r), r.makes);
      env.plans.set(f.id, 'import', { revision: r.revision, choices: canonical(recordOf(b, c, r.acknowledge)), ask } satisfies ShownPlan);
      return value;
    });
  }

  async function runImport(folderId: unknown, revision: unknown, bundleId: unknown, choices: unknown, acknowledged: unknown): Promise<Answer<SaveWritten>> {
    const folder = folderArg(folderId), rev = revisionArg(revision), bundle = bundleArg(bundleId), shape = choicesShape(choices), ack = ackArg(acknowledged);
    const f = env.folderOf(folder), b = bundleOf(bundle), c = choicesFor(b, shape);
    const record = recordOf(b, c, ack);
    // First step, in the queue: the folder is not stopped, the acknowledgement is the one the plan shown last asks for, and the plan is the one shown. No dialog yet.
    const first = await env.serial(async (): Promise<Answer<{ readonly ask: Ask | null }>> => {
      const stopped = await env.answer(f, () => env.whileStopped(f));
      if (!stopped.ok) return stopped;
      // The acknowledgement the plan shown last asks for, before any dialog: the one it names, or none. A plan that is not the one shown is refused below, as every write is.
      const shown = env.plans.peek(f.id, 'import');
      if (shown !== null && shown.revision === rev) {
        const want = JSON.parse(shown.choices) as { bundle: string; acknowledged: string | null };
        if (canonical({ ...want, acknowledged: null }) === canonical(recordOf(b, c, null)) && want.acknowledged !== ack) {
          return refusal(IMPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.IMPORT_NEEDS_ACKNOWLEDGEMENT);
        }
      }
      const match = env.plans.match(f.id, 'import', rev, record);
      return match === null ? notTheShownPlan() : { ok: true, value: { ask: match.ask } };
    });
    if (!first.ok) return first;
    // Main's own question, with words from its record of the plan. The queue is free while it is open.
    if (first.value.ask !== null && !(await env.confirm(first.value.ask))) return cancelled();
    return env.serial(async () => {
      // After the yes: the plan must still be the one the person approved. A plan made, or a write done, while the question was open makes this refuse.
      if (env.plans.match(f.id, 'import', rev, record) === null) return notTheShownPlan();
      const again = await env.answer(f, () => env.whileStopped(f));
      if (!again.ok) return again;
      env.plans.clear(f.id, 'import');
      return env.answer(f, () => recorded('import', async () => {
        try {
          const r = await env.host.call<WriteResult>({
            op: 'write', key: b.id, choices: wireOf(f, b, c), revision: rev, acknowledged: ack, dirs: f.dirs, now: env.now().toISOString(), projectDir: f.dir, adoptState: f.adoptState,
          }).catch(unknownAsCall);
          if (r.pointCode !== null) env.record({ kind: 'scenario', step: 'save-point', outcome: 'refused', code: r.pointCode });
          const warnings = r.warnings.map(w => f.scrub(w));
          return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)), version: r.version, ...(warnings.length > 0 ? { warnings } : {}) } satisfies SaveWritten;
        } finally {
          // Done or refused, no plan shown before this write can be written now: the folder may have changed.
          env.afterImport(f);
        }
      }));
    });
  }
  /** A bundle the worker no longer holds is the call's own short refusal, as a bundle id main never gave. */
  function unknownAsCall(error: unknown): never {
    if ((error as { code?: unknown } | null)?.code === UNKNOWN_BUNDLE_MARK) return env.unknownBundle();
    throw error;
  }

  async function discardBundle(bundleId: unknown): Promise<boolean> {
    const id = bundleArg(bundleId);
    const had = held.delete(id);
    if (had) env.host.tell({ op: 'drop', key: id });
    return had;
  }

  // The three calls with a native dialog are busy from their first line to their last, dialogs included (`env.track`); the queue alone would miss the time a dialog is open.
  return {
    planExport, discardBundle, planImport, close: () => env.host.close(),
    runExport: (folderId, revision, acknowledged) => env.track(() => runExport(folderId, revision, acknowledged)),
    chooseBundle: () => env.track(() => chooseBundle()),
    runImport: (folderId, revision, bundleId, choices, acknowledged) => env.track(() => runImport(folderId, revision, bundleId, choices, acknowledged)),
  };
}

/** The user name of the account that runs the app, matched literally in the files of an export. Empty when the system gives none, and then the log says so. */
export function accountName(): string {
  try { return userInfo().username; } catch (error) {
    console.error('Bowerloom could not read the user name of this account, so an export matches paths by shape only.', error instanceof Error ? error.message : String(error));
    return '';
  }
}
