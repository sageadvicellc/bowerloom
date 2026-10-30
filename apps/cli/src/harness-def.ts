/**
 * `bowerloom harness status|adopt|install|accept|merge|drift|remove|recover`: the 0.8 harness commands (step 5,
 * decision D1A). The 0.7 `harness` forms all take `--synthetic` and keep their own handler (harness.ts); main.ts routes
 * on that flag.
 *
 * - The folder is the working folder, or `--dir <absolute>`. There is no project discovery: adoption runs before
 *   `.bowerloom` exists.
 * - The private record is the shared layout of packages/project-sync/src/harness-state.ts, the one the app uses
 *   (decisions D2A and D3A). Every command first settles the record of the earlier app, under the project lock.
 * - Every write goes through the approval wrapper (confirm.ts): the plan prints its revision and exits 3; the same
 *   command with `--approve <revision>` applies it, after the package plans again and finds the same revision.
 * - A fidelity refusal (PORTABLE_FIDELITY) prints each refused line with a key, `<part>/<entry>[.<field>]@<engine>:<hash12>`,
 *   and exits 1. `harness accept <key>` writes one approval draft, bound to the hash of the entry it names.
 * - The command line never runs an engine. Engine versions come from harness.json, or from `--engine <id>@<version>`
 *   when adoption writes harness.json.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { recordScenario } from './events.js';
import { applyAdoption, applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../packages/adoption/src/index.js';
import type { AdoptionInput } from '../../../packages/adoption/src/index.js';
import { EVERY_ENGINE_PARTS } from '../../../packages/adoption/src/model.js';
import type { AdoptionChoice, AdoptionPlan, EveryEnginePart } from '../../../packages/adoption/src/model.js';
import type { AdoptionRecoveryPlan } from '../../../packages/adoption/src/journal.js';
import { JOURNAL, readJournal } from '../../../packages/adoption/src/journal.js';
import {
  applyInstructionMerge, applyInstructionMergeRecovery, mergeStopped, planInstructionMerge, planInstructionMergeRecovery, refuseWhileStopped,
} from '../../../packages/adoption/src/merge.js';
import type { InstructionMergePlan, InstructionMergeRecoveryPlan } from '../../../packages/adoption/src/merge.js';
import {
  PortableRefusal, RECONCILE_ACTIONS, addApprovalDraftLocked, applyPortable, applyPortableRecovery, applyPortableRemoval, dropApprovalDraftsLocked,
  harnessStateDirs, instructionDrift, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readApprovalDrafts, readPortableReceipt,
  settleLegacyState,
} from '../../../packages/project-sync/src/index.js';
import type {
  DriftLine, HarnessStateDirs, InstructionDrift, LegacySettle, PortableInput, PortablePlan, PortableRecoveryPlan, PortableRemovalPlan,
  ReconcileAction, RecoveryInput,
} from '../../../packages/project-sync/src/index.js';
import { pendingExists } from '../../../packages/project-sync/src/portable-state.js';
import { readRecordedModes } from '../../../packages/project-sync/src/portable.js';
import { ENGINE_IDS, PREVIEW_ENGINES_ENV, entryHash, isEngineId, isPreviewEngine, loadDefinition, previewEnginesAllowed } from '../../../packages/harness-definition/src/index.js';
import type { Definition, EngineId, FidelityApproval } from '../../../packages/harness-definition/src/index.js';
import { checkProjectPath, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

export const HARNESS_DEF_USAGE = 'Use bowerloom harness status|adopt|install|accept|merge|drift|remove|recover [--dir <absolute-folder>]. See bowerloom help harness.';
const VERBS = ['status', 'adopt', 'install', 'accept', 'merge', 'drift', 'remove', 'recover'] as const;
type Verb = (typeof VERBS)[number];

/** The help topic of the 0.8 harness commands (`bowerloom help harness`). It is not in the short help (0.8 spec 6.11). */
export const HARNESS_HELP = [
  'Bowerloom harness: adopt a project into a 0.8 harness definition, and install it to engines', '', 'Usage:',
  '  bowerloom harness status [--dir <absolute-folder>] [--json]',
  '  bowerloom harness adopt [--engine <id>[@<version>]]... [--pick <conflict>=<variant>]... [--rename <conflict>:<variant>=<id>]... [--acknowledge <id>]... [--every-engine guardrails|hooks|mcp]... [--confirm <part/id>]... [--approve <revision>] [--json]',
  '  bowerloom harness install [--engine <id>]... [--reconcile accept-agents|merge|keep-both] [--write-claude-md] [--pi-trust-saved] [--approve <revision>] [--json]',
  '    opencode, pi, and deepseek-harness are preview engines: they install only with BOWERLOOM_PREVIEW_ENGINES=1 set.',
  '  bowerloom harness accept <line-key> [--json]',
  '  bowerloom harness merge [--approve <revision>] [--json]',
  '  bowerloom harness drift [--check] [--json]',
  '  bowerloom harness remove [--approve <revision>] [--json]',
  '  bowerloom harness recover [--adoption] [--keep <path>]... [--restore-mode <path>]... [--record-mode <path>]... [--approve <revision>] [--json]', '',
  'Every command takes --dir <absolute-folder>; the default is the working folder.',
  'Any harness command settles the record of an older Bowerloom app once, before it reads: the record moves to the shared place.',
  'Status and drift change nothing and never wait for another command.',
  'Adopt reads the engine files of the folder and writes only .bowerloom. It changes no engine file.',
  'An adopted item applies to the engines whose files held it. --every-engine <part> makes every guardrail, hook, or MCP server',
  'apply to every engine of the harness; an item that differs between engines keeps its engines, and the plan says why.',
  'Install writes the engine files from .bowerloom. A rule an engine carries more weakly than the harness says is refused;',
  'each refused line has a key, and harness accept <key> approves that line. Then install again.',
  'This beta supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines. Install to them is refused,',
  'and install with no --engine skips them, unless you set BOWERLOOM_PREVIEW_ENGINES=1. Adopt, drift, status, and remove work for every engine.',
  'Merge moves the text of CLAUDE.md into .bowerloom/instructions/AGENTS.md. Install then makes CLAUDE.md read AGENTS.md.',
  'Drift lists the files Bowerloom wrote that changed since. Drift --check fails when a file changed, when CLAUDE.md does not follow AGENTS.md,',
  'or when nothing is installed. Recover keeps your version, or puts a mode back, or records it.',
  'A merge or an adoption that stopped part way blocks install, remove, and accept until harness recover --adoption settles it.',
  'Remove puts back every file install replaced, and deletes the files it created.',
  'Every write prints a plan and its revision first. Run the same command with --approve <revision> to apply it.',
  'No command runs an engine. Engine versions come from harness.json.', '',
].join('\n');

