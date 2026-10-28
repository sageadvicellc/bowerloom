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
import { applyAdoption, applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../packages/adoption/src/index.js';
import type { AdoptionInput } from '../../../packages/adoption/src/index.js';
import { EVERY_ENGINE_PARTS } from '../../../packages/adoption/src/model.js';
import type { AdoptionChoice, AdoptionPlan, EveryEnginePart } from '../../../packages/adoption/src/model.js';
import type { AdoptionRecoveryPlan } from '../../../packages/adoption/src/journal.js';
import { readJournal } from '../../../packages/adoption/src/journal.js';
import {
  MERGE_JOURNAL, applyInstructionMerge, applyInstructionMergeRecovery, planInstructionMerge, planInstructionMergeRecovery,
} from '../../../packages/adoption/src/merge.js';
import type { InstructionMergePlan, InstructionMergeRecoveryPlan } from '../../../packages/adoption/src/merge.js';
import {
  RECONCILE_ACTIONS, addApprovalDraft, applyPortable, applyPortableRecovery, applyPortableRemoval, dropApprovalDrafts, harnessStateDirs,
  instructionDrift, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readApprovalDrafts, readPortableReceipt,
  settleLegacyState,
} from '../../../packages/project-sync/src/index.js';
import type {
  DriftLine, HarnessStateDirs, InstructionDrift, LegacySettle, PortableInput, PortablePlan, PortableRecoveryPlan, PortableRemovalPlan,
  ReconcileAction, RecoveryInput,
} from '../../../packages/project-sync/src/index.js';
import { pendingExists } from '../../../packages/project-sync/src/portable-state.js';
import { ENGINE_IDS, entryHash, isEngineId, loadDefinition } from '../../../packages/harness-definition/src/index.js';
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
  '  bowerloom harness accept <line-key> [--json]',
  '  bowerloom harness merge [--approve <revision>] [--json]',
  '  bowerloom harness drift [--check] [--json]',
  '  bowerloom harness remove [--approve <revision>] [--json]',
  '  bowerloom harness recover [--adoption] [--keep <path>]... [--restore-mode <path>]... [--record-mode <path>]... [--approve <revision>] [--json]', '',
  'Every command takes --dir <absolute-folder>; the default is the working folder.',
  'Adopt reads the engine files of the folder and writes only .bowerloom. It changes no engine file.',
  'An adopted item applies to the engines whose files held it. --every-engine <part> makes every guardrail, hook, or MCP server',
  'apply to every engine of the harness; an item that differs between engines keeps its engines, and the plan says why.',
  'Install writes the engine files from .bowerloom. A rule an engine carries more weakly than the harness says is refused;',
  'each refused line has a key, and harness accept <key> approves that line. Then install again.',
  'Merge moves the text of CLAUDE.md into .bowerloom/instructions/AGENTS.md. Install then makes CLAUDE.md read AGENTS.md.',
  'Drift lists the files Bowerloom wrote that changed since. Recover keeps your version, or puts a mode back, or records it.',
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

interface Ctx { readonly dir: string; readonly dirs: HarnessStateDirs; readonly legacy: LegacySettle; readonly signal: AbortSignal; readonly env: NodeJS.ProcessEnv }

async function contextOf(cwd: string, home: string, env: NodeJS.ProcessEnv, flags: Flags): Promise<Ctx> {
  const dir = folderOf(cwd, home, single(flags, '--dir'));
  const dirs = harnessStateDirs(privateStateRoot(env, home), dir);
  const signal = new AbortController().signal;
  // Decision D3A: the record of the earlier app moves once, under the project lock, before any stage reads a record.
  const legacy = await settleLegacyState(dirs, dir, signal);
  return { dir, dirs, legacy, signal, env };
}

const portableIo = (c: Ctx): { projectDir: string; stateDir: string } => ({ projectDir: c.dir, stateDir: c.dirs.portable });
const definitionFolder = (c: Ctx): string => join(c.dir, '.bowerloom');
const hasDefinition = (c: Ctx): boolean => { try { return lstatSync(join(definitionFolder(c), 'harness.json')).isFile(); } catch { return false; } };
const loaded = (c: Ctx): Definition | null => { const r = loadDefinition(definitionFolder(c)); return r.ok ? r.definition : null; };
const mergeUnfinished = (c: Ctx): boolean => { try { lstatSync(join(c.dirs.adoption, MERGE_JOURNAL)); return true; } catch { return false; } };
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
  if (p.approvalsRequired.length) out.push(`Confirm each of these when you apply: ${p.approvalsRequired.map(k => `--confirm ${k}`).join(' ')}`);
  for (const w of p.warnings) out.push(`Note: ${w}`);
  for (const pr of p.problems) out.push(`Problem: ${pr.path} (${pr.code}) ${pr.message}`);
  out.push(p.ready ? 'The plan is ready to apply.' : 'The plan is not ready: answer each conflict and acknowledgement above, then plan again.');
  return out.join('\n');
}

