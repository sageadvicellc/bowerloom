/**
 * Export and import of a harness (0.8.0-beta.1, journey 4) in the main process: the six share calls of shared/engine/types.ts.
 *  - The window never holds a path, file bytes or an environment value. It names a folder by the id main gave it, a bundle by `bundle-<n>`, and a notes folder by its
 *    notes id. Every argument is checked here before anything is looked up (a bundle id by exact string in a Map, the choices by own properties into a Map and a Set,
 *    a revision and an acknowledgement as 64 lowercase hex characters).
 *  - Main owns both native dialogs (the save dialog of export, the open dialog of import) and each write question. A bundle file is read once; what is previewed
 *    and written is what was decoded from those bytes.
 *  - The heavy work (decode, inspect, encode, the target of an import, the plan and the write) runs in a worker thread (engine-bundle-work.ts), with a timeout. A worker
 *    that stops is a refusal in words, never a crash, and the bundles it held are gone (UNKNOWN_BUNDLE).
 *  - Every summary that reaches the window, and every acknowledgement hash, is built here or in the worker from the bundle main holds, in the same call, never from a field
 *    the window sent. Every string that came from a file passes `visible()` (through the folder's scrub) before it leaves.
 *  - An import is a save. Its write is the journaled save of packages/adoption, with a save point before and after (engine-bundle-work.ts). It is the only write.
 *    Export writes one new file with `writeBundleFile`, and replaces a file only with the identity the save dialog found.
 */
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
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
  SHARE_NAME_LIMIT, SHARE_NOTES_LIMIT, SHARE_TEXT_LIMIT,
} from '../shared/engine/types.js';
import type {
  Answer, BundleView, DefinitionView, ExportView, ExportWritten, ImportNoteRow, ImportView, SaveWritten, ShareList, ShareSummary, SourceView,
} from '../shared/engine/types.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { ASK, cancelled, canonical, notTheShownPlan } from './engine-consent.js';
import type { Ask, SaveMarks, ShownPlan, ShownPlans } from './engine-consent.js';
import { UNKNOWN_BUNDLE_MARK } from './engine-bundle-work.js';
import type { DecodedView, EncodedView, Job, PlanResult, WireChoices, WriteResult } from './engine-bundle-work.js';
import { copiedExecutables, changeViews } from './engine-save.js';
import type { SourceOf } from './engine-save.js';
import type { PlainRefusal } from './engine-bundle-worker.js';

// ---- the worker -------------------------------------------------------------------------------------------------------------

/** A refusal with a code and words, as `refusalOf` reads one. */
export class CodedRefusal extends Error {
  constructor(readonly code: string, message: string, readonly paths: readonly string[] = []) { super(message); this.name = 'CodedRefusal'; }
}
const STOPPED_READ = 'Bowerloom stopped reading this file before it finished, so it took nothing. Nothing was written. Try again, or choose another file.';
const STOPPED_WRITE = 'The step that writes stopped before it finished. Nothing more was changed. If a save is left unfinished, use Finish a stopped harness.';
const TIMED_OUT = 'This took longer than Bowerloom allows, so it stopped. Nothing more was changed.';

export interface BundleHostOptions {
  /** The worker's file: a path or a URL. Asked when a worker starts. */
  readonly file: () => string | URL;
  /** The longest a decode, an encode or a plan may take, in milliseconds. */
  readonly timeoutMs: number;
  /** The longest a write may take. A write that times out is stopped like a crash: its journal says what to do. */
  readonly writeTimeoutMs: number;
}
export interface BundleHost {
  /** Changes when the worker restarts: what it held is gone. */
  generation(): number;
  call<T>(job: Job, options?: { readonly transfer?: ArrayBuffer[]; readonly timeoutMs?: number }): Promise<T>;
  /** Sends a job only if a worker is running. Never starts one and never throws. */
  tell(job: Job): void;
  close(): void;
}