const usage = (message = HARNESS_DEF_USAGE): never => { throw new DefinitionError('USAGE', message); };

// ---- flags -------------------------------------------------------------------------------------------------------------

interface FlagSpec { readonly many?: readonly string[]; readonly one?: readonly string[]; readonly bool?: readonly string[]; readonly positional?: number }
interface Flags { readonly values: ReadonlyMap<string, readonly string[]>; readonly bools: ReadonlySet<string>; readonly positional: readonly string[] }

/** Flags of one verb. `--dir` is allowed everywhere. Every value is the next word, never `--flag=value`. */
function parseFlags(words: readonly string[], spec: FlagSpec): Flags {
  const many = new Set(spec.many ?? []), one = new Set([...(spec.one ?? []), '--dir']), bool = new Set(spec.bool ?? []);
  const values = new Map<string, string[]>(), bools = new Set<string>(), positional: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (bool.has(word)) { if (bools.has(word)) usage(`Use ${word} once.`); bools.add(word); continue; }
    if (many.has(word) || one.has(word)) {
      const value = words[++i];
      if (value === undefined || value.startsWith('--') || value === '' || value.includes('\0')) usage(`${word} takes a value.`);
      const list = values.get(word) ?? [];
      if (one.has(word) && list.length) usage(`Use ${word} once.`);
      list.push(value!); values.set(word, list); continue;
    }
    if (word.startsWith('-')) usage(`${word} is not a flag of this command. ${HARNESS_DEF_USAGE}`);
    positional.push(word);
  }
  if (positional.length !== (spec.positional ?? 0)) usage();
  return { values, bools, positional };
}
const all = (f: Flags, name: string): readonly string[] => f.values.get(name) ?? [];
const single = (f: Flags, name: string): string | undefined => f.values.get(name)?.[0];

// ---- the folder and its record -----------------------------------------------------------------------------------------

/** The real path of the folder: `--dir`, or the working folder. It must be an absolute path of a folder. */
function folderOf(cwd: string, home: string, dir: string | undefined): string {
  const given = dir ?? cwd;
  if (!isAbsolute(given)) usage('--dir takes an absolute path of a folder.');
  let real: string;
  try { real = realpathSync(given); if (!lstatSync(real).isDirectory()) throw new Error('not a folder'); } catch { return usage('--dir takes an absolute path of an existing folder.'); }
  checkProjectPath(real, home);
  return real;
}

/** One section of the private record that could not be read, for `status`: the section, the code of the refusal, and the relative file name. */
export interface StatusProblem { readonly section: string; readonly code: string; readonly file: string | null }
interface Ctx {
  readonly dir: string; readonly dirs: HarnessStateDirs; readonly legacy: LegacySettle; readonly signal: AbortSignal; readonly env: NodeJS.ProcessEnv;
  /** Set only for `status`: the marker of the move of the record of the earlier app is damaged. Other verbs throw instead. */
  readonly moveProblem: StatusProblem | null;
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Za-z0-9_]{2,63}$/.test(code) ? code : 'FAILED';
};
/** The problem of one section: the code, and the first relative name the error carries, else the section's own file. */
function problemOf(section: string, error: unknown, file: string | null): StatusProblem {
  const paths = (error as { paths?: unknown } | null)?.paths;
  const named = Array.isArray(paths) ? paths.find((p): p is string => typeof p === 'string' && p !== '' && !isAbsolute(p)) : undefined;
  return { section, code: codeOf(error), file: named ?? file };
}

async function contextOf(cwd: string, home: string, env: NodeJS.ProcessEnv, flags: Flags, signal: AbortSignal, lenient: boolean): Promise<Ctx> {
  const dir = folderOf(cwd, home, single(flags, '--dir'));
  const dirs = harnessStateDirs(privateStateRoot(env, home), dir);
  // Decision D3A: the record of the earlier app moves once, under the project lock, before any stage reads a record. With nothing to
  // move it takes no lock. `status` reports a move that fails as a problem of its section, and goes on.
  let legacy: LegacySettle = 'none', moveProblem: StatusProblem | null = null;
  try { legacy = await settleLegacyState(dirs, dir, signal); } catch (error) {
    // Only a damaged marker is a problem to report. Two records, or a record that is not safe, stay a refusal: Bowerloom does not guess which is real.
    if (!lenient || codeOf(error) !== 'PORTABLE_STATE_INVALID') throw error;
    moveProblem = problemOf('move', error, 'moving.json');
  }
  return { dir, dirs, legacy, signal, env, moveProblem };
}

const portableIo = (c: Ctx): { projectDir: string; stateDir: string } => ({ projectDir: c.dir, stateDir: c.dirs.portable });
const definitionFolder = (c: Ctx): string => join(c.dir, '.bowerloom');
const hasDefinition = (c: Ctx): boolean => { try { return lstatSync(join(definitionFolder(c), 'harness.json')).isFile(); } catch { return false; } };
const loaded = (c: Ctx): Definition | null => { const r = loadDefinition(definitionFolder(c)); return r.ok ? r.definition : null; };
const mergeUnfinished = (c: Ctx): boolean => mergeStopped(c.dirs.adoption);
/** A value as plain JSON: optional fields that hold `undefined` are dropped, as canonical JSON refuses them. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---- fidelity lines ----------------------------------------------------------------------------------------------------

type RawLine = { part: string; entry: string; field?: string; engine: string; result: 'weakened' | 'absent'; reason: string };
export interface RefusedLine extends RawLine { readonly key: string; readonly approvable: boolean }

/** The definition's entry for a line, as the fidelity check finds it. */
function entryOf(def: Definition, part: string, id: string): object | undefined {
  const e = def.entries;
  const list: readonly { id: string }[] = part === 'skills' ? e.skills : part === 'subagents' ? e.subagents
    : part === 'guardrails' ? [...e.rules, ...e.sandbox] : part === 'hooks' ? e.hooks : part === 'mcp' ? e.mcp : [];
  return list.find(x => x.id === id);
}
/** The first 12 hex of an entry's hash, without the `sha256:` prefix. */
const hash12 = (entry: object): string => entryHash(entry).replace(/^sha256:/, '').slice(0, 12);
const lineName = (l: { part: string; entry: string; field?: string | undefined; engine: string }): string => `${l.part}/${l.entry}${l.field !== undefined ? `.${l.field}` : ''}@${l.engine}`;
/** The key of a refused line: its name and the first 12 hex of its entry's hash. A line with no entry has no hash, and cannot be approved. */
function refusedLines(def: Definition | null, refused: readonly RawLine[]): RefusedLine[] {
  return refused.map(r => {
    const entry = def === null ? undefined : entryOf(def, r.part, r.entry);
    const line: RawLine = { part: r.part, entry: r.entry, ...(r.field !== undefined ? { field: r.field } : {}), engine: r.engine, result: r.result, reason: r.reason };
    return { ...line, key: entry === undefined ? lineName(line) : `${lineName(line)}:${hash12(entry)}`, approvable: entry !== undefined };
  });
}
const fidelityOf = (error: unknown): RawLine[] | null => {
  const e = error as { code?: unknown; refused?: unknown } | null;
  return e !== null && typeof e === 'object' && e.code === 'PORTABLE_FIDELITY' && Array.isArray(e.refused) ? e.refused as RawLine[] : null;
};

