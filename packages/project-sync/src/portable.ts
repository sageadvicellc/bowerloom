/**
 * The portable projection of Bowerloom 0.8 (portable parts spec; harness definition spec, sections 8, 9, and 13).
 *
 * It writes the portable parts of one harness definition into the project paths of each engine the harness names:
 * the system prompt as `AGENTS.md`, skills as folders under `.claude/skills` and `.agents/skills`, and tool guidance,
 * memory, and commands inside those two. Locked-in parts (MCP servers, subagents, hooks, and guardrails) are not written
 * here. For an engine that has no locked-in writer, a definition that holds one refuses with ENGINE_NO_WRITER.
 *
 * The model is the one project-sync uses for skills sync and apply:
 * - A plan reads only. Its revision binds every input it read, and a person approves that exact revision.
 * - Apply runs under the project lock, plans again, and refuses STALE_APPROVAL unless the revision is the approved one.
 * - Before it overwrites or deletes a file, apply saves the bytes in the private state folder, and it journals each
 *   step in a pending marker there. A failure rolls back at once. A crash leaves the marker, and every later plan refuses
 *   PORTABLE_RECOVERY_REQUIRED until `applyPortableRecovery` rolls it back or finds the run complete.
 * - The receipt records the engines, their versions, the definition revision, and each written path with its hash, its
 *   file mode, and the file it replaced. Removal restores those files.
 */
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { canonicalJson, DefinitionError, oneLine } from '../../contracts/src/index.js';
import { ENGINE_IDS, isEngineId, loadDefinition, selectForEngine } from '../../harness-definition/src/index.js';
import type { Definition, EngineId, LossLine, Problem, SkillEntry } from '../../harness-definition/src/index.js';
import { EngineWriterRefusal, isWriterEngine } from '../../skill-manifest/src/engine.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { syncError } from './refusal.js';

export const PORTABLE_PLAN_FORMAT = 'bowerloom/portable-projection-plan/v1beta1' as const;
export const PORTABLE_RECEIPT_FORMAT = 'bowerloom/portable-projection-receipt/v1beta1' as const;
export const PORTABLE_REMOVAL_FORMAT = 'bowerloom/portable-removal-plan/v1beta1' as const;
export const PORTABLE_RECOVERY_FORMAT = 'bowerloom/portable-recovery-plan/v1beta1' as const;
const PENDING_FORMAT = 'bowerloom/portable-pending/v1beta1' as const;

// ---- engine facts (portable parts spec, sections 4.1 and 4.2) ----------------------------------------------------------

export type SkillRoot = '.claude/skills' | '.agents/skills';
/**
 * The project skill folders Bowerloom writes for each engine (section 4.2). Codex, Pi, and DeepSeek Harness share one
 * copy in `.agents/skills`. Pi and DeepSeek Harness get no private path, so no skill appears twice. OpenCode gets both.
 */
export const SKILL_ROOTS: Readonly<Record<EngineId, readonly SkillRoot[]>> = Object.freeze({
  'claude-code': Object.freeze(['.claude/skills'] as const),
  codex: Object.freeze(['.agents/skills'] as const),
  opencode: Object.freeze(['.claude/skills', '.agents/skills'] as const),
  pi: Object.freeze(['.agents/skills'] as const),
  'deepseek-harness': Object.freeze(['.agents/skills'] as const),
});

/** The text of a `CLAUDE.md` that follows `AGENTS.md` (decision 5): the single line `@AGENTS.md`. */
export const FOLLOW_TEXT = '@AGENTS.md\n';
/** True for the text of a `CLAUDE.md` that follows `AGENTS.md`, with or without its final newline. */
export const followsAgents = (text: string): boolean => text === FOLLOW_TEXT || text === '@AGENTS.md';

/**
 * For a tree that holds both `AGENTS.md` and a `CLAUDE.md` that does not follow it: which file each engine does not
 * load (section 4.1, rules 4 to 7). DeepSeek Harness loads both unless their text is identical, so it hides neither.
 */
export const HIDDEN_FILE: Readonly<Record<EngineId, { readonly hidden: 'AGENTS.md' | 'CLAUDE.md' | null; readonly rule: string }>> = Object.freeze({
  'claude-code': { hidden: 'AGENTS.md', rule: 'Claude Code reads CLAUDE.md. It reads AGENTS.md only when no CLAUDE.md or CLAUDE.local.md exists.' },
  codex: { hidden: 'CLAUDE.md', rule: 'Codex reads AGENTS.md and does not read CLAUDE.md.' },
  opencode: { hidden: 'CLAUDE.md', rule: 'OpenCode reads AGENTS.md. Version 1.x reads CLAUDE.md only when no AGENTS.md exists.' },
  pi: { hidden: 'CLAUDE.md', rule: 'Pi reads one instruction file per folder, and AGENTS.md hides CLAUDE.md.' },
  'deepseek-harness': { hidden: null, rule: 'DeepSeek Harness loads both files unless their text is identical.' },
});

/** The three ways a person reconciles a `CLAUDE.md` that does not follow `AGENTS.md` (section 4.1, rule 5). */
export const RECONCILE_ACTIONS = Object.freeze(['accept-agents', 'merge', 'keep-both'] as const);
export type ReconcileAction = (typeof RECONCILE_ACTIONS)[number];

/**
 * The metadata key and value that mark a skill as a command (section 4.5). A portable command is a skill; the mark only
 * makes the loss report say `translated` for it. It uses the open `metadata` field, so `SKILL.md` stays portable.
 */
export const COMMAND_METADATA = Object.freeze({ key: 'bowerloom-kind', value: 'command' } as const);

/** The byte limit of the projected `AGENTS.md`: Codex stops loading instructions at 32 KiB by default (section 4.1, rule 3). */
export const INSTRUCTIONS_LIMIT = 32 * 1024;

// ---- refusals ----------------------------------------------------------------------------------------------------------