interface Waiting { readonly worker: Worker; readonly resolve: (value: never) => void; readonly reject: (error: unknown) => void; readonly timer: NodeJS.Timeout; readonly write: boolean }

function revive(refusal: PlainRefusal): unknown {
  if (refusal.kind === 'bundle') return BundleRefusal.fromPlain(refusal.value);
  if (refusal.kind === 'coded') return new CodedRefusal(refusal.code, refusal.message, refusal.paths);
  return new CodedRefusal('FAILED', 'Bowerloom could not finish this. Nothing more was changed.');
}

export function createBundleHost(options: BundleHostOptions): BundleHost {
  let worker: Worker | null = null;
  let generation = 0, next = 1;
  const waiting = new Map<number, Waiting>();

  const failAll = (stopped: Worker, words: (write: boolean) => string): void => {
    if (worker === stopped) { worker = null; generation += 1; }
    // Only the jobs this worker held: a worker that was closed and replaced must not fail the jobs of the new one when its exit arrives.
    for (const [id, w] of [...waiting]) { if (w.worker !== stopped) continue; clearTimeout(w.timer); waiting.delete(id); w.reject(new CodedRefusal('FAILED', words(w.write))); }
  };
  const start = (): Worker => {
    const w = new Worker(options.file(), { resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    w.unref();
    w.on('message', (m: { id: number; ok: boolean; value?: unknown; refusal?: PlainRefusal }) => {
      const found = waiting.get(m.id);
      if (found === undefined) return;
      clearTimeout(found.timer); waiting.delete(m.id);
      if (m.ok) found.resolve(m.value as never); else found.reject(revive(m.refusal ?? { kind: 'bug' }));
    });
    // A worker that cannot start, or dies, is a refusal for every call waiting on it. Nothing here throws into the main process.
    w.on('error', () => failAll(w, write => (write ? STOPPED_WRITE : STOPPED_READ)));
    w.on('exit', () => failAll(w, write => (write ? STOPPED_WRITE : STOPPED_READ)));
    return w;
  };
  return {
    generation: () => generation,
    call: <T,>(job: Job, opts: { readonly transfer?: ArrayBuffer[]; readonly timeoutMs?: number } = {}): Promise<T> => new Promise<T>((resolve, reject) => {
      const write = job.op === 'write';
      let w: Worker;
      try { w = worker ?? (worker = start()); } catch { reject(new CodedRefusal('FAILED', write ? STOPPED_WRITE : STOPPED_READ)); return; }
      const id = next; next += 1;
      const timer = setTimeout(() => {
        failAll(w, () => TIMED_OUT);
        void w.terminate().catch(() => undefined);
      }, opts.timeoutMs ?? (write ? options.writeTimeoutMs : options.timeoutMs));
      waiting.set(id, { worker: w, resolve: resolve as (value: never) => void, reject, timer, write });
      try { w.postMessage({ id, job }, opts.transfer ?? []); } catch { clearTimeout(timer); waiting.delete(id); reject(new CodedRefusal('FAILED', write ? STOPPED_WRITE : STOPPED_READ)); }
    }),
    tell: job => { try { worker?.postMessage({ id: 0, job }); } catch { /* the worker is gone; what it held is gone too */ } },
    close: () => { const w = worker; worker = null; generation += 1; if (w !== null) void w.terminate().catch(() => undefined); },
  };
}

// ---- views ------------------------------------------------------------------------------------------------------------------

const cut = (text: string): string => (text.length > SHARE_TEXT_LIMIT ? `${text.slice(0, SHARE_TEXT_LIMIT).replace(/[\ud800-\udbff]$/, '')}…` : text);
const plainList = <T,>(rows: readonly T[]): ShareList<T> => ({ rows: rows.slice(0, SHARE_LIST_LIMIT), more: Math.max(0, rows.length - SHARE_LIST_LIMIT) });

/**
 * What a bundle holds, for the window: every string passed through `scrub` (which writes hidden characters out and replaces this computer's paths), every list cut at
 * SHARE_LIST_LIMIT with the rows that run code or reach a host first (`capRiskFirst`, the rule the sample uses too). Built from the package's own summary.
 */
export function shareSummary(s: BundleSummary, scrub: Scrub): ShareSummary {
  const t = (text: string): string => cut(scrub(text));
  return {
    harness: t(s.harness), engines: [...s.engines], instructions: s.instructions, counts: { ...s.counts },
    tools: capRiskFirst(s.tools.map(x => ({
      name: t(x.name), kind: x.kind, transport: x.transport ?? null, runsCode: x.runsCode, command: x.command === undefined ? null : t(x.command),
      args: (x.args ?? []).slice(0, 20).map(t), host: x.host === undefined ? null : t(x.host), event: x.event === undefined ? null : t(x.event), flags: [...(x.addressFlags ?? [])],
    })), toolRisk),
    codeFiles: capRiskFirst(s.codeFiles.map(x => ({ path: t(x.path), why: x.why })), codeRisk),
    secrets: capRiskFirst(s.secrets.map(x => ({ kind: x.kind, name: t(x.name), sinks: x.sinks.map(k => ({ tool: t(k.tool), field: k.field, host: k.host === undefined ? null : t(k.host) })) })), secretRisk),
    notes: plainList(s.notes.map(n => ({ name: t(n.name), readBy: n.readBy.map(t) }))),
    borrowed: plainList(s.borrowed.map(b => ({ name: t(b.name), marketplace: t(b.marketplace), version: t(b.version) }))),
    foreignPaths: plainList(s.foreignPaths.map(p => ({ path: t(p.path), line: p.line ?? null, text: t(p.text) }))),
  };
}

// ---- arguments --------------------------------------------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/;
const NOTES_ID = /^notes-[0-9]{1,6}$/;
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
  /** Throws the call's own short refusal (BAD_ARGUMENT or UNKNOWN_BUNDLE) or answers from the service. */
  readonly bad: () => never;
  readonly unknownBundle: () => never;
  readonly folderOf: (id: unknown) => ShareFolder;
  readonly answer: <T>(f: { readonly id: string; readonly scrub: Scrub } | null, run: () => Promise<T> | T) => Promise<Answer<T>>;
  readonly written: <T>(f: ShareFolder, kind: 'import', revision: string, choices: unknown, run: () => Promise<T>) => Promise<Answer<T>>;
  readonly scenarioOf: <T>(f: ShareFolder, spec: { step: string }, run: () => Promise<T>) => Promise<T>;
  readonly whileStopped: (f: ShareFolder) => void;
  /** The stored path of a notes folder, by the id main gave it (throws its own refusal). */
  readonly sourcePathOf: (f: ShareFolder, notesId: string) => string;
  readonly hasNotes: (notesId: string) => boolean;
  readonly notesLabel: (notesId: string) => string;
  readonly sourceViewOf: (f: ShareFolder) => SourceOf;
  readonly scrubbed: (f: ShareFolder, d: DefinitionView) => DefinitionView;
  readonly afterImport: (f: ShareFolder) => void;
  readonly record: (input: Readonly<Record<string, unknown>>) => void;
}

interface Held {
  readonly id: string; readonly name: string; readonly bytes: number; readonly sha256: string; readonly harness: string; readonly summary: BundleSummary;
  readonly noteNames: ReadonlySet<string>; readonly generation: number;
}
/** What a window sent as the notes choices, checked: notes names the bundle holds, each linked to a notes id main gave out, or left out. */
interface Choices { readonly link: ReadonlyMap<string, string>; readonly leave: ReadonlySet<string> }

export interface ShareCalls {
  planExport(folderId: unknown): Promise<Answer<ExportView>>;
  runExport(folderId: unknown, revision: unknown, acknowledged: unknown): Promise<Answer<ExportWritten>>;
  chooseBundle(): Promise<Answer<BundleView> | null>;
  planImport(folderId: unknown, bundleId: unknown, choices: unknown): Promise<Answer<ImportView>>;
  runImport(folderId: unknown, revision: unknown, bundleId: unknown, choices: unknown, acknowledged: unknown): Promise<Answer<SaveWritten>>;
  discardBundle(bundleId: unknown): Promise<boolean>;
  close(): void;
}

const refusal = (code: string, message: string): { ok: false; refusal: { code: string; message: string; paths: readonly string[] } } => ({ ok: false, refusal: { code, message, paths: [] } });
const staleWords = (): string => notTheShownPlan().refusal.message;

export function createShare(env: ShareEnv): ShareCalls {
  const held = new Map<string, Held>();
  let counter = 0;
  /** What the last export plan of each folder offered: the file name and its size, for main's question. */
  const facts = new Map<string, { readonly file: string; readonly bytes: number }>();

  const revisionArg = (v: unknown): string => (typeof v === 'string' && HEX64.test(v) ? v : env.bad());
  const ackArg = (v: unknown): string | null => (v === null ? null : revisionArg(v));
  const bundleOf = (id: unknown): Held => {
    if (typeof id !== 'string' || !SHARE_BUNDLE_ID.test(id)) return env.bad();
    const b = held.get(id);
    if (b === undefined) return env.unknownBundle();
    // The worker restarted since: it no longer holds this bundle.
    if (b.generation !== env.host.generation()) { held.delete(id); return env.unknownBundle(); }
    return b;
  };
  /**
   * The notes choices, before any lookup: a plain object with exactly `link` and `leave`; at most SHARE_NOTES_LIMIT names in all, each at most SHARE_NAME_LIMIT characters
   * and a name the bundle holds; a link to a notes id main gave out; no name twice or in both. Own properties only, copied into a Map and a Set.
   */
  const choicesArg = (b: Held, raw: unknown): Choices => {
    if (!plain(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'link') || !Object.hasOwn(raw, 'leave')) return env.bad();
    const linkIn = raw.link, leaveIn = raw.leave;
    if (!plain(linkIn) || !Array.isArray(leaveIn)) return env.bad();
    const entries = Object.entries(linkIn);
    if (entries.length + leaveIn.length > SHARE_NOTES_LIMIT) return env.bad();
    const link = new Map<string, string>(), leave = new Set<string>();
    for (const [name, id] of entries) {
      if (name.length > SHARE_NAME_LIMIT || !b.noteNames.has(name) || typeof id !== 'string' || !NOTES_ID.test(id) || !env.hasNotes(id)) return env.bad();
      link.set(name, id);
    }
    for (const name of leaveIn as unknown[]) {
      if (typeof name !== 'string' || name.length > SHARE_NAME_LIMIT || !b.noteNames.has(name) || link.has(name) || leave.has(name)) return env.bad();
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
    const f = env.folderOf(folderId);
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

  /** Where the person chose to save: an absolute path whose folder is resolved now, outside the harness folder's `.bowerloom`, and the identity of a file already there. */
  async function exportTarget(f: ShareFolder, picked: unknown): Promise<{ path: string; name: string; where: string; identity: Awaited<ReturnType<typeof bundleTargetIdentity>> }> {
    if (typeof picked !== 'string' || !isAbsolute(picked) || picked.includes('\u0000')) throw new BundleRefusal('BUNDLE_USAGE');
    const name = basename(picked);
    if (name === '' || name === '.' || name === '..' || Buffer.byteLength(name) > 255) throw new BundleRefusal('BUNDLE_USAGE');
    let parent: string;
    try { parent = realpathSync(dirname(picked)); } catch (error) {
      throw new BundleRefusal('BUNDLE_FILE_FAILED', [], [], typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : undefined);
    }
    const inside = join(f.dir, '.bowerloom');
    if (parent === inside || parent.startsWith(`${inside}${sep}`)) throw new BundleRefusal('BUNDLE_USAGE');
    const path = join(parent, name);
    return { path, name, where: env.scrubAll(parent), identity: await bundleTargetIdentity(path) };
  }

  async function runExport(folderId: unknown, revision: unknown, acknowledged: unknown): Promise<Answer<ExportWritten>> {
    const f = env.folderOf(folderId), rev = revisionArg(revision), ack = ackArg(acknowledged);
    const stopped = await env.answer(f, () => env.whileStopped(f));
    if (!stopped.ok) return stopped;
    const shown = env.plans.peek(f.id, 'export'), fact = facts.get(f.id);
    if (shown === null || fact === undefined || shown.revision !== rev) return notTheShownPlan();
    // The acknowledgement the plan asked for, before any dialog.
    if ((JSON.parse(shown.choices) as { acknowledged: string | null }).acknowledged !== ack) return refusal(EXPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.EXPORT_NEEDS_ACKNOWLEDGEMENT);
    // Main's own save dialog: the window gets the file name back only.
    const picked = await env.chooseBundleSave(fact.file);
    if (picked === null) return cancelled();
    const target = await env.answer(f, () => exportTarget(f, picked));
    if (!target.ok) return target;
    const { path, name, where, identity } = target.value;
    if (!(await env.confirm(ASK.exportBundle(f.label, name, fact.bytes, rev, identity !== null, where)))) return cancelled();
    env.plans.clear(f.id, 'export');
    return env.answer(f, () => env.scenarioOf(f, { step: 'export' }, async () => {
      // The file is encoded again now; when the harness changed since the plan, it is not the plan shown, and nothing is written.
      const e = await env.host.call<EncodedView>({ op: 'encode', projectDir: f.dir, home: env.home, user: env.user, wantBytes: true });
      if (e.sha256 !== rev || e.bytes === null) throw new DefinitionError(NOT_THE_PLAN_SHOWN, staleWords());
      if (exportAcknowledgement(e.summary, rev) !== ack) throw new DefinitionError(EXPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.EXPORT_NEEDS_ACKNOWLEDGEMENT);
      // `replace` only with the identity of the file the dialog found, which the package compares again right before the rename.
      await writeBundleFile(path, e.bytes, identity === null ? undefined : { replace: identity });
      return { name: f.scrub(name), bytes: e.bytes.length };
    }));
  }

  // ---- import: choose the file -------------------------------------------------------------------------------------------

  async function chooseBundle(): Promise<Answer<BundleView> | null> {
    const picked = await env.chooseBundleOpen();
    if (picked === null) return null;
    return env.answer(null, async () => {
      if (typeof picked !== 'string' || !isAbsolute(picked) || picked.includes('\u0000')) throw new BundleRefusal('BUNDLE_USAGE');
      const read = await readBundleFile(picked);
      // The worker takes the buffer itself. A view onto a larger buffer is copied first, so no other view is cut off.
      const bytes = read.byteOffset === 0 && read.byteLength === read.buffer.byteLength ? read : Uint8Array.from(read);
      counter += 1;
      const id = `bundle-${counter}`;
      const d = await env.host.call<DecodedView>({ op: 'decode', key: id, bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
      const name = env.scrubAll(basename(picked));
      held.set(id, { id, name, bytes: d.bytes, sha256: d.sha256, harness: d.harness, summary: d.summary, noteNames: new Set(d.summary.notes.map(n => n.name)), generation: env.host.generation() });
      while (held.size > SHARE_HELD_BUNDLES) { const old = held.keys().next().value!; held.delete(old); env.host.tell({ op: 'drop', key: old }); }
      return { bundleId: id, name, bytes: d.bytes, harness: env.scrubAll(d.harness), summary: shareSummary(d.summary, env.scrubAll) } satisfies BundleView;
    });
  }

  // ---- import: plan and write ---------------------------------------------------------------------------------------------

  const marksOf = (r: PlanResult): SaveMarks => ({ executables: r.changes.filter(c => r.executables.includes(c.path)).map(c => `.bowerloom/${c.path}`), modeOnly: [], deletes: r.changes.filter(c => c.action === 'delete').length });

  async function planImport(folderId: unknown, bundleId: unknown, choices: unknown): Promise<Answer<ImportView>> {
    const f = env.folderOf(folderId), b = bundleOf(bundleId), c = choicesArg(b, choices);
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
        copiedExecutables: copiedExecutables(changes), acknowledge: r.acknowledge, bundleId: b.id, summary: shareSummary(b.summary, f.scrub), notes,
        ...(r.makes ? { makesHarness: true } : {}),
      };
      const ask: Ask | null = value.noop ? null : ASK.importBundle(f.label, r.changes.length, r.revision, marksOf(r), r.makes);
      env.plans.set(f.id, 'import', { revision: r.revision, choices: canonical(recordOf(b, c, r.acknowledge)), ask } satisfies ShownPlan);
      return value;
    });
  }

  async function runImport(folderId: unknown, revision: unknown, bundleId: unknown, choices: unknown, acknowledged: unknown): Promise<Answer<SaveWritten>> {
    const f = env.folderOf(folderId), rev = revisionArg(revision), b = bundleOf(bundleId), c = choicesArg(b, choices), ack = ackArg(acknowledged);
    const stopped = await env.answer(f, () => env.whileStopped(f));
    if (!stopped.ok) return stopped;
    // A plan that asks for an acknowledgement is written only with it, before any dialog. A plan that is not the one shown is refused below, as every write is.
    const shown = env.plans.peek(f.id, 'import');
    if (shown !== null && shown.revision === rev) {
      const want = JSON.parse(shown.choices) as { bundle: string; acknowledged: string | null };
      if (canonical({ ...want, acknowledged: null }) === canonical(recordOf(b, c, null)) && want.acknowledged !== null && want.acknowledged !== ack) {
        return refusal(IMPORT_NEEDS_ACKNOWLEDGEMENT, SHARE_MAIN_WORDS.IMPORT_NEEDS_ACKNOWLEDGEMENT);
      }
    }
    return env.written(f, 'import', rev, recordOf(b, c, ack), () => env.scenarioOf(f, { step: 'import' }, async () => {
      const r = await env.host.call<WriteResult>({
        op: 'write', key: b.id, choices: wireOf(f, b, c), revision: rev, acknowledged: ack, dirs: f.dirs, now: env.now().toISOString(), projectDir: f.dir, adoptState: f.adoptState,
      }).catch(unknownAsCall);
      env.afterImport(f);
      const warnings = r.warnings.map(w => f.scrub(w));
      return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)), version: r.version, ...(warnings.length > 0 ? { warnings } : {}) } satisfies SaveWritten;
    }));
  }
  /** A bundle the worker no longer holds is the call's own short refusal, as a bundle id main never gave. */
  function unknownAsCall(error: unknown): never {
    if ((error instanceof CodedRefusal && error.code === UNKNOWN_BUNDLE_MARK) || (error as { code?: unknown } | null)?.code === UNKNOWN_BUNDLE_MARK) return env.unknownBundle();
    throw error;
  }

  async function discardBundle(bundleId: unknown): Promise<boolean> {
    if (typeof bundleId !== 'string' || !SHARE_BUNDLE_ID.test(bundleId)) return env.bad();
    const had = held.delete(bundleId);
    if (had) env.host.tell({ op: 'drop', key: bundleId });
    return had;
  }

  return { planExport, runExport, chooseBundle, planImport, runImport, discardBundle, close: () => env.host.close() };
}

/** The user name of the account that runs the app, matched literally in the files of an export. Empty when the system gives none. */
export function accountName(): string {
  try { return userInfo().username; } catch { return ''; }
}