/** The approvals an install plan carries: the receipt's earlier ones whose entry is unchanged, then the drafts. */
function approvalsNow(c: Ctx): FidelityApproval[] {
  const def = loaded(c);
  if (def === null) return [];
  const current = (a: FidelityApproval): boolean => { const entry = entryOf(def, a.part, a.entry); return entry !== undefined && entryHash(entry) === a.entryHash; };
  const drafts = readApprovalDrafts(c.dirs, c.dir, { definition: def });
  const recorded = (readPortableReceipt(portableIo(c))?.approvals ?? []).filter(current);
  const names = new Set(drafts.map(d => lineName(d)));
  return [...recorded.filter(a => !names.has(lineName(a))), ...drafts];
}

// ---- words -------------------------------------------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** Text from a file of the project, as one printed line: control characters written out, cut at `max` characters. */
function shown(text: string, max = 300): string {
  const flat = plainText(text.replace(/\s+/g, ' ').trim());
  return flat.length <= max ? flat : `${flat.slice(0, max)}... (${flat.length - max} more characters; harness install --json shows all)`;
}
function renderRefused(lines: readonly RefusedLine[]): string {
  const out = [`Install refused: ${count(lines.length, 'rule')} would be carried more weakly than the harness says.`];
  for (const l of lines) out.push(`  ${l.key}  ${l.result}${l.approvable ? '' : ' (this line cannot be approved: its entry is not in the harness)'}`, `    ${l.reason}`);
  out.push('Read each line. To approve one, run bowerloom harness accept <key>. Then run harness install again.');
  return `${plainText(out.join('\n'), true)}\n`;
}

function renderAdoption(p: AdoptionPlan): string {
  const out = [`Adopt into .bowerloom: ${count(p.files.length, 'file')}. Adoption changes no engine file.`];
  for (const f of p.files) out.push(`  write .bowerloom/${f.path}`);
  for (const c of p.conflicts) out.push(`Conflict ${c.key}: ${c.choice === null ? 'pick one with --pick' : 'chosen'} ${c.key}=<variant>. Variants: ${c.variants.map(v => v.key).join(', ')}.`);
  for (const u of p.unmapped) out.push(`Not adopted: ${u.id}: ${u.reason}${u.gate === 'acknowledge' && !u.acknowledged ? ` Add --acknowledge ${u.id}.` : u.gate === 'block' ? ' Change the source first.' : ''}`);
  for (const s of p.secrets) out.push(`Secret value replaced by a reference: ${s.path} ${s.pointer} -> ${s.reference}`);
  // Decision D8B: what "Use for every engine" widens for each part, chosen or not.
  for (const e of p.everyEngine) {
    if (!e.chosen && e.widens === 0 && e.notWidened.length === 0) continue;
    const one = e.widens === 1;
    out.push(e.chosen ? `Every engine, ${e.part}: ${count(e.widens, 'item')} now ${one ? 'applies' : 'apply'} to every engine.`
      : `Every engine, ${e.part}: ${count(e.widens, 'item')} ${one ? 'applies' : 'apply'} to some engines only. Add --every-engine ${e.part} to use ${one ? 'it' : 'them'} for every engine.`);
    for (const n of e.notWidened) out.push(`  ${e.part}/${n.id}: ${n.reason}`);
  }
  if (p.approvalsRequired.length) {
    out.push('Confirm each of these when you apply, and read why first:');
    for (const k of p.approvalsRequired) {
      const reasons = p.items.find(i => `${i.part}/${i.id}` === k)?.needsApproval ?? [];
      out.push(`  --confirm ${k}${reasons.length ? `  ${reasons.map(r => shown(r)).join(' ')}` : ''}`);
    }
  }
  for (const w of p.warnings) out.push(`Note: ${w}`);
  for (const pr of p.problems) out.push(`Problem: ${pr.path} (${pr.code}) ${pr.message}`);
  out.push(p.ready ? 'The plan is ready to apply.' : 'The plan is not ready: answer each conflict and acknowledgement above, then plan again.');
  return out.join('\n');
}

function renderInstall(p: PortablePlan): string {
  const changing = p.changes.filter(c => c.action !== 'unchanged');
  const out = [`Install to ${p.engines.map(e => (e.version ? `${e.id} ${e.version}` : e.id)).join(', ')}: ${count(changing.length, 'file')} to change.`];
  if (p.previewNotice !== null) out.push(p.previewNotice);
  for (const c of changing) out.push(`  ${c.action.padEnd(7)} ${c.path}`);
  for (const l of p.loss.filter(x => x.result !== 'exact')) out.push(`  ${l.result.padEnd(10)} ${lineName(l)}`);
  for (const a of p.approved) out.push(`  approved  ${lineName(a)} by ${a.who} at ${a.when}`);
  for (const t of p.trust.filter(x => x.state === 'pending trust')) out.push(`Pending trust (${t.engine}): ${t.path}. ${t.reason}`);
  for (const r of p.review) {
    out.push(`Read before it is written: ${r.path} (${r.engine}, ${r.kind}${r.part !== undefined && r.entry !== undefined ? `, ${r.part}/${r.entry}` : ''}).`, `  runs: ${shown(r.text)}`);
    // A value the engine reads at run time is a reference, and shows no value here. A literal value can run code too (NODE_OPTIONS).
    for (const [name, value] of Object.entries(r.env ?? {})) if (value !== null) out.push(`  env: ${shown(name, 100)}=${shown(value, 200)}`);
  }
  for (const o of p.offers) out.push(`Offer: ${o.reason} Add --write-claude-md to accept.`);
  for (const i of p.ignored) out.push(`Ignored ${i.option}: ${i.reason}`);
  if (p.notice) out.push(p.notice);
  return out.join('\n');
}