const MESSAGES = {
  PORTABLE_DEFINITION_INVALID: 'The harness definition cannot be loaded, so nothing was projected.',
  PORTABLE_AT_IMPORT: 'instructions/AGENTS.md uses an @path import. Only Claude Code expands one; Codex and OpenCode read it as text. Nothing was projected.',
  PORTABLE_INSTRUCTIONS_TOO_LARGE: 'instructions/AGENTS.md is larger than 32 KiB, where Codex stops loading instructions. Nothing was projected.',
  PORTABLE_ENGINE_NOT_LISTED: 'The projection names an engine that harness.json does not list. Nothing was projected.',
  PORTABLE_MERGE_NOT_BUILT: 'Merge moves the CLAUDE.md text into the definition, and this projection does not edit the definition. Choose Accept AGENTS.md or Keep both. Nothing was projected.',
  PORTABLE_PATH_UNSAFE: 'A path Bowerloom would write or restore is a link, is not a plain file or folder, has more than one link, is not yours, or is larger than 1 MiB. Nothing was changed.',
  PORTABLE_PATH_OCCUPIED: 'A skill folder Bowerloom would write already holds files that Bowerloom did not project. Nothing was changed.',
  PORTABLE_DRIFT: 'A file Bowerloom projected was changed since it was written. Nothing was changed.',
  PORTABLE_STATE_UNSAFE: 'The private state folder of the projection is not safe: it must be a real folder you own, mode 0700, outside the project.',
  PORTABLE_RECOVERY_REQUIRED: 'An earlier projection or removal stopped part way. Nothing was changed. Recover it first.',
  PORTABLE_NOTHING_PROJECTED: 'This project has no projection receipt, so there is nothing to remove.',
  PORTABLE_RECOVER_NOTHING: 'No projection or removal of this project is unfinished.',
  PORTABLE_USAGE: 'The projection input is not valid.',
} as const;
export type PortableCode = keyof typeof MESSAGES;
export const PORTABLE_REFUSAL_CODES: readonly PortableCode[] = Object.freeze(Object.keys(MESSAGES) as PortableCode[]);

/** A projection refusal. `paths` names the project-relative paths it is about, `problems` the loader's problems. */
export class PortableRefusal extends DefinitionError {
  constructor(code: PortableCode, readonly paths: readonly string[] = [], readonly problems: readonly Problem[] = []) {
    super(code, paths.length ? `${MESSAGES[code]} ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : MESSAGES[code]);
    this.name = 'PortableRefusal';
  }
}
function refuse(code: PortableCode, paths: readonly string[] = [], problems: readonly Problem[] = []): never { throw new PortableRefusal(code, paths, problems); }

// ---- @path imports (section 4.1, rule 2) -------------------------------------------------------------------------------

/**
 * The `@path` imports of a Markdown text, outside fenced code and inline code, with their line numbers. A token counts
 * when `@` starts a word and the rest names a file: it holds `/` or `.`, or starts with `~`. So `@AGENTS.md`,
 * `@docs/a.md`, and `@~/x` count, and a mention such as `@someone` or an address such as `a@b.dev` does not.
 */
export function atImports(markdown: string): { readonly line: number; readonly token: string }[] {
  const out: { line: number; token: string }[] = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((raw, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (f) { if (fence === null) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; return; }
    if (fence !== null) return;
    const line = raw.replace(/(`+)[^`]*?\1/g, ' ');
    for (const m of line.matchAll(/(?:^|[\s([{<"'*_])@([^\s)\]}>"'`]+)/g)) {
      const token = m[1]!.replace(/[.,;:!?]+$/, '');
      if (token.length > 0 && (token.includes('/') || token.includes('.') || token.startsWith('~'))) out.push({ line: i + 1, token: '@' + token });
    }
  });
  return out;
}

// ---- types -------------------------------------------------------------------------------------------------------------

export interface PortableEngine { readonly id: EngineId; readonly version: string | null }
export interface FileState { readonly sha256: string; readonly mode: number }
export interface FileAfter extends FileState { readonly bytes: number }

export interface PortableInput {
  /** The real absolute path of the project folder. */
  readonly projectDir: string;
  /** The `.bowerloom` folder that holds `harness.json`. */
  readonly definitionFolder: string;
  /** The private state folder of this projection, outside the project. Apply creates it, mode 0700. */
  readonly stateDir: string;
  /** The engines to project to, each listed in harness.json. Default: every engine harness.json lists. */
  readonly engines?: readonly { readonly id: EngineId; readonly version?: string }[];
  /** How to reconcile a `CLAUDE.md` that does not follow `AGENTS.md`. Default: accept-agents. */
  readonly reconcile?: ReconcileAction;
  /** True once a person saved trust for this project in Pi. Default: false, so Pi skills are `pending trust`. */
  readonly piTrustSaved?: boolean;
}

/** The drift report of a tree with both `AGENTS.md` and a `CLAUDE.md` that does not follow it (section 4.1, rule 5). */
export interface InstructionDrift {
  readonly claude: FileState;
  /** `present`: the tree holds `AGENTS.md`. `planned`: the projection writes it. */
  readonly agents: 'present' | 'planned';
  readonly engines: readonly { readonly engine: EngineId; readonly hidden: 'AGENTS.md' | 'CLAUDE.md' | null; readonly rule: string }[];
  readonly actions: readonly ReconcileAction[];
  readonly defaultAction: 'accept-agents';
}

export type ChangeAction = 'create' | 'replace' | 'update' | 'unchanged' | 'restore' | 'delete';
export interface PlannedChange {
  /** Relative to the project folder, with `/`. */
  readonly path: string;
  /**
   * `create`: no file was there. `replace`: a file Bowerloom did not write is saved and replaced. `update`: a file
   * Bowerloom wrote changes. `unchanged`: it stays. `restore`: Bowerloom no longer projects it and puts back the file it
   * replaced. `delete`: Bowerloom no longer projects it and nothing was there before.
   */
  readonly action: ChangeAction;
  readonly before: FileState | null;
  readonly after: FileAfter | null;
  /** The file this path held before Bowerloom first wrote it, kept for removal. */
  readonly original: FileState | null;
  /** The engines that load this file. Empty for `restore` and `delete`. */
  readonly engines: readonly EngineId[];
}