function renderInstall(p: PortablePlan): string {
  const changing = p.changes.filter(c => c.action !== 'unchanged');
  const out = [`Install to ${p.engines.map(e => (e.version ? `${e.id} ${e.version}` : e.id)).join(', ')}: ${count(changing.length, 'file')} to change.`];
  for (const c of changing) out.push(`  ${c.action.padEnd(7)} ${c.path}`);
  for (const l of p.loss.filter(x => x.result !== 'exact')) out.push(`  ${l.result.padEnd(10)} ${lineName(l)}`);
  for (const a of p.approved) out.push(`  approved  ${lineName(a)} by ${a.who} at ${a.when}`);
  for (const t of p.trust.filter(x => x.state === 'pending trust')) out.push(`Pending trust (${t.engine}): ${t.path}. ${t.reason}`);
  for (const r of p.review) out.push(`Read before it is written: ${r.path} (${r.engine}, ${r.kind}). harness install --json shows its text.`);
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

const renderRemoval = (p: PortableRemovalPlan): string => [
  `Remove the installed files: ${count(p.changes.length, 'path')}.`,
  ...p.changes.map(c => `  ${c.action.padEnd(7)} ${c.path}`),
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

function renderDrift(lines: readonly DriftLine[], instructions: InstructionDrift | null): string {
  const out = lines.length ? [`Drift: ${count(lines.length, 'file')} Bowerloom wrote changed since the install.`] : ['No drift: every file Bowerloom wrote is as it wrote it.'];
  for (const d of lines) out.push(`  ${d.reason.padEnd(7)}  ${d.path}${d.reason === 'mode' && d.now ? ` (${d.recorded.mode.toString(8)} -> ${d.now.mode.toString(8)})` : ''}`);
  if (lines.length) out.push('Next: bowerloom harness recover --keep <path> for a changed file, --restore-mode <path> or --record-mode <path> for a mode.');
  if (instructions !== null) out.push('CLAUDE.md does not follow AGENTS.md. Install with --reconcile accept-agents or keep-both, or run harness merge first.');
  return `${plainText(out.join('\n'), true)}\n`;
}

// ---- the verbs ---------------------------------------------------------------------------------------------------------

async function status(c: Ctx, json: boolean, write: (text: string) => void): Promise<number> {
  const present = hasDefinition(c);
  let engines: { id: string; version: string | null }[] = [], problem: string | null = null, harness: string | null = null;
  if (present) {
    const r = loadDefinition(definitionFolder(c));
    if (r.ok) { harness = r.definition.harness.id; engines = r.definition.harness.engines.map(e => ({ id: e.id, version: e.version ?? null })); }
    else problem = r.problems[0]?.message ?? 'The harness definition does not load.';
  }
  const receipt = readPortableReceipt(portableIo(c));
  const drafts = readApprovalDrafts(c.dirs, c.dir).length;
  const unfinished = { projection: pendingExists(c.dirs.portable), adoption: readJournal(c.dirs.adoption, c.dir) !== null, merge: mergeUnfinished(c) };
  const body = {
    format: 'bowerloom/harness-status/v1beta1', folder: c.dir, legacy: c.legacy,
    definition: { present, harness, engines, problem }, projected: receipt !== null,
    receipt: receipt === null ? null : { revision: receipt.revision, engines: receipt.engines, files: receipt.files.length, approvals: receipt.approvals.length },
    unfinished, drafts,
  };
  if (json) { write(newCommandJson(plain(body))); return 0; }
  const out = [present ? `Harness ${harness ?? '(does not load)'} for ${engines.map(e => (e.version ? `${e.id} ${e.version}` : e.id)).join(', ') || 'no engine'}.` : 'No harness definition in this folder. Next: bowerloom harness adopt.'];
  if (problem !== null) out.push(`The definition does not load: ${problem}`);
  out.push(receipt === null ? 'Nothing is installed.' : `Installed: ${count(receipt.files.length, 'file')} for ${receipt.engines.map(e => e.id).join(', ')}, ${count(receipt.approvals.length, 'approved line')}.`);
  if (drafts) out.push(`${count(drafts, 'accepted line')} waiting for the next install.`);
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
    async apply(revision) { const r = await applyAdoption(input, revision, confirms); return { written: r.written.map(p => `.bowerloom/${p}`) }; },
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

async function install(c: Ctx, f: Flags, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  installInput(c, f, []);
  let first: PortablePlan;
  try { first = planPortable(installInput(c, f, approvalsNow(c))); } catch (error) { if (fidelityOf(error) !== null) return refuseFidelity(c, error, approval.json, write); throw error; }
  // Spec L check 10: a plan that would write nothing is a no-op, with no approval asked.
  if (first.noop) { write(approval.json ? newCommandJson(plain({ nothingToDo: true, noop: true, plan: first, revision: first.revision })) : `${plainText(renderInstall(first), true)}\nNothing to change.\n`); return 0; }
  let pending: PortablePlan | null = first;
  const change: PlannedChange<PortablePlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planPortable(installInput(c, f, approvalsNow(c))); },
    revision: p => p.revision, review: renderInstall,
    async apply(revision) {
      const input = installInput(c, f, approvalsNow(c));
      const r = await applyPortable(input, revision, c.signal);
      // The receipt records the approvals now, so their drafts go.
      if (r.receipt !== null) dropApprovalDrafts(c.dirs, c.dir, r.receipt.approvals);
      return { noop: r.noop, receipt: r.receipt?.revision ?? null, leftBehind: r.leftBehind };
    },
  };
  return approved(change, approval, io, write);
}

/** `harness accept <key>`: one approval draft for one refused line, bound to the hash of its entry now. */
async function accept(c: Ctx, f: Flags, json: boolean, write: (text: string) => void): Promise<number> {
  const key = f.positional[0]!;
  const match = /^(.+)@([a-z-]+):([a-f0-9]{12})$/.exec(key);
  if (match === null || !isEngineId(match[2])) usage('accept takes the key of a refused line, as harness install prints it: <part>/<entry>[.<field>]@<engine>:<hash12>.');
  const def = loaded(c);
  // The lines of every listed engine, with no approval, so a line approved before is found too.
  let lines: RefusedLine[] = [];
  try { planPortable({ projectDir: c.dir, definitionFolder: definitionFolder(c), stateDir: c.dirs.portable, approvals: [] }); } catch (error) {
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
  const draft = addApprovalDraft(c.dirs, c.dir, {
    part: line!.part as FidelityApproval['part'], entry: line!.entry, ...(line!.field !== undefined ? { field: line!.field } : {}), engine: line!.engine as EngineId,
    result: line!.result, entryHash: hash, who: who.slice(0, 256),
    reason: `Accepted with bowerloom harness accept after reading this line: ${line!.reason}`.slice(0, 4096),
  }, { definition: def! });
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
  const lines = portableDrift(portableIo(c));
  const def = loaded(c);
  const engines = def === null ? [] : def.harness.engines.map(e => e.id);
  const instructions = def === null || def.instructions === undefined ? null : instructionDrift(c.dir, engines, true);
  write(json ? newCommandJson(plain({ format: 'bowerloom/harness-drift/v1beta1', drift: lines, instructions })) : renderDrift(lines, instructions));
  if (check && lines.length) throw new DefinitionError('PORTABLE_DRIFT', `${count(lines.length, 'file')} Bowerloom wrote changed since the install.`);
  return 0;
}

async function remove(c: Ctx, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const change: PlannedChange<PortableRemovalPlan> = {
    async plan() { return planPortableRemoval(portableIo(c)); }, revision: p => p.revision, review: renderRemoval,
    async apply(revision) {
      const r = await applyPortableRemoval(portableIo(c), revision, c.signal);
      dropApprovalDrafts(c.dirs, c.dir);
      return { restored: r.restored, deleted: r.deleted, leftBehind: r.leftBehind };
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
      async apply(revision) { return applyAdoptionRecovery(input, revision); },
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

/** The approval wrapper, with plain JSON in and out. */
async function approved<P>(change: PlannedChange<P>, approval: { approve?: string; json: boolean }, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const wrapped: PlannedChange<P> = {
    ...change, async plan() { return plain(await change.plan()); },
    async apply(revision) { try { return plain(await change.apply(revision)); } catch (error) { throw withPartialWords(error); } },
  };
  const result = await runWithApproval(wrapped, approval, io);
  write(result.output); return result.exitCode;
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
  const c = await contextOf(cwd, home, env, flags);
  const a = { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json };
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
}