const renderMerge = (p: InstructionMergePlan): string => [
  `Merge CLAUDE.md into the harness under the heading "${p.heading}". CLAUDE.md is not changed.`,
  ...p.files.map(f => `  ${f.action.padEnd(7)} ${f.path}`),
  ...(p.addsPart ? ['harness.json gets the system-prompt part.'] : []),
  'Then run harness install: it makes CLAUDE.md read AGENTS.md, and removal puts CLAUDE.md back.',
].join('\n');

/** A restore whose original is the state the path holds now writes nothing: the file was taken over, and removal keeps it. */
const keeps = (c: PortableRemovalPlan['changes'][number]): boolean =>
  c.action === 'restore' && c.original != null && c.before != null && c.original.sha256 === c.before.sha256 && c.original.mode === c.before.mode;
const renderRemoval = (p: PortableRemovalPlan): string => [
  `Remove the installed files: ${count(p.changes.length, 'path')}.`,
  ...p.changes.map(c => `  ${(keeps(c) ? 'keep' : c.action).padEnd(7)} ${c.path}`),
  ...p.removeDirs.map(d => `  remove folder ${d} when empty`),
].join('\n');

const renderRecovery = (p: PortableRecoveryPlan): string => [
  `Recover (${p.action}).`,
  ...p.steps.map(s => `  ${s.decision.padEnd(4)} ${s.path}`),
  ...p.keep.map(k => `  keep your version of ${k}`),
  ...p.modes.map(m => `  ${m.choice === 'restoreMode' ? 'put back mode' : 'record mode'} ${(m.choice === 'restoreMode' ? m.recorded.mode : m.now.mode).toString(8).padStart(4, '0')} on ${m.path}`),
  ...(p.notice ? [p.notice] : []),
].join('\n');

const renderAdoptionRecovery = (p: AdoptionRecoveryPlan | InstructionMergeRecoveryPlan): string => {
  if ('restore' in p) return [`Recover the merge that stopped part way (journal ${p.journal}).`, ...p.restore.map(r => `  ${r.action.padEnd(7)} ${r.path}`), ...p.kept.map(k => `  leave ${k.path} (${k.reason})`), ...p.check.map(c => `  check by hand: ${c}`)].join('\n');
  return [`Recover the adoption that stopped part way (journal ${p.journal}).`, ...p.remove.map(r => `  remove  .bowerloom/${r}`), ...p.check.map(c => `  check by hand: ${c}`)].join('\n');
};

function renderDrift(lines: readonly DriftLine[], instructions: InstructionDrift | null, projected: boolean): string {
  const out = !projected ? ['Nothing is installed, so no file can have drifted.']
    : lines.length ? [`Drift: ${count(lines.length, 'file')} Bowerloom wrote changed since the install.`] : ['No drift: every file Bowerloom wrote is as it wrote it.'];
  for (const d of lines) out.push(`  ${d.reason.padEnd(7)}  ${d.path}${d.reason === 'mode' && d.now ? ` (${d.recorded.mode.toString(8)} -> ${d.now.mode.toString(8)})` : ''}`);
  if (lines.length) out.push('Next: bowerloom harness recover --keep <path> for a changed file, --restore-mode <path> or --record-mode <path> for a mode.');
  if (instructions !== null) out.push('CLAUDE.md does not follow AGENTS.md. Install with --reconcile accept-agents or keep-both, or run harness merge first.');
  return `${plainText(out.join('\n'), true)}\n`;
}

// ---- the verbs ---------------------------------------------------------------------------------------------------------

const PROBLEM_HINT: Readonly<Record<string, string>> = {
  PORTABLE_STATE_INVALID: 'Move it aside in the private state folder, then run the command again.',
  PORTABLE_STATE_FOREIGN: 'It is the record of another folder. Move it aside in the private state folder.',
  HARNESS_STATE_TWO_RECORDS: 'Two records exist for this folder. Move the one you do not want aside in the private state folder.',
};
/** Runs one section of `status`. A refusal becomes the section's problem, and the section reports its empty value. */
function section<T>(problems: StatusProblem[], name: string, file: string | null, empty: T, read: () => T): T {
  try { return read(); } catch (error) { problems.push(problemOf(name, error, file)); return empty; }
}