/** A part that this projection does not write, and why. */
export interface Deferred {
  readonly engine: EngineId;
  readonly part: 'subagents' | 'guardrails' | 'hooks' | 'mcp' | 'scripts' | 'engine-private' | 'skill-private';
  readonly id: string;
}

/** A skill that an engine loads although its engine filter leaves that engine out, because the engine reads the folder. */
export interface FilterLeak { readonly skill: string; readonly path: string; readonly engines: readonly EngineId[] }

export interface PortablePlan {
  readonly format: typeof PORTABLE_PLAN_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly definition: { readonly folder: string; readonly harness: string; readonly revision: string };
  readonly engines: readonly PortableEngine[];
  /** Every path the projection writes, keeps, restores, or deletes, in byte order. */
  readonly changes: readonly PlannedChange[];
  /** Folders apply creates, relative to the project, parents first. */
  readonly createDirs: readonly string[];
  readonly drift: InstructionDrift | null;
  /** The reconcile action this plan carries out, or null when there is no drift. */
  readonly reconcile: ReconcileAction | null;
  readonly loss: readonly LossLine[];
  /** Skills that Pi skips in non-interactive runs until a person saves trust for the project. */
  readonly pendingTrust: readonly string[];
  readonly filterLeaks: readonly FilterLeak[];
  readonly deferred: readonly Deferred[];
  readonly previousReceipt: string | null;
  /** True when apply would write nothing: every change is `unchanged` and the receipt would be the same. */
  readonly noop: boolean;
  readonly writesAuthorized: false;
  readonly revision: string;
}

export interface ReceiptFile extends FileAfter {
  readonly path: string;
  readonly engines: readonly EngineId[];
  readonly original: FileState | null;
}
export interface PortableReceipt {
  readonly format: typeof PORTABLE_RECEIPT_FORMAT;
  readonly projectDir: string;
  readonly definition: { readonly folder: string; readonly harness: string; readonly revision: string };
  readonly engines: readonly PortableEngine[];
  readonly files: readonly ReceiptFile[];
  /** Folders the projection created, relative to the project, parents first. Removal deletes each that is empty. */
  readonly createdDirs: readonly string[];
  readonly planRevision: string;
  readonly revision: string;
}

export interface PortableRemovalPlan {
  readonly format: typeof PORTABLE_REMOVAL_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly receipt: string;
  readonly changes: readonly PlannedChange[];
  readonly removeDirs: readonly string[];
  readonly writesAuthorized: false;
  readonly revision: string;
}
export interface PortableRemovalResult { readonly planRevision: string; readonly restored: readonly string[]; readonly deleted: readonly string[] }

export interface PortableRecoveryPlan {
  readonly format: typeof PORTABLE_RECOVERY_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  /** `complete`: the receipt was written, so the run finished and only the marker goes. `rollback`: every step is undone. */
  readonly action: 'complete' | 'rollback';
  readonly steps: readonly { readonly path: string; readonly now: FileState | null; readonly back: FileState | null }[];
  readonly revision: string;
}
export type PortableApplyResult = { readonly noop: true; readonly planRevision: string } | { readonly noop: false; readonly receipt: PortableReceipt };

// ---- small file helpers ------------------------------------------------------------------------------------------------

const MAX_FILE = 1024 * 1024;
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const revisionOf = (body: unknown): string => sha(canonicalJson(body));
const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const uid = (): number | undefined => process.getuid?.();

/** The bytes and state of a plain file of this user, or null when nothing is there. Anything else refuses PORTABLE_PATH_UNSAFE. */
function readFile(abs: string, rel: string): { bytes: Buffer; state: FileState } | null {
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch (e) { const c = (e as NodeJS.ErrnoException).code; if (c === 'ENOENT') return null; return refuse('PORTABLE_PATH_UNSAFE', [rel]); }
  if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || st.size > MAX_FILE) refuse('PORTABLE_PATH_UNSAFE', [rel]);
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return refuse('PORTABLE_PATH_UNSAFE', [rel]); }
  try {
    const open = fs.fstatSync(fd);
    if (!open.isFile() || open.ino !== st.ino || open.dev !== st.dev || open.size > MAX_FILE) refuse('PORTABLE_PATH_UNSAFE', [rel]);
    const bytes = Buffer.alloc(open.size); let at = 0;
    while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); if (n === 0) break; at += n; }
    if (at !== open.size || fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) refuse('PORTABLE_PATH_UNSAFE', [rel]);
    return { bytes, state: { sha256: sha(bytes), mode: open.mode & 0o777 } };
  } finally { fs.closeSync(fd); }
}
const stateOf = (abs: string, rel: string): FileState | null => readFile(abs, rel)?.state ?? null;
const sameState = (a: FileState | null, b: FileState | null): boolean => a === null ? b === null : b !== null && a.sha256 === b.sha256 && a.mode === b.mode;

/**
 * The folders between the project and a file that do not exist yet, parents first. Every folder that exists must be a
 * real folder of this user, not a link; anything else refuses PORTABLE_PATH_UNSAFE.
 */
function missingDirs(projectDir: string, rel: string): string[] {
  const parts = rel.split('/').slice(0, -1), out: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    let st: fs.Stats;
    try { st = fs.lstatSync(join(projectDir, dir)); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') refuse('PORTABLE_PATH_UNSAFE', [dir]);
      out.push(...parts.slice(i - 1).map((_, j) => parts.slice(0, i + j).join('/'))); break;
    }
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid()) refuse('PORTABLE_PATH_UNSAFE', [dir]);
  }
  return out;
}

