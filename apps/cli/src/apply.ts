/**
 * `bowerloom apply [--harness claude|codex|both] [--approve <revision>] [--json]` (build plan 01, M6).
 *
 * Puts the project's skills and prompts in place for Claude Code, Codex or both (the default), from what this machine
 * already holds. It never fetches, never removes a copy, never edits AGENTS.md or CLAUDE.md (it prints a pointer
 * instead), and starts no process. The write runs through the approval wrapper; the core takes the project lock.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyProjectApply, planProjectApply } from '../../../packages/project-sync/src/index.js';
import type { ApplyInput, ApplyPlan, ApplyResult, PromptItem, SyncItem } from '../../../packages/project-sync/src/index.js';
import type { Harness } from '../../../packages/managed-skills/src/v2-types.js';
import { revisionOf } from '../../../packages/skill-sources/src/validation.js';
import { parseApprovalFlags, runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';
import { harnessWords, itemLine, withInterrupt } from './sync.js';

const APPLY_USAGE = 'Use bowerloom apply [--harness claude|codex|both], with optional --approve <revision> and --json.';
const usage = (): never => { throw new DefinitionError('USAGE', APPLY_USAGE); };
const HARNESSES: Readonly<Record<string, Harness[]>> = { claude: ['claude'], codex: ['codex'], both: ['claude', 'codex'] };
const NULL_PINS = revisionOf(null);
const SURFACE_HARNESS: Readonly<Record<string, Harness>> = { 'projection-claude': 'claude', 'command-claude': 'claude', 'projection-codex': 'codex' };

/** The harnesses an update adds: those whose copy is not there yet. */
function added(before: readonly { id: string; stablePinsDigest: string | null }[]): Harness[] {
  return (['claude', 'codex'] as Harness[]).filter(h => before.some(b => SURFACE_HARNESS[b.id] === h && b.stablePinsDigest === NULL_PINS));
}
function skillLine(item: SyncItem, width: number): string[] {
  if (item.state === 'harnesses-changed' && item.action === 'update') return [`  ${item.id.padEnd(width)} add ${harnessWords(added(item.before))} copies`];
  return itemLine(item, width);
}
/** Review M6 finding 5: a prompt whose Claude Code command can grant tools or run shell lines is named, never quoted. */
function noticeLine(item: PromptItem): string[] {
  const copies = item.action === 'install' || item.action === 'update';
  if (!copies || !item.notices.length || !item.expected.surfaces.some(s => s.id === 'command-claude')) return [];
  const what = [item.notices.includes('allowed-tools') ? 'sets allowed-tools in its frontmatter' : null, item.notices.includes('shell-lines') ? 'runs shell commands marked with !' : null].filter(Boolean).join(' and ');
  return [`  Note: prompt ${item.id} ${what}. Claude Code applies them when the command runs. Review .bowerloom/prompts/${item.id}.md.`];
}
function promptLine(item: PromptItem, width: number): string[] {
  return [...promptState(item, width), ...noticeLine(item)];
}
function promptState(item: PromptItem, width: number): string[] {
  const id = item.id.padEnd(width), where = ['command-claude', 'projection-codex'].flatMap(id => item.expected.surfaces.filter(s => s.id === id).map(s => s.path)).join(' and ');
  if (item.action === 'hold') return [`  ${id} held (${item.hold!.code})`, `  ${''.padEnd(width)} Next: ${item.hold!.next}`];
  switch (item.state) {
    case 'new': return [`  ${id} install prompt: ${where}`];
    case 'edited': return [`  ${id} update prompt: ${where}`];
    case 'harnesses-changed': return [`  ${id} add ${harnessWords(added(item.before))} copies`];
    case 'orphaned': return [`  ${id} kept: no longer a prompt of this project, and apply removes nothing`];
    default: return [`  ${id} up to date${item.action === 'update' ? ' (puts back .bowerloom/managed/.gitignore)' : ''}`];
  }
}
/** The apply plan in plain words. confirm.ts escapes control characters again before printing. */
export function renderApplyReview(plan: ApplyPlan): string {
  const skills = plan.skills?.items ?? [], width = Math.max(0, ...skills.map(i => i.id.length), ...plan.prompts.map(p => p.id.length)) + 1;
  const lines = [...skills.flatMap(i => skillLine(i, width)), ...plan.prompts.flatMap(p => promptLine(p, width))];
  return [
    `Apply skills and prompts for ${harnessWords(plan.harnesses)}${plan.team ? `, team ${plan.team}` : ''}`,
    ...(lines.length ? lines : ['  Nothing in .bowerloom/skills.json or .bowerloom/prompts to apply yet.']),
    'Network: none. Apply never fetches. A pin that is not cached yet needs bowerloom skills sync first.',
    'Copies go to .bowerloom/managed, .claude and .agents, and stay on this machine. Apply adds copies and removes none.',
    'This copies text files only. It starts no workers and runs nothing.',
    plan.pointer,
  ].join('\n');
}
function resultWords(result: ApplyResult): string {
  const name = (r: { kind: string; id: string }) => r.kind === 'prompt' ? `prompt ${r.id}` : r.id;
  return plainText([
    ...result.applied.map(a => `  ${name(a)}: ${a.action === 'install' ? 'installed' : 'updated'}`),
    ...result.held.map(h => `  ${name(h)}: held (${h.code}). Next: ${h.next}`),
    ...(result.orphaned.length ? [`  kept, no longer listed: ${result.orphaned.map(name).join(', ')}`] : []),
    result.pointer, '',
  ].join('\n'), true);
}

/** Takes `--harness <claude|codex|both>` out of the words; the rest goes to the approval wrapper. */
export function parseHarness(words: readonly string[]): { harnesses: Harness[]; rest: string[] } {
  let harnesses: Harness[] | null = null; const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--harness') { const value = words[++i]; if (harnesses !== null || value === undefined || !Object.hasOwn(HARNESSES, value)) usage(); harnesses = [...HARNESSES[value!]!]; }
    else if (word.startsWith('--harness=')) usage();
    else rest.push(word);
  }
  return { harnesses: harnesses ?? [...HARNESSES.both!], rest };
}

/** `bowerloom apply`. Returns the exit code: 0 done or nothing to do, 3 approval required. A refusal throws. */
export async function runApplyCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { harnesses, rest } = parseHarness(args.slice(1));
  const approval = parseApprovalFlags(rest); if (approval.rest.length) usage();
  const project = discoverProject(cwd, home), stateRoot = privateStateRoot(env, home);
  const input = (): ApplyInput => ({ project, stateRoot, harnesses, team: null });
  const first = await planProjectApply(input());
  if (!first.actionable && approval.approve === undefined) {
    write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderApplyReview(first), true)}\nNothing to change.\n`); return 0;
  }
  let pending: ApplyPlan | null = first, result: ApplyResult | null = null;
  const change: PlannedChange<ApplyPlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planProjectApply(input()); },
    revision: plan => plan.revision, review: renderApplyReview,
    async apply(revision: string) {
      result = await withInterrupt((signal, managed) => applyProjectApply(input(), revision, signal, { managed })); return result;
    },
  };
  return runApprovalCommand(rest, change, io, text => write(text + (result && !approval.json ? resultWords(result) : '')));
}