async function status(c: Ctx, json: boolean, write: (text: string) => void): Promise<number> {
  const present = hasDefinition(c);
  let engines: { id: string; version: string | null }[] = [], problem: string | null = null, harness: string | null = null;
  if (present) {
    const r = loadDefinition(definitionFolder(c));
    if (r.ok) { harness = r.definition.harness.id; engines = r.definition.harness.engines.map(e => ({ id: e.id, version: e.version ?? null })); }
    else problem = r.problems[0]?.message ?? 'The harness definition does not load.';
  }
  // Each section of the private record is read on its own: a damaged one is reported, and the others are still shown.
  const problems: StatusProblem[] = c.moveProblem === null ? [] : [c.moveProblem];
  const receipt = section<ReturnType<typeof readPortableReceipt> | undefined>(problems, 'receipt', 'receipt.json', undefined, () => readPortableReceipt(portableIo(c)));
  section(problems, 'modes', 'modes.json', undefined, () => { readRecordedModes(c.dirs.portable, c.dir); });
  const drafts = section(problems, 'drafts', 'approvals.json', 0, () => readApprovalDrafts(c.dirs, c.dir).length);
  const unfinished = {
    projection: section(problems, 'projection', 'pending.json', false, () => pendingExists(c.dirs.portable)),
    adoption: section(problems, 'adoption', JOURNAL, false, () => readJournal(c.dirs.adoption, c.dir) !== null),
    merge: mergeUnfinished(c),
  };
  // Beta.1: which preview engines this environment installs to, which listed engines it will not, and which the receipt still holds.
  const previewOn = previewEnginesAllowed(c.env);
  const held = receipt == null ? [] : ENGINE_IDS.filter(id => isPreviewEngine(id) && receipt.engines.some(e => e.id === id));
  const previewEngines = {
    on: previewOn,
    // An engine the receipt holds is named once, under `held`.
    notInstalled: previewOn ? [] : ENGINE_IDS.filter(id => isPreviewEngine(id) && engines.some(e => e.id === id) && !held.includes(id)),
    held,
  };
  const body = {
    format: 'bowerloom/harness-status/v1beta1', folder: c.dir, legacy: c.legacy,
    definition: { present, harness, engines, problem }, projected: receipt === undefined ? null : receipt !== null,
    receipt: receipt == null ? null : { revision: receipt.revision, engines: receipt.engines, files: receipt.files.length, approvals: receipt.approvals.length },
    previewEngines,
    unfinished, drafts, problems,
  };
  if (json) { write(newCommandJson(plain(body))); return 0; }
  const out = [present ? `Harness ${harness ?? '(does not load)'} for ${engines.map(e => (e.version ? `${e.id} ${e.version}` : e.id)).join(', ') || 'no engine'}.` : 'No harness definition in this folder. Next: bowerloom harness adopt.'];
  if (problem !== null) out.push(`The definition does not load: ${problem}`);
  if (receipt !== undefined) out.push(receipt === null ? 'Nothing is installed.' : `Installed: ${count(receipt.files.length, 'file')} for ${receipt.engines.map(e => e.id).join(', ')}, ${count(receipt.approvals.length, 'approved line')}.`);
  out.push(previewOn ? 'Preview engines are on.' : `Preview engines are off (set ${PREVIEW_ENGINES_ENV}=1 to turn them on).${previewEngines.notInstalled.length ? ` Not installed to: ${previewEngines.notInstalled.join(', ')}.` : ''}`);
  if (previewEngines.held.length) out.push(`Installed earlier and ${previewOn ? 'still held' : 'left as they are'}: ${previewEngines.held.join(', ')}.`);
  if (drafts) out.push(`${count(drafts, 'accepted line')} waiting for the next install.`);
  for (const p of problems) out.push(`Problem: ${p.file ?? p.section} (${p.code}). ${PROBLEM_HINT[p.code] ?? 'Check it in the private state folder.'}`);
  if (unfinished.projection) out.push('An install or removal stopped part way. Next: bowerloom harness recover.');
  if (unfinished.adoption || unfinished.merge) out.push(`${unfinished.merge ? 'A merge' : 'An adoption'} stopped part way. Next: bowerloom harness recover --adoption.`);
  if (c.legacy !== 'none') out.push('The record of the earlier app moved to the shared record.');
  write(`${plainText(out.join('\n'), true)}\n`); return 0;
}

function adoptionInput(c: Ctx, f: Flags): AdoptionInput {
  const engines = all(f, '--engine').map(word => {
    const at = word.indexOf('@'), id = at < 0 ? word : word.slice(0, at), version = at < 0 ? undefined : word.slice(at + 1);
    if (!isEngineId(id) || version === '') usage(`--engine takes one of ${ENGINE_IDS.join(', ')}, with an optional @<version>.`);
    return { id: id as EngineId, ...(version !== undefined ? { version } : {}) };
  });
  if (new Set(engines.map(e => e.id)).size !== engines.length) usage('Name each engine once.');
  const choices: Record<string, AdoptionChoice> = {};
  for (const word of all(f, '--pick')) {
    const eq = word.indexOf('=');
    if (eq <= 0 || eq === word.length - 1) usage('--pick takes <conflict>=<variant>.');
    const key = word.slice(0, eq);
    if (Object.hasOwn(choices, key)) usage(`Answer the conflict ${key} once.`);
    choices[key] = { pick: word.slice(eq + 1) };
  }
  const renames: Record<string, Record<string, string>> = {};
  for (const word of all(f, '--rename')) {
    const colon = word.indexOf(':'), eq = word.indexOf('=', colon + 1);
    if (colon <= 0 || eq <= colon + 1 || eq === word.length - 1) usage('--rename takes <conflict>:<variant>=<id>.');
    const key = word.slice(0, colon), variant = word.slice(colon + 1, eq);
    if (Object.hasOwn(choices, key)) usage(`Answer the conflict ${key} once.`);
    const r = renames[key] ?? {};
    if (Object.hasOwn(r, variant)) usage(`Rename the variant ${variant} once.`);
    r[variant] = word.slice(eq + 1); renames[key] = r;
  }
  for (const [key, rename] of Object.entries(renames)) choices[key] = { rename };
  const acknowledged = [...new Set(all(f, '--acknowledge'))];
  const everyEngine = all(f, '--every-engine');
  if (everyEngine.some(p => !(EVERY_ENGINE_PARTS as readonly string[]).includes(p))) usage(`--every-engine takes one of ${EVERY_ENGINE_PARTS.join(', ')}.`);
  if (new Set(everyEngine).size !== everyEngine.length) usage('Name each part once.');
  return {
    projectDir: c.dir, stateDir: c.dirs.adoption,
    ...(engines.length ? { engines } : {}), ...(Object.keys(choices).length ? { choices } : {}), ...(acknowledged.length ? { acknowledged } : {}),
    ...(everyEngine.length ? { everyEngine: everyEngine as EveryEnginePart[] } : {}),
  };
}

async function adopt(c: Ctx, f: Flags, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const input = adoptionInput(c, f), confirms = [...new Set(all(f, '--confirm'))];
  const change: PlannedChange<AdoptionPlan> = {
    async plan() { return planAdoption(input); }, revision: p => p.revision, review: renderAdoption,
    async apply(revision) { const r = await applyAdoption(input, revision, confirms, c.signal); return { written: r.written.map(p => `.bowerloom/${p}`) }; },
  };
  return approved(change, approval, io, write);
}