function syncDir(dir: string): void { const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

/** Writes `bytes` at `abs` with `mode`: a fresh temporary in the same folder, flushed, then renamed over the target. */
function writeAtomic(abs: string, bytes: Uint8Array, mode: number): void {
  const temp = join(dirname(abs), `.${abs.slice(dirname(abs).length + 1)}.${randomBytes(8).toString('hex')}.bowerloom-tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let moved = false;
  try {
    try { let at = 0; while (at < bytes.length) at += fs.writeSync(fd, bytes, at); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, abs); moved = true; syncDir(dirname(abs));
  } finally { if (!moved) { try { fs.unlinkSync(temp); } catch { /* already gone */ } } }
}

// ---- private state -----------------------------------------------------------------------------------------------------

const RECEIPT = 'receipt.json', PENDING = 'pending.json', BLOBS = 'blobs';

function checkPaths(projectDir: unknown, stateDir: unknown): asserts projectDir is string {
  for (const p of [projectDir, stateDir]) if (typeof p !== 'string' || !isAbsolute(p) || p.includes('\0') || p.endsWith('/')) refuse('PORTABLE_USAGE');
  const project = projectDir as string, state = stateDir as string;
  let real: string;
  try { real = fs.realpathSync(project); } catch { return refuse('PORTABLE_USAGE'); }
  if (real !== project || !fs.lstatSync(project).isDirectory()) refuse('PORTABLE_USAGE');
  if (state === project || state.startsWith(project + '/') || project.startsWith(state + '/')) refuse('PORTABLE_STATE_UNSAFE');
}

/** True when the state folder exists. It must then be a private folder of this user. */
function stateExists(stateDir: string): boolean {
  let st: fs.Stats;
  try { st = fs.lstatSync(stateDir); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; return refuse('PORTABLE_STATE_UNSAFE'); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid() || (st.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  return true;
}

function readRecord<T>(stateDir: string, name: string): T | null {
  if (!stateExists(stateDir)) return null;
  const got = readFile(join(stateDir, name), name);
  if (got === null) return null;
  if ((got.state.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  try { return JSON.parse(got.bytes.toString('utf8')) as T; } catch { return refuse('PORTABLE_STATE_UNSAFE'); }
}

/** The receipt of the projection in this state folder, or null. */
export function readPortableReceipt(stateDir: string): PortableReceipt | null {
  const r = readRecord<PortableReceipt>(stateDir, RECEIPT);
  if (r === null) return null;
  const { revision, ...body } = r;
  if (r.format !== PORTABLE_RECEIPT_FORMAT || revision !== revisionOf(body)) refuse('PORTABLE_STATE_UNSAFE');
  return r;
}

function ensureState(stateDir: string): void {
  if (!stateExists(stateDir)) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  stateExists(stateDir);
  const blobs = join(stateDir, BLOBS);
  if (!fs.existsSync(blobs)) fs.mkdirSync(blobs, { mode: 0o700 });
  stateExists(blobs);
}
function writeRecord(stateDir: string, name: string, value: unknown): void { writeAtomic(join(stateDir, name), Buffer.from(JSON.stringify(value, null, 2) + '\n'), 0o600); }

/** Saves the bytes of a file into the state folder, by hash. */
function saveBlob(stateDir: string, bytes: Uint8Array): void {
  const at = join(stateDir, BLOBS, sha(bytes));
  if (readFile(at, BLOBS)?.state.sha256 === sha(bytes)) return;
  writeAtomic(at, bytes, 0o600);
}
function blob(stateDir: string, state: FileState, rel: string): Buffer {
  const got = readFile(join(stateDir, BLOBS, state.sha256), BLOBS);
  if (got === null || got.state.sha256 !== state.sha256) return refuse('PORTABLE_STATE_UNSAFE', [rel]);
  return got.bytes;
}

// ---- the drift report --------------------------------------------------------------------------------------------------

/**
 * The drift report for a tree that holds `AGENTS.md` (or a projection that writes it) and a `CLAUDE.md` that does not
 * follow it. Null when there is no such drift. It names the hidden file for each engine, and offers Accept AGENTS.md as
 * the default action.
 */
export function instructionDrift(projectDir: string, engines: readonly EngineId[], agentsPlanned = false): InstructionDrift | null {
  const claude = readFile(join(projectDir, 'CLAUDE.md'), 'CLAUDE.md');
  if (claude === null || followsAgents(claude.bytes.toString('utf8'))) return null;
  const agents = readFile(join(projectDir, 'AGENTS.md'), 'AGENTS.md') !== null ? 'present' : agentsPlanned ? 'planned' : null;
  if (agents === null) return null;
  const listed = ENGINE_IDS.filter(e => engines.includes(e));
  return { claude: claude.state, agents, engines: listed.map(engine => ({ engine, ...HIDDEN_FILE[engine] })), actions: RECONCILE_ACTIONS, defaultAction: 'accept-agents' };
}

// ---- the plan ----------------------------------------------------------------------------------------------------------

interface Target { bytes: Uint8Array; mode: number; engines: Set<EngineId> }

function load(folder: string): Definition {
  if (typeof folder !== 'string' || !isAbsolute(folder)) return refuse('PORTABLE_USAGE');
  const r = loadDefinition(folder);
  if (!r.ok) return refuse('PORTABLE_DEFINITION_INVALID', [...new Set(r.problems.map(p => `${p.path} (${p.code})`))], r.problems);
  return r.definition;
}

function enginesOf(def: Definition, wanted: PortableInput['engines']): PortableEngine[] {
  const listed = new Map(def.harness.engines.map(e => [e.id, e.version ?? null]));
  const list: readonly { readonly id: EngineId; readonly version?: string }[] = wanted ?? def.harness.engines.map(e => ({ id: e.id }));
  if (!Array.isArray(list) || list.length === 0) return refuse('PORTABLE_USAGE');
  const out = new Map<EngineId, string | null>();
  for (const e of list) {
    if (!isEngineId(e?.id) || out.has(e.id)) return refuse('PORTABLE_USAGE');
    if (!listed.has(e.id)) return refuse('PORTABLE_ENGINE_NOT_LISTED', [e.id]);
    if (e.version !== undefined && (typeof e.version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(e.version))) return refuse('PORTABLE_USAGE');
    out.set(e.id, e.version ?? listed.get(e.id) ?? null);
  }
  return ENGINE_IDS.filter(id => out.has(id)).map(id => ({ id, version: out.get(id)! }));
}

const isCommand = (s: SkillEntry): boolean => s.metadata?.[COMMAND_METADATA.key] === COMMAND_METADATA.value;

/** Plans the projection. Reads only. A refusal is a PortableRefusal, or an EngineWriterRefusal for a locked-in part. */
export function planPortable(input: PortableInput): PortablePlan {
  if (input === null || typeof input !== 'object') return refuse('PORTABLE_USAGE');
  checkPaths(input.projectDir, input.stateDir);
  const { projectDir, stateDir } = input;
  if (readRecord<unknown>(stateDir, PENDING) !== null) refuse('PORTABLE_RECOVERY_REQUIRED');
  const reconcileWanted = input.reconcile ?? 'accept-agents';
  if (!RECONCILE_ACTIONS.includes(reconcileWanted)) refuse('PORTABLE_USAGE');
  const def = load(input.definitionFolder);
  const engines = enginesOf(def, input.engines), ids = engines.map(e => e.id);
  const harnessIds = def.harness.engines.map(e => e.id);

  // Section 4.1: the system prompt. No @path import, and at most 32 KiB.
  const instructions = def.instructions;
  if (instructions !== undefined) {
    const found = atImports(instructions);
    if (found.length) refuse('PORTABLE_AT_IMPORT', found.map(f => `instructions/AGENTS.md line ${f.line}`));
    if (Buffer.byteLength(instructions) > INSTRUCTIONS_LIMIT) refuse('PORTABLE_INSTRUCTIONS_TOO_LARGE');
  }

  // Locked-in parts. An engine with no writer for them refuses; the others leave them to their own lane.
  const deferred: Deferred[] = [];
  const views = new Map(ids.map(id => [id, selectForEngine(def, id)] as const));
  for (const [engine, view] of views) {
    const locked: Deferred[] = [
      ...view.subagents.map(e => ({ engine, part: 'subagents' as const, id: e.id })),
      ...[...view.rules, ...view.sandbox].map(e => ({ engine, part: 'guardrails' as const, id: e.id })),
      ...view.hooks.map(e => ({ engine, part: 'hooks' as const, id: e.id })),
      ...view.mcp.map(e => ({ engine, part: 'mcp' as const, id: e.id })),
    ];
    if (locked.length && !isWriterEngine(engine)) throw new EngineWriterRefusal(engine);
    deferred.push(...locked, ...def.scripts.map(id => ({ engine, part: 'scripts' as const, id })), ...view.enginePrivate.map(id => ({ engine, part: 'engine-private' as const, id })));
    for (const s of view.skills) if (s.privateBlocks[engine] !== undefined) deferred.push({ engine, part: 'skill-private', id: s.id });
  }

  // The targets: AGENTS.md, the skill folders, and CLAUDE.md when a person accepts AGENTS.md.
  const targets = new Map<string, Target>();
  const add = (path: string, bytes: Uint8Array, mode: number, engine: EngineId): void => {
    const t = targets.get(path);
    if (t) t.engines.add(engine); else targets.set(path, { bytes, mode, engines: new Set([engine]) });
  };
  if (instructions !== undefined) for (const id of ids) add('AGENTS.md', Buffer.from(instructions), 0o644, id);
  const files = new Map(def.files.map(f => [f.path, f]));
  const skillsById = new Map<string, SkillEntry>();
  for (const [engine, view] of views) for (const s of view.skills) {
    skillsById.set(s.id, s);
    for (const root of SKILL_ROOTS[engine]) for (const rel of s.files) {
      const f = files.get(`skills/${s.id}/${rel}`)!;
      add(`${root}/${s.name}/${rel}`, f.bytes, f.executable ? 0o755 : 0o644, engine);
    }
  }

  const previous = readPortableReceipt(stateDir);
  const owned = new Map((previous?.files ?? []).map(f => [f.path, f]));

  // Section 4.1, rules 4 to 6: CLAUDE.md follows AGENTS.md. A CLAUDE.md this projection made stays as long as it follows.
  const drift = instructionDrift(projectDir, harnessIds, instructions !== undefined);
  let reconcile: ReconcileAction | null = null;
  if (drift) {
    reconcile = reconcileWanted;
    if (reconcile === 'merge') refuse('PORTABLE_MERGE_NOT_BUILT');
    if (reconcile === 'accept-agents') for (const id of ids) add('CLAUDE.md', Buffer.from(FOLLOW_TEXT), 0o644, id);
  } else if (owned.has('CLAUDE.md') && instructions !== undefined) for (const id of ids) add('CLAUDE.md', Buffer.from(FOLLOW_TEXT), 0o644, id);

  // Skill folders that Bowerloom did not project are never written into.
  const occupied: string[] = [];
  const folders = new Set([...targets.keys()].filter(p => p.startsWith('.claude/skills/') || p.startsWith('.agents/skills/')).map(p => p.split('/').slice(0, 3).join('/')));
  for (const folder of folders) {
    const ownsAny = [...owned.keys()].some(p => p.startsWith(folder + '/'));
    if (!ownsAny && missingDirs(projectDir, folder + '/x').length === 0) occupied.push(folder);
  }
  if (occupied.length) refuse('PORTABLE_PATH_OCCUPIED', occupied);

  // The changes, against the receipt and the files on disk.
  const changes: PlannedChange[] = [], drifted: string[] = [];
  const createDirs = new Set<string>();
  for (const path of [...new Set([...targets.keys(), ...owned.keys()])].sort(byBytes)) {
    const target = targets.get(path), mine = owned.get(path);
    for (const d of missingDirs(projectDir, path)) if (target) createDirs.add(d);
    const now = stateOf(join(projectDir, path), path);
    if (mine && !sameState(now, mine)) { drifted.push(path); continue; }
    if (!target) {
      changes.push({ path, action: mine!.original ? 'restore' : 'delete', before: now, after: null, original: mine!.original, engines: [] });
      continue;
    }
    const after: FileAfter = { sha256: sha(target.bytes), mode: target.mode, bytes: target.bytes.length };
    const action: ChangeAction = mine ? (sameState(now, after) ? 'unchanged' : 'update') : now === null ? 'create' : 'replace';
    const original = mine ? mine.original : now;
    changes.push({ path, action, before: now, after, original, engines: ENGINE_IDS.filter(e => target.engines.has(e)) });
  }
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted);

  // The loss report: one line per portable part, entry, and engine (section 6).
  const loss: LossLine[] = [];
  const parts = def.harness.parts;
  for (const { id: engine } of engines) {
    if (instructions !== undefined) {
      const keep = reconcile === 'keep-both' && engine === 'claude-code';
      loss.push({
        part: 'system-prompt', entry: 'AGENTS.md', engine, result: keep ? 'weakened' : 'exact',
        reason: keep ? 'CLAUDE.md does not follow AGENTS.md, so Claude Code does not load AGENTS.md. Keep both leaves the drift reported.'
          : engine === 'claude-code' ? (targets.has('CLAUDE.md') ? 'CLAUDE.md is the single line @AGENTS.md, so Claude Code loads AGENTS.md.' : 'No CLAUDE.md exists, so Claude Code 2.1.277 or later reads AGENTS.md.')
          : engine === 'pi' ? 'Pi reads AGENTS.md, and AGENTS.md hides CLAUDE.md.' : 'The engine reads AGENTS.md as written.',
      });
    }
    if (parts.memory !== undefined) loss.push({ part: 'memory', entry: 'instructions', engine, result: 'translated', reason: 'Standing facts project as instructions in AGENTS.md. Engine-written memory is runtime state and is not projected.' });
    for (const pointer of parts['tool-guidance'] ?? []) {
      const skill = /^skills\/(.+)$/.exec(pointer)?.[1];
      if (skill !== undefined && !views.get(engine)!.skills.some(s => s.id === skill)) continue;
      loss.push({ part: 'tool-guidance', entry: pointer, engine, result: 'exact', reason: skill !== undefined ? 'Tool guidance projects as the body of a skill.' : 'Tool guidance projects as a section of AGENTS.md.' });
    }
    for (const s of views.get(engine)!.skills) {
      const trust = engine === 'pi' && input.piTrustSaved !== true ? ' Pending trust: Pi skips project .agents/skills in non-interactive runs until a person saves trust.' : '';
      loss.push(isCommand(s)
        ? { part: 'skills', entry: s.id, engine, result: 'translated', reason: `A command projects as a skill in ${SKILL_ROOTS[engine].join(' and ')}. Bowerloom writes no command file.${trust}` }
        : { part: 'skills', entry: s.id, engine, result: 'exact', reason: `The engine reads ${SKILL_ROOTS[engine].join(' and ')}.${trust}` });
    }
  }

  const pendingTrust = ids.includes('pi') && input.piTrustSaved !== true ? views.get('pi')!.skills.map(s => s.id) : [];

  // Engines that load a skill their filter leaves out, because they read the folder it is in.
  const filterLeaks: FilterLeak[] = [];
  for (const s of [...skillsById.values()].sort((a, b) => byBytes(a.id, b.id))) {
    for (const root of ['.claude/skills', '.agents/skills'] as const) {
      if (!targets.has(`${root}/${s.name}/SKILL.md`)) continue;
      const leak = harnessIds.filter(e => SKILL_ROOTS[e].includes(root) && s.engines !== undefined && !s.engines.includes(e));
      if (leak.length) filterLeaks.push({ skill: s.id, path: `${root}/${s.name}`, engines: ENGINE_IDS.filter(e => leak.includes(e)) });
    }
  }

  const definition = { folder: def.folder, harness: def.harness.id, revision: def.revision };
  const receiptFiles = receiptFilesOf(changes);
  const sameReceipt = previous !== null && canonicalJson({ d: previous.definition, e: previous.engines, f: previous.files, c: previous.createdDirs })
    === canonicalJson({ d: definition, e: engines, f: receiptFiles, c: createdDirsOf(previous, createDirs, receiptFiles) });
  const noop = changes.every(c => c.action === 'unchanged') && sameReceipt;
  const body = {
    format: PORTABLE_PLAN_FORMAT, projectDir, stateDir, definition, engines, changes, createDirs: [...createDirs].sort(byBytes),
    drift, reconcile, loss, pendingTrust, filterLeaks, deferred, previousReceipt: previous?.revision ?? null, noop, writesAuthorized: false as const,
  };
  return { ...body, revision: revisionOf(body) };
}

function receiptFilesOf(changes: readonly PlannedChange[]): ReceiptFile[] {
  return changes.filter(c => c.after !== null).map(c => ({ path: c.path, ...c.after!, engines: c.engines, original: c.original }));
}
/** The created folders a receipt keeps: the earlier ones that still hold a projected file, and the new ones. */
function createdDirsOf(previous: PortableReceipt | null, fresh: Iterable<string>, files: readonly ReceiptFile[]): string[] {
  const kept = (previous?.createdDirs ?? []).filter(d => files.some(f => f.path.startsWith(d + '/')));
  return [...new Set([...kept, ...fresh])].sort(byBytes);
}

// ---- the journaled run ---------------------------------------------------------------------------------------------------

interface Step { path: string; from: FileState | null; to: FileState | null }
interface Pending { format: typeof PENDING_FORMAT; kind: 'apply' | 'remove'; planRevision: string; steps: Step[]; dirs: string[] }

/** Writes the state a step wants. `bytes` null deletes the file. Checks the file is still `expect` first. */
function put(projectDir: string, rel: string, expect: FileState | null, bytes: Uint8Array | null, mode: number): void {
  const abs = join(projectDir, rel);
  if (!sameState(stateOf(abs, rel), expect)) throw syncError('STALE_APPROVAL');
  if (bytes === null) { if (expect !== null) { fs.unlinkSync(abs); syncDir(dirname(abs)); } return; }
  writeAtomic(abs, bytes, mode);
}

/** Undoes the steps of a journal, last first: each file that holds its new state gets its old one back. */
function rollback(projectDir: string, stateDir: string, pending: Pending): void {
  for (const step of [...pending.steps].reverse()) {
    const now = stateOf(join(projectDir, step.path), step.path);
    if (sameState(now, step.from)) continue;
    if (!sameState(now, step.to)) refuse('PORTABLE_DRIFT', [step.path]);
    put(projectDir, step.path, now, step.from === null ? null : blob(stateDir, step.from, step.path), step.from?.mode ?? 0o644);
  }
  removeEmptyDirs(projectDir, pending.dirs);
}
function removeEmptyDirs(projectDir: string, dirs: readonly string[]): void {
  for (const d of [...dirs].sort(byBytes).reverse()) {
    const abs = join(projectDir, d);
    try { const st = fs.lstatSync(abs); if (st.isDirectory() && !st.isSymbolicLink() && fs.readdirSync(abs).length === 0) { fs.rmdirSync(abs); syncDir(dirname(abs)); } } catch { /* gone, or not ours to remove */ }
  }
}
function finish(stateDir: string, keep: ReadonlySet<string>): void {
  const blobs = join(stateDir, BLOBS);
  for (const name of fs.readdirSync(blobs)) if (!keep.has(name)) fs.unlinkSync(join(blobs, name));
  fs.unlinkSync(join(stateDir, PENDING)); syncDir(stateDir);
}

/** Test hooks. Product code passes nothing. An error with `crash: true` thrown by `afterStep` stands for a killed process: no rollback. */
export interface PortableHooks { readonly afterStep?: (path: string) => void }

/** Runs the journaled steps. A failure rolls back what was done, then throws the failure. */
function run(projectDir: string, stateDir: string, pending: Pending, steps: readonly { step: Step; bytes: Uint8Array | null }[], held: HeldProjectLock, hooks: PortableHooks): void {
  writeRecord(stateDir, PENDING, pending);
  try {
    for (const d of pending.dirs) { held.assertHeld(projectDir); missingDirs(projectDir, d + '/x'); fs.mkdirSync(join(projectDir, d), { mode: 0o755 }); fs.chmodSync(join(projectDir, d), 0o755); }
    for (const { step, bytes } of steps) { held.assertHeld(projectDir); put(projectDir, step.path, step.from, bytes, step.to?.mode ?? 0o644); hooks.afterStep?.(step.path); }
  } catch (error) {
    if (hooks.afterStep !== undefined && (error as { crash?: unknown } | null)?.crash === true) throw error;
    try { rollback(projectDir, stateDir, pending); fs.unlinkSync(join(stateDir, PENDING)); } catch { /* the marker stays: recovery is required */ }
    throw error;
  }
}

/**
 * Applies the projection whose revision a person approved. It plans again under the project lock and refuses
 * STALE_APPROVAL for any other revision. A plan with nothing to do writes nothing, not even the receipt.
 */
export async function applyPortable(input: PortableInput, revision: string, signal: AbortSignal = new AbortController().signal, hooks: PortableHooks = {}): Promise<PortableApplyResult> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const plan = planPortable(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    if (plan.noop) return { noop: true, planRevision: plan.revision };
    const { projectDir, stateDir } = plan;
    ensureState(stateDir);
    // Bytes of every target, from the definition the plan read, and a saved copy of every file a step overwrites or deletes.
    const def = load(input.definitionFolder);
    const steps: { step: Step; bytes: Uint8Array | null }[] = [];
    for (const c of plan.changes) {
      if (c.action === 'unchanged') continue;
      if (c.before !== null) {
        const got = readFile(join(projectDir, c.path), c.path);
        if (got === null || !sameState(got.state, c.before)) throw syncError('STALE_APPROVAL');
        saveBlob(stateDir, got.bytes);
      }
      const bytes = c.after === null ? (c.original === null ? null : blob(stateDir, c.original, c.path)) : bytesFor(def, c.path);
      if (bytes !== null && c.after !== null && sha(bytes) !== c.after.sha256) throw syncError('STALE_APPROVAL');
      steps.push({ step: { path: c.path, from: c.before, to: c.after ?? c.original }, bytes });
    }
    const previous = readPortableReceipt(stateDir);
    const pending: Pending = { format: PENDING_FORMAT, kind: 'apply', planRevision: plan.revision, steps: steps.map(s => s.step), dirs: [...plan.createDirs] };
    run(projectDir, stateDir, pending, steps, held, hooks);
    const files = receiptFilesOf(plan.changes), createdDirs = createdDirsOf(previous, plan.createDirs, files);
    // Folders an earlier run created that no projected file needs now go, when they are empty.
    removeEmptyDirs(projectDir, (previous?.createdDirs ?? []).filter(d => !createdDirs.includes(d)));
    const body = { format: PORTABLE_RECEIPT_FORMAT, projectDir, definition: plan.definition, engines: plan.engines, files, createdDirs, planRevision: plan.revision };
    const receipt: PortableReceipt = { ...body, revision: revisionOf(body) };
    writeRecord(stateDir, RECEIPT, receipt);
    finish(stateDir, new Set(files.flatMap(f => (f.original ? [f.original.sha256] : []))));
    return { noop: false, receipt };
  });
}

/** The bytes a projected path gets: `AGENTS.md`, `CLAUDE.md`, or a file of a skill folder. */
function bytesFor(def: Definition, path: string): Uint8Array {
  if (path === 'AGENTS.md') return Buffer.from(def.instructions ?? '');
  if (path === 'CLAUDE.md') return Buffer.from(FOLLOW_TEXT);
  const m = /^\.(?:claude|agents)\/skills\/([^/]+)\/(.+)$/.exec(path);
  const f = m && def.files.find(x => x.path === `skills/${m[1]}/${m[2]}`);
  if (!f) throw syncError('STALE_APPROVAL');
  return f.bytes;
}

// ---- drift against the receipt (portable spec, section 5.3) --------------------------------------------------------------

/** Each projected file that differs from its receipt: changed, its mode changed, or missing. */
export function portableDrift(input: { readonly projectDir: string; readonly stateDir: string }): { readonly path: string; readonly now: FileState | null; readonly recorded: FileState }[] {
  checkPaths(input?.projectDir, input?.stateDir);
  const receipt = readPortableReceipt(input.stateDir);
  if (receipt === null) return [];
  const out: { path: string; now: FileState | null; recorded: FileState }[] = [];
  for (const f of receipt.files) {
    let now: FileState | null;
    try { now = stateOf(join(input.projectDir, f.path), f.path); } catch { now = null; }
    if (!sameState(now, f)) out.push({ path: f.path, now, recorded: { sha256: f.sha256, mode: f.mode } });
  }
  return out;
}

// ---- removal -------------------------------------------------------------------------------------------------------------

/** Plans the removal of the projection: each projected file goes back to the file it replaced, or is deleted. */
export function planPortableRemoval(input: { readonly projectDir: string; readonly stateDir: string }): PortableRemovalPlan {
  checkPaths(input?.projectDir, input?.stateDir);
  const { projectDir, stateDir } = input;
  if (readRecord<unknown>(stateDir, PENDING) !== null) refuse('PORTABLE_RECOVERY_REQUIRED');
  const receipt = readPortableReceipt(stateDir);
  if (receipt === null) return refuse('PORTABLE_NOTHING_PROJECTED');
  const drifted = portableDrift(input).map(d => d.path);
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted);
  const changes = receipt.files.map((f): PlannedChange => ({
    path: f.path, action: f.original ? 'restore' : 'delete', before: { sha256: f.sha256, mode: f.mode }, after: null, original: f.original, engines: [],
  }));
  const body = { format: PORTABLE_REMOVAL_FORMAT, projectDir, stateDir, receipt: receipt.revision, changes, removeDirs: [...receipt.createdDirs], writesAuthorized: false as const };
  return { ...body, revision: revisionOf(body) };
}

/** Applies the approved removal under the project lock. The state folder of the projection is emptied at the end. */
export async function applyPortableRemoval(input: { readonly projectDir: string; readonly stateDir: string }, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableRemovalResult> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async held => {
    const plan = planPortableRemoval(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const { projectDir, stateDir } = plan;
    const steps: { step: Step; bytes: Uint8Array | null }[] = [];
    for (const c of plan.changes) {
      const got = readFile(join(projectDir, c.path), c.path);
      if (got === null || !sameState(got.state, c.before)) throw syncError('STALE_APPROVAL');
      saveBlob(stateDir, got.bytes);
      steps.push({ step: { path: c.path, from: c.before, to: c.original }, bytes: c.original === null ? null : blob(stateDir, c.original, c.path) });
    }
    run(projectDir, stateDir, { format: PENDING_FORMAT, kind: 'remove', planRevision: plan.revision, steps: steps.map(s => s.step), dirs: [] }, steps, held, {});
    removeEmptyDirs(projectDir, plan.removeDirs);
    fs.unlinkSync(join(stateDir, RECEIPT));
    finish(stateDir, new Set());
    return { planRevision: plan.revision, restored: plan.changes.filter(c => c.action === 'restore').map(c => c.path), deleted: plan.changes.filter(c => c.action === 'delete').map(c => c.path) };
  });
}

// ---- recovery --------------------------------------------------------------------------------------------------------------

/**
 * Plans the recovery of a run that stopped part way. When the receipt names the run's plan, the run finished and only
 * the marker goes. Otherwise every step is undone.
 */
export function planPortableRecovery(input: { readonly projectDir: string; readonly stateDir: string }): PortableRecoveryPlan {
  checkPaths(input?.projectDir, input?.stateDir);
  const { projectDir, stateDir } = input;
  const pending = readRecord<Pending>(stateDir, PENDING);
  if (pending === null) return refuse('PORTABLE_RECOVER_NOTHING');
  if (pending.format !== PENDING_FORMAT || !Array.isArray(pending.steps) || !Array.isArray(pending.dirs)) return refuse('PORTABLE_STATE_UNSAFE');
  const receipt = readPortableReceipt(stateDir);
  // An apply whose receipt names its plan finished. A removal whose receipt is gone finished too.
  const complete = pending.kind === 'apply' ? receipt?.planRevision === pending.planRevision : receipt === null;
  const steps = complete ? [] : pending.steps.map(s => ({ path: s.path, now: stateOf(join(projectDir, s.path), s.path), back: s.from }));
  for (const s of pending.steps) if (!complete) {
    const now = stateOf(join(projectDir, s.path), s.path);
    if (!sameState(now, s.from) && !sameState(now, s.to)) refuse('PORTABLE_DRIFT', [s.path]);
  }
  const body = { format: PORTABLE_RECOVERY_FORMAT, projectDir, stateDir, action: complete ? 'complete' as const : 'rollback' as const, steps };
  return { ...body, revision: revisionOf(body) };
}

/** Applies the approved recovery under the project lock. */
export async function applyPortableRecovery(input: { readonly projectDir: string; readonly stateDir: string }, revision: string, signal: AbortSignal = new AbortController().signal): Promise<PortableRecoveryPlan> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw syncError('STALE_APPROVAL');
  checkPaths(input?.projectDir, input?.stateDir);
  return withProjectLock(input.projectDir, signal, async () => {
    const plan = planPortableRecovery(input);
    if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
    const pending = readRecord<Pending>(plan.stateDir, PENDING)!;
    const receipt = readPortableReceipt(plan.stateDir);
    if (plan.action === 'rollback') rollback(plan.projectDir, plan.stateDir, pending);
    const keep = new Set((receipt?.files ?? []).flatMap(f => (f.original ? [f.original.sha256] : [])));
    finish(plan.stateDir, keep);
    return plan;
  });
}