function installInput(c: Ctx, f: Flags, approvals: readonly FidelityApproval[]): PortableInput {
  const ids = all(f, '--engine');
  if (ids.some(id => !isEngineId(id))) usage(`--engine takes one of ${ENGINE_IDS.join(', ')}. The version comes from harness.json.`);
  if (new Set(ids).size !== ids.length) usage('Name each engine once.');
  const reconcile = single(f, '--reconcile');
  if (reconcile !== undefined && !(RECONCILE_ACTIONS as readonly string[]).includes(reconcile)) usage(`--reconcile takes ${RECONCILE_ACTIONS.join(', ')}.`);
  return {
    projectDir: c.dir, definitionFolder: definitionFolder(c), stateDir: c.dirs.portable, approvals,
    // Beta.1: OpenCode, Pi, and DeepSeek Harness install only with BOWERLOOM_PREVIEW_ENGINES=1. The check is in planPortable, which the app plans through too.
    previewEngines: previewEnginesAllowed(c.env),
    ...(ids.length ? { engines: ids.map(id => ({ id: id as EngineId })) } : {}),
    ...(reconcile !== undefined ? { reconcile: reconcile as ReconcileAction } : {}),
    ...(f.bools.has('--write-claude-md') ? { writeClaudeMd: true } : {}),
    ...(f.bools.has('--pi-trust-saved') ? { piTrustSaved: true } : {}),
  };
}

/** Prints the refused lines of a fidelity refusal (stdout), then throws the refusal (stderr, exit 1). */
function refuseFidelity(c: Ctx, error: unknown, json: boolean, write: (text: string) => void): never {
  const lines = refusedLines(loaded(c), fidelityOf(error)!);
  write(json ? newCommandJson(plain({ code: 'PORTABLE_FIDELITY', refused: lines, next: 'bowerloom harness accept <key>' })) : renderRefused(lines));
  if (error !== null && typeof error === 'object') Object.assign(error, { refusedLines: lines });
  throw error;
}

/** The warning for approval drafts that could not be cleared after a write that worked. The write stays done. */
async function clearDrafts(c: Ctx, recorded?: readonly FidelityApproval[]): Promise<string[]> {
  try { await dropApprovalDraftsLocked(c.dirs, c.dir, recorded, c.signal); return []; } catch (error) { return [`approval drafts not cleared (${codeOf(error)}); run bowerloom harness status`]; }
}
/** A plan as it is printed: without the private state folder, which the revision still covers. */
const printable = <P>(plan: P): P => {
  if (plan === null || typeof plan !== 'object' || !Object.hasOwn(plan, 'stateDir')) return plan;
  const { stateDir: _stateDir, ...rest } = plan as P & { stateDir?: unknown };
  return rest as P;
};

async function install(c: Ctx, f: Flags, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  installInput(c, f, []);
  refuseWhileStopped(c.dirs.adoption);
  let first: PortablePlan;
  try { first = planPortable(installInput(c, f, approvalsNow(c))); } catch (error) { if (fidelityOf(error) !== null) return refuseFidelity(c, error, approval.json, write); throw error; }
  // Spec L check 10: a plan that would write nothing is a no-op, with no approval asked.
  if (first.noop) { write(approval.json ? newCommandJson(plain({ nothingToDo: true, noop: true, plan: printable(first), revision: first.revision })) : `${plainText(renderInstall(first), true)}\nNothing to change.\n`); return 0; }
  let pending: PortablePlan | null = first;
  const change: PlannedChange<PortablePlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planPortable(installInput(c, f, approvalsNow(c))); },
    revision: p => p.revision, review: renderInstall,
    async apply(revision) {
      const input = installInput(c, f, approvalsNow(c));
      const r = await applyPortable(input, revision, c.signal);
      // The receipt records the approvals now, so their drafts go. The install is done whether or not they do.
      const warnings = r.receipt !== null ? await clearDrafts(c, r.receipt.approvals) : [];
      return { noop: r.noop, receipt: r.receipt?.revision ?? null, installed: r.installed, skippedPreview: r.skippedPreview, keptPreview: r.keptPreview, previewNotice: r.previewNotice, takenOver: r.report.takenOver, leftBehind: r.leftBehind, ...(warnings.length ? { warnings } : {}) };
    },
  };
  return approved(change, approval, io, write);
}

/** `harness accept <key>`: one approval draft for one refused line, bound to the hash of its entry now. */
async function accept(c: Ctx, f: Flags, json: boolean, write: (text: string) => void): Promise<number> {
  const key = f.positional[0]!;
  const match = /^(.+)@([a-z-]+):([a-f0-9]{12})$/.exec(key);
  if (match === null || !isEngineId(match[2])) usage('accept takes the key of a refused line, as harness install prints it: <part>/<entry>[.<field>]@<engine>:<hash12>.');
  refuseWhileStopped(c.dirs.adoption);
  const def = loaded(c);
  // The lines of the engine the key names, with no approval, so a line approved before is found too. Another engine's refusal, such as a
  // version Bowerloom does not write for, must not hide the line.
  let lines: RefusedLine[] = [];
  try { planPortable({ projectDir: c.dir, definitionFolder: definitionFolder(c), stateDir: c.dirs.portable, approvals: [], engines: [{ id: match![2] as EngineId }], previewEngines: previewEnginesAllowed(c.env) }); } catch (error) {
    const raw = fidelityOf(error);
    if (raw === null) throw error;
    lines = refusedLines(def, raw);
  }
  const line = lines.find(l => l.key === key);
  if (line === undefined) {
    // A refused line of the same name with another hash: the entry changed since the key was printed.
    if (lines.some(l => lineName(l) === `${match![1]}@${match![2]}`)) throw new DefinitionError('HARNESS_APPROVAL_STALE', 'The entry this key names changed since the line was shown. Run harness install to see the new line. Nothing was written.');
    usage('No refused line has that key. Run harness install to see the lines.');
  }
  if (!line!.approvable || def === null) usage('That line names no entry of the harness, so it cannot be approved. Change the harness instead.');
  const hash = entryHash(entryOf(def!, line!.part, line!.entry)!);
  // A line the receipt already records, for this entry as it is now, needs no draft: a new draft would change the next install.
  const recorded = (readPortableReceipt(portableIo(c))?.approvals ?? []).find(a => lineName(a) === lineName(line!) && a.result === line!.result && a.entryHash === hash);
  if (recorded !== undefined) { write(json ? newCommandJson(plain({ accepted: true, key, recorded: true, draft: recorded })) : `${plainText(key)} is already approved in the installed record.\n`); return 0; }
  const who = (() => { try { return userInfo().username || 'local user'; } catch { return 'local user'; } })();
  const draft = await addApprovalDraftLocked(c.dirs, c.dir, {
    part: line!.part as FidelityApproval['part'], entry: line!.entry, ...(line!.field !== undefined ? { field: line!.field } : {}), engine: line!.engine as EngineId,
    result: line!.result, entryHash: hash, who: who.slice(0, 256),
    reason: `Accepted with bowerloom harness accept after reading this line: ${line!.reason}`.slice(0, 4096),
  }, { definition: def! }, c.signal);
  write(json ? newCommandJson(plain({ accepted: true, key, draft })) : `Accepted ${plainText(key)}. Run bowerloom harness install to see the plan.\n`);
  return 0;
}

async function merge(c: Ctx, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const input = { projectDir: c.dir, stateDir: c.dirs.adoption };
  const change: PlannedChange<InstructionMergePlan> = {
    async plan() { return planInstructionMerge(input); }, revision: p => p.revision, review: renderMerge,
    async apply(revision) { const r = await applyInstructionMerge(input, revision, c.signal); return { written: r.written, revision: r.revision }; },
  };
  return approved(change, approval, io, write);
}

async function drift(c: Ctx, check: boolean, json: boolean, write: (text: string) => void): Promise<number> {
  // A half-finished install or removal leaves files that do not match the receipt, so drift would report noise.
  if (pendingExists(c.dirs.portable)) throw new PortableRefusal('PORTABLE_RECOVERY_REQUIRED');
  const receipt = readPortableReceipt(portableIo(c));
  const lines = portableDrift(portableIo(c));
  const def = loaded(c);
  const engines = def === null ? [] : def.harness.engines.map(e => e.id);
  const instructions = def === null || def.instructions === undefined ? null : instructionDrift(c.dir, engines, true);
  const projected = receipt !== null;
  write(json ? newCommandJson(plain({ format: 'bowerloom/harness-drift/v1beta1', projected, drift: lines, instructions })) : renderDrift(lines, instructions, projected));
  if (check && !projected) throw new DefinitionError('PORTABLE_NOTHING_PROJECTED', 'Nothing is installed, so there is nothing to check.');
  if (check && lines.length) throw new DefinitionError('PORTABLE_DRIFT', `${count(lines.length, 'file')} Bowerloom wrote changed since the install.`);
  if (check && instructions !== null) throw new DefinitionError('PORTABLE_DRIFT', 'CLAUDE.md does not follow AGENTS.md.');
  return 0;
}

async function remove(c: Ctx, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  refuseWhileStopped(c.dirs.adoption);
  const change: PlannedChange<PortableRemovalPlan> = {
    async plan() { return planPortableRemoval(portableIo(c)); }, revision: p => p.revision, review: renderRemoval,
    async apply(revision) {
      const r = await applyPortableRemoval(portableIo(c), revision, c.signal);
      // Nothing is installed now, so no draft stands for anything. The removal is done whether or not they go.
      const warnings = await clearDrafts(c);
      return { restored: r.restored, kept: r.kept, deleted: r.deleted, leftBehind: r.leftBehind, ...(warnings.length ? { warnings } : {}) };
    },
  };
  return approved(change, approval, io, write);
}

async function recover(c: Ctx, f: Flags, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  if (f.bools.has('--adoption')) {
    const input = { projectDir: c.dir, stateDir: c.dirs.adoption };
    // Decision D4A: a merge that stopped part way has its own journal in the adoption state folder.
    if (mergeUnfinished(c)) {
      const change: PlannedChange<InstructionMergeRecoveryPlan> = {
        async plan() { return planInstructionMergeRecovery(input); }, revision: p => p.revision, review: renderAdoptionRecovery,
        async apply(revision) { return applyInstructionMergeRecovery(input, revision, c.signal); },
      };
      return approved(change, approval, io, write);
    }
    const change: PlannedChange<AdoptionRecoveryPlan> = {
      async plan() { return planAdoptionRecovery(input); }, revision: p => p.revision, review: renderAdoptionRecovery,
      async apply(revision) { return applyAdoptionRecovery(input, revision, c.signal); },
    };
    return approved(change, approval, io, write);
  }
  const keep = all(f, '--keep'), restoreMode = all(f, '--restore-mode'), recordMode = all(f, '--record-mode');
  const input: RecoveryInput = {
    ...portableIo(c), ...(keep.length ? { keep } : {}), ...(restoreMode.length ? { restoreMode } : {}), ...(recordMode.length ? { recordMode } : {}),
  };
  const change: PlannedChange<PortableRecoveryPlan> = {
    async plan() { return planPortableRecovery(input); }, revision: p => p.revision, review: renderRecovery,
    async apply(revision) { const r = await applyPortableRecovery(input, revision, c.signal); return { action: r.action, leftBehind: r.leftBehind }; },
  };
  return approved(change, approval, io, write);
}

/** The command that finishes a run that stopped part way, by the code of its refusal. */
const FINISH: Readonly<Record<string, string>> = { ADOPTION_PARTIAL: 'bowerloom harness recover --adoption', PORTABLE_PARTIAL: 'bowerloom harness recover' };
/**
 * A partial refusal (ADOPTION_PARTIAL, PORTABLE_PARTIAL) gets the partial hint and the command that finishes the run as
 * its `next` and `fix`, as the partial refusals of project-sync do (refusal.ts, `partialRefusal`). Any other error is
 * returned as it is.
 */
export function withPartialWords(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (error === null || typeof error !== 'object' || typeof code !== 'string' || !Object.hasOwn(FINISH, code)) return error;
  try {
    Object.defineProperty(error, 'hint', { value: 'partial', enumerable: false, configurable: true });
    Object.defineProperty(error, 'next', { value: `Run ${FINISH[code]!}.`, enumerable: false, configurable: true });
    Object.defineProperty(error, 'fix', { value: FINISH[code]!, enumerable: false, configurable: true });
  } catch { /* A sealed error keeps its own words. */ }
  return error;
}

/** One entry of a result list as a phrase: a path, or a path with its reason. */
const phrase = (entry: unknown): string | null => {
  if (typeof entry === 'string') return entry;
  const e = entry as { path?: unknown; reason?: unknown } | null;
  return e !== null && typeof e === 'object' && typeof e.path === 'string' ? `${e.path}${typeof e.reason === 'string' ? ` (${e.reason})` : ''}` : null;
};
/**
 * The lines a person reads after a write, beyond "Applied plan": one for each folder left in place (`leftBehind`), file kept as it is
 * (`kept`), and folder left (`leftFolders`), and each warning. A result without them gives none.
 */
export function resultLines(result: unknown): string[] {
  if (result === null || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>, out: string[] = [];
  const each = (key: string, label: string): void => {
    const list = r[key];
    if (Array.isArray(list)) for (const entry of list) { const p = phrase(entry); if (p !== null) out.push(`${label}: ${p}`); }
  };
  // An install says where it went, and what it left out (beta.1 preview engines).
  if (Array.isArray(r.installed) && r.installed.length && r.installed.every(x => typeof x === 'string')) out.push(`Installed to: ${(r.installed as string[]).join(', ')}.`);
  if (typeof r.previewNotice === 'string') out.push(r.previewNotice);
  each('leftBehind', 'Left in place'); each('kept', 'Kept as it is'); each('leftFolders', 'Left folder'); each('warnings', 'Note');
  return out;
}

/** The last write this command applied, for the local usage log. Set by `approved`, cleared at the start of each run. A plan that waited, or a no-op, leaves it empty. */
let lastApply: { revision: string; result: unknown } | null = null;

/** The approval wrapper, with plain JSON in and out. A good write also prints what it left behind or kept (human mode only). */
async function approved<P>(change: PlannedChange<P>, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  let applied: unknown;
  const wrapped: PlannedChange<P> = {
    ...change, async plan() { return printable(plain(await change.plan())); },
    async apply(revision) { try { applied = plain(await change.apply(revision)); lastApply = { revision, result: applied }; return applied; } catch (error) { throw withPartialWords(error); } },
  };
  const result = await runWithApproval(wrapped, approval, io);
  const lines = result.exitCode === 0 && !approval.json ? resultLines(applied) : [];
  write(lines.length ? `${result.output}${plainText(lines.join('\n'), true)}\n` : result.output); return result.exitCode;
}

// ---- the entry point ---------------------------------------------------------------------------------------------------

const SPECS: Readonly<Record<Verb, FlagSpec & { readonly writes: boolean }>> = {
  status: { writes: false },
  adopt: { writes: true, many: ['--engine', '--pick', '--rename', '--acknowledge', '--every-engine', '--confirm'] },
  install: { writes: true, many: ['--engine'], one: ['--reconcile'], bool: ['--write-claude-md', '--pi-trust-saved'] },
  accept: { writes: false, positional: 1 },
  merge: { writes: true },
  drift: { writes: false, bool: ['--check'] },
  remove: { writes: true },
  recover: { writes: true, many: ['--keep', '--restore-mode', '--record-mode'], bool: ['--adoption'] },
};

/**
 * Runs one 0.8 harness command. `args` starts with `harness`. Returns 0 done, or 3 when a plan waits for approval; a
 * refusal throws (exit 1, or 2 for USAGE). A fidelity refusal also prints its lines first, and the thrown error carries
 * them as `refusedLines`.
 */
export async function runHarnessDefCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args[0] !== 'harness' || !(VERBS as readonly string[]).includes(args[1] ?? '')) usage();
  const verb = args[1] as Verb, spec = SPECS[verb];
  const approval = parseApprovalFlags(args.slice(2));
  if (approval.approve !== undefined && !spec.writes) usage(`harness ${verb} takes no --approve.`);
  const flags = parseFlags(approval.rest, spec);
  if (verb === 'recover' && flags.bools.has('--adoption') && ['--keep', '--restore-mode', '--record-mode'].some(k => all(flags, k).length)) usage('recover --adoption takes no --keep, --restore-mode, or --record-mode.');
  // Ctrl-C and a terminate request stop the run at its next safe point; the handlers are gone when the command ends.
  lastApply = null;
  const controller = new AbortController(), stop = (): void => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    return await dispatch(verb, flags, approval, { cwd, home, env, signal: controller.signal, io, write });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    // The run was asked to stop. What the error says stays: a stopped write may have left work for recover.
    const e = withPartialWords(error) as { code?: unknown; message?: unknown; next?: unknown } | null;
    const code = codeOf(error), message = typeof e?.message === 'string' ? e.message : '', next = typeof e?.next === 'string' ? e.next : null;
    write(approval.json ? newCommandJson(plain({ stopped: true, code, message, ...(next !== null ? { next } : {}) }))
      : `${plainText(`Stopped by a stop request. ${message}${next !== null ? ` ${next}` : ''}`, true).trim()}\n`);
    return 130;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

async function dispatch(
  verb: Verb, flags: Flags, approval: ReturnType<typeof parseApprovalFlags>,
  run: { cwd: string; home: string; env: NodeJS.ProcessEnv; signal: AbortSignal; io: ApprovalIo; write: (text: string) => void },
): Promise<number> {
  const { io, write } = run;
  const c = await contextOf(run.cwd, run.home, run.env, flags, run.signal, verb === 'status');
  const a = { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json };
  const go = (): Promise<number> => {
    switch (verb) {
      case 'status': return status(c, approval.json, write);
      case 'adopt': return adopt(c, flags, a, io, write);
      case 'install': return install(c, flags, a, io, write);
      case 'accept': return accept(c, flags, approval.json, write);
      case 'merge': return merge(c, a, io, write);
      case 'drift': return drift(c, flags.bools.has('--check'), approval.json, write);
      case 'remove': return remove(c, a, io, write);
      case 'recover': return recover(c, flags, a, io, write);
    }
  };
  // Usage events for the local log: S1 adopt, S2 install, S5 remove and recover. The log never changes a result.
  const step = verb === 'adopt' || verb === 'install' || verb === 'remove' || verb === 'recover' ? verb : null;
  if (step === null) return go();
  const where = { env: run.env, home: run.home };
  return recordScenario(where, outcome => {
    // A refusal names the step. Only a run that applied a write is a done scenario: a no-op install applied nothing.
    if (outcome === 'refused') return { step, ...(step === 'install' ? { targetRoot: c.dir } : {}) };
    if (lastApply === null) return null;
    const engines = step === 'install' ? installedEngines(lastApply.result) : undefined;
    const scenario = step === 'adopt' ? 'S1' : step === 'install' ? (engines?.includes('claude-code') && engines.includes('codex') ? 'S2' : undefined) : 'S5';
    return {
      step, ...(scenario !== undefined ? { scenario } : {}), plan: lastApply.revision,
      ...(engines !== undefined && engines.length ? { engines } : {}), ...(step === 'install' ? { targetRoot: c.dir } : {}),
    };
  }, go);
}

/** The engine ids a result lists under `installed`. */
const installedEngines = (result: unknown): string[] | undefined => {
  const list = (result as { installed?: unknown } | null)?.installed;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : undefined;
};
