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
import { applyProjectApply, planProjectApply, syncError } from '../../../packages/project-sync/src/index.js';
import type { AgentItem, ApplyInput, ApplyPlan, ApplyResult, PromptItem, SyncItem } from '../../../packages/project-sync/src/index.js';
import type { Harness } from '../../../packages/managed-skills/src/v2-types.js';
import { revisionOf } from '../../../packages/skill-sources/src/validation.js';
import { parseApprovalFlags, runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';
import { harnessWords, itemLine, maxRequestsFlag, requestLine, sourceTag, withInterrupt } from './sync.js';

const APPLY_USAGE = 'Use bowerloom apply [--harness claude|codex|both] [--allow-agent <role>:<hash>]... [--frozen] [--max-github-requests <n>], with optional --approve <revision> and --json.';
const usage = (): never => { throw new DefinitionError('USAGE', APPLY_USAGE); };
const HARNESSES: Readonly<Record<string, Harness[]>> = { claude: ['claude'], codex: ['codex'], both: ['claude', 'codex'] };
const NULL_PINS = revisionOf(null);
const SURFACE_HARNESS: Readonly<Record<string, Harness>> = { 'projection-claude': 'claude', 'command-claude': 'claude', 'agent-claude': 'claude', 'projection-codex': 'codex' };

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
  const notices = item.notices;
  if (!copies || notices === null || !notices.length || !item.expected.surfaces.some(s => s.id === 'command-claude')) return [];
  const what = [notices.includes('allowed-tools') ? 'sets allowed-tools in its frontmatter' : null,
    notices.includes('hooks') ? 'registers hooks that keep running for the rest of the session' : null,
    notices.includes('shell-lines') ? 'runs shell commands marked with !' : null].filter((w): w is string => w !== null)
    .reduce((all, w, i, list) => i === 0 ? w : `${all}${i === list.length - 1 ? ' and ' : ', '}${w}`, '');
  const where = item.origin === 'store' ? (item.resolvedFrom === 'lock' && item.lockPin ? item.lockPin.remote.slice('https://'.length) : `~/.bowerloom/prompts/${item.id}.md`) : `.bowerloom/prompts/${item.id}.md`;
  return [`  Note: prompt ${item.id} ${what}. Claude Code applies them when the command runs. Review ${where}.`];
}
function promptLine(item: PromptItem, width: number): string[] {
  const state = promptState(item, width), tag = item.origin == null ? '' : sourceTag({ ...item, lockPin: item.lockPin ?? null, kind: null, pin: null });
  return [...(state.length ? [`${state[0]}${tag}`, ...state.slice(1)] : state), ...noticeLine(item)];
}
function promptState(item: PromptItem, width: number): string[] {
  const id = item.id.padEnd(width), where = ['command-claude', 'projection-codex'].flatMap(id => item.expected.surfaces.filter(s => s.id === id).map(s => s.path)).join(' and ');
  if (item.action === 'hold') return [`  ${id} held (${item.hold!.code})`, `  ${''.padEnd(width)} Next: ${item.hold!.next}`];
  switch (item.state) {
    case 'new': return [`  ${id} install prompt: ${where}${item.notices === null ? ' (not on this machine yet; Bowerloom shows what it can do after the fetch)' : ''}`];
    case 'edited': return [`  ${id} update prompt: ${where}`];
    case 'harnesses-changed': return [`  ${id} add ${harnessWords(added(item.before))} copies`];
    case 'orphaned': return [`  ${id} kept: no longer a prompt of this project, and apply removes nothing`];
    default: return [`  ${id} up to date${item.action === 'update' ? ' (puts back .bowerloom/managed/.gitignore)' : ''}`];
  }
}
/**
 * A team agent's Claude Code file can grant tools, register hooks and start servers when the agent runs (spec 01a,
 * section 3.2). The notice names them; it never quotes the file.
 */
export const NOTICE_WORDS: Readonly<Record<string, string>> = {
  hooks: 'sets hooks', mcpServers: 'sets mcpServers', 'shell-tools': 'lists shell tools in tools', 'edit-tools': 'lists file-editing tools in tools',
  'web-tools': 'lists web tools in tools', 'mcp-tools': 'lists MCP tools in tools', 'agent-tools': 'lists the Agent tool in tools', 'all-tools': 'inherits every tool, including shell tools',
};
/** The words of one notice, as the plan prints them. */
export const noticeWords = (n: string): string => n.startsWith('permissionMode:') ? `sets permissionMode ${n.slice('permissionMode:'.length)}` : NOTICE_WORDS[n] ?? n;
function agentNoticeLine(item: AgentItem): string[] {
  const copies = item.action === 'install' || item.action === 'update';
  if (!copies || !item.notices.length) return [];
  const what = item.notices.map(n => (n.startsWith('permissionMode:') ? `sets permissionMode ${n.slice('permissionMode:'.length)}` : NOTICE_WORDS[n]!) + (item.newNotices.includes(n) ? ' (new)' : ''))
    .reduce((all, w, i, list) => i === 0 ? w : `${all}${i === list.length - 1 ? ' and ' : ', '}${w}`, '');
  return [`  Note: agent ${item.id} ${what}. Claude Code applies them when the agent runs. Review .bowerloom/teams/${item.team}/agents/${item.id}.md.`];
}
function agentLine(item: AgentItem, width: number, terminal: boolean): string[] {
  const id = item.id.padEnd(width), pad = ''.padEnd(width), where = item.expected.surfaces.filter(s => s.id === 'agent-claude').map(s => s.path).join(' and ');
  if (item.action === 'hold') {
    // The plan holds no flag text, so a terminal and a pipe see one revision. At a terminal the text names the exact flag.
    const next = terminal && item.hold!.code === 'AGENT_GRANT_REVIEW_REQUIRED' && item.sourceSha256 !== null && item.expected.source !== null
      ? `Read .bowerloom/${item.expected.source.path}, then run bowerloom apply --allow-agent ${item.id}:${item.sourceSha256}.` : item.hold!.next;
    return [`  ${id} agent held (${item.hold!.code})`, `  ${pad} Next: ${next}`];
  }
  const copies = item.action !== 'none', warning = [
    ...(item.builtin && copies ? [`  ${pad} Warning: ${item.id} is also the name of a built-in Claude Code agent. Check which one Claude Code uses.`] : []),
    ...(item.userCopy && copies ? [`  ${pad} Warning: ${item.id} also exists in ~/.claude/agents. This project's agent takes precedence in this project.`] : []),
  ];
  switch (item.state) {
    case 'new': return [`  ${id} install agent: ${where}`, ...warning, ...agentNoticeLine(item)];
    case 'adopt': return [`  ${id} adopt agent: ${where}`, ...warning, ...agentNoticeLine(item)];
    case 'edited': return [`  ${id} update agent: ${where}`, ...warning, ...agentNoticeLine(item)];
    case 'orphaned': return [`  ${id} agent kept: no longer an agent of this project, and apply removes nothing`];
    default: return [`  ${id} agent up to date${item.action === 'update' ? ' (puts back .bowerloom/managed/.gitignore)' : ''}`];
  }
}
/** Where copies go, for the chosen harnesses only (review freeze finding 9). */
function places(harnesses: readonly Harness[]): string {
  const all = ['.bowerloom/managed', ...harnesses.map(h => h === 'claude' ? '.claude' : '.agents')];
  return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}
/** The apply plan in plain words. confirm.ts escapes control characters again before printing. */
export function renderApplyReview(plan: ApplyPlan, terminal = false): string {
  const skills = plan.skills?.items ?? [], width = Math.max(0, ...skills.map(i => i.id.length), ...plan.prompts.map(p => p.id.length), ...plan.agents.map(a => a.id.length)) + 1;
  const claude = plan.harnesses.includes('claude');
  const lines = [...skills.flatMap(i => skillLine(i, width)), ...plan.prompts.flatMap(p => promptLine(p, width)), ...plan.agents.flatMap(a => agentLine(a, width, terminal)), ...(plan.storeFetch ?? []).map(f => `  ${f.id.padEnd(width)} fetch ${f.kind} into the store cache [store, from the lock: ${f.lockPin.remote.slice('https://'.length)}]`)];
  const fetching = [...skills.filter(i => (i.action === 'install' || i.action === 'update') && (i.cache?.status === 'needs-fetch' || i.storeCache === 'missing')), ...plan.prompts.filter(p => (p.action === 'install' || p.action === 'update') && p.storeCache === 'missing'), ...(plan.storeFetch ?? []).filter(f => f.storeCache === 'missing')].length;
  const network = !plan.frozen ? 'Network: none. Apply never fetches. A pin that is not cached yet needs bowerloom skills sync first.'
    : fetching ? `Network: reads ${plan.network.hosts.join(' and ')} for ${fetching} ${fetching === 1 ? 'item' : 'items'}, public and without credentials. Bytes must match their pins or bowerloom.lock.json.` : 'Network: none now. Every item is on this machine.';
  return [
    ...(plan.bowerloomFolder === 'create' && plan.actionable ? ['Create .bowerloom (records of the copies). Its contents are git-ignored.'] : []),
    `${claude ? 'Apply skills, prompts, and agents for' : 'Apply skills and prompts for'} ${harnessWords(plan.harnesses)}${plan.team ? `, team ${plan.team}` : ''}`,
    ...(lines.length ? lines : [plan.config != null ? '  Nothing is selected to apply yet.' : claude ? '  Nothing in .bowerloom/skills.json, .bowerloom/prompts, or .bowerloom/teams/*/agents to apply yet.' : '  Nothing in .bowerloom/skills.json or .bowerloom/prompts to apply yet.']),
    ...(plan.notes ?? []),
    ...(plan.agents.some(a => a.action !== 'hold' && a.notices.length && (a.action === 'install' || a.action === 'update')) ? ['  Hooks run shell commands, and Claude Code may use an agent without being asked, based on its description.'] : []),
    ...(plan.codexAgentsSkipped ? ['Codex agents are not projected in this beta. See the capability model design.'] : []),
    network,
    ...requestLine(plan.network),
    `Copies go to ${places(plan.harnesses)}, and stay on this machine. Apply adds copies and removes none.`,
    plan.agents.some(a => (a.action === 'install' || a.action === 'update') && a.notices.length) ? 'This copies text files only. Bowerloom starts no workers and runs nothing itself.' : 'This copies text files only. It starts no workers and runs nothing.',
    plan.pointer,
  ].join('\n');
}
function resultWords(result: ApplyResult): string {
  const name = (r: { kind: string; id: string }) => r.kind === 'prompt' ? `prompt ${r.id}` : r.kind === 'agent' ? `agent ${r.id}` : r.id;
  return plainText([
    ...result.applied.map(a => `  ${name(a)}: ${a.action === 'install' ? 'installed' : 'updated'}`),
    ...result.held.map(h => `  ${name(h)}: held (${h.code}). Next: ${h.next}`),
    ...(result.orphaned.length ? [`  kept, no longer listed: ${result.orphaned.map(name).join(', ')}`] : []),
    result.pointer, '',
  ].join('\n'), true);
}

/** Takes `--harness <claude|codex|both>` out of the words; the rest goes to the approval wrapper. */
export function parseHarness(words: readonly string[]): { harnesses: Harness[]; rest: string[]; frozen: boolean } {
  let harnesses: Harness[] | null = null, frozen = false; const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--frozen') { if (frozen) usage(); frozen = true; }
    else if (word === '--harness') { const value = words[++i]; if (harnesses !== null || value === undefined || !Object.hasOwn(HARNESSES, value)) usage(); harnesses = [...HARNESSES[value!]!]; }
    else if (word.startsWith('--harness=')) usage();
    else rest.push(word);
  }
  return { harnesses: harnesses ?? [...HARNESSES.both!], rest, frozen };
}

/** Takes `--max-github-requests <n>` out of the words, once at most (second review L2). */
function takeMaxRequests(words: readonly string[]): { max: number | undefined; rest: string[] } {
  let max: number | undefined; const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--max-github-requests') { if (max !== undefined) usage(); max = maxRequestsFlag(words[++i], APPLY_USAGE); if (max === undefined) usage(); }
    else if (word.startsWith('--max-github-requests=')) usage();
    else rest.push(word);
  }
  return { max, rest };
}
/** Takes every `--allow-agent <role>:<64 hex>` out of the words (it repeats); the rest goes on. */
export function takeAllow(words: readonly string[]): { allow: string[]; rest: string[] } {
  const allow: string[] = [], rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--allow-agent') { const value = words[++i]; if (value === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-f0-9]{64}$/.test(value)) usage(); allow.push(value!); }
    else if (word.startsWith('--allow-agent=')) usage();
    else rest.push(word);
  }
  return { allow: [...new Set(allow)].sort(), rest };
}

/**
 * The terminal gate is a guardrail, not a boundary. It stops a pipe, `--json` and a CI job from allowing an agent by accident.
 * An agent with a shell or file-write access can drive a pseudo-terminal, or write `.claude/agents` itself, so the gate cannot
 * stop it. Owner decision: https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6335208424
 */
const TERMINAL_ONLY = 'The flag --allow-agent works only in a terminal, and not with --json. Run bowerloom apply in a terminal to review and allow it.';
/** `--allow-agent` is for a person at a terminal: no pipe, no --json. */
export function requireTerminal(io: ApprovalIo, json: boolean): void { if (!io.interactive || json) throw new DefinitionError('USAGE', TERMINAL_ONLY); }
const GRANT_WORDS: Readonly<Record<string, string>> = { hooks: 'hooks', mcpServers: 'MCP servers', 'permissionMode:bypassPermissions': 'bypass permissions' };
/** For each agent the plan will install because of an allowance, the person types its role name. A wrong answer allows nothing. */
export async function confirmAllowances(plan: ApplyPlan, io: ApprovalIo, write: (text: string) => void): Promise<void> {
  let shown = false;
  for (const a of plan.agents) {
    const grants = a.notices.filter(n => n in GRANT_WORDS);
    if ((a.action !== 'install' && a.action !== 'update') || !grants.length || !plan.allow.some(x => x.startsWith(a.id + ':'))) continue;
    // The person reads the notes first: the review is written before the first question.
    if (!shown) { write(`${plainText(renderApplyReview(plan, true), true)}\n`); shown = true; }
    const answer = (await io.ask(`Type ${a.id} to allow its ${grants.map(n => GRANT_WORDS[n]).join(', ')}: `)).trim();
    if (answer !== a.id) throw syncError('AGENT_GRANT_REVIEW_REQUIRED', `You did not type ${a.id}, so nothing was allowed. Nothing was changed.`);
  }
}

/** `bowerloom apply`. Returns the exit code: 0 done or nothing to do, 3 approval required. A refusal throws. */
export async function runApplyCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const parsedHarness = parseHarness(args.slice(1)), { harnesses } = parsedHarness, { allow, rest: afterAllow } = takeAllow(parsedHarness.rest);
  const { max, rest } = takeMaxRequests(afterAllow);
  const approval = parseApprovalFlags(rest); if (approval.rest.length) usage();
  const project = discoverProject(cwd, home), stateRoot = privateStateRoot(env, home);
  if (allow.length) requireTerminal(io, approval.json);
  const input = (): ApplyInput => ({ project, stateRoot, home, frozen: parsedHarness.frozen, harnesses, team: null, allow, ...(max !== undefined ? { maxGithubRequests: max } : {}) });
  const first = await planProjectApply(input());
  if (allow.length) await confirmAllowances(first, io, write);
  if (!first.actionable && approval.approve === undefined) {
    write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderApplyReview(first, io.interactive), true)}\nNothing to change.\n`); return 0;
  }
  let pending: ApplyPlan | null = first, result: ApplyResult | null = null;
  const change: PlannedChange<ApplyPlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planProjectApply(input()); },
    revision: plan => plan.revision, review: plan => renderApplyReview(plan, io.interactive && !approval.json),
    async apply(revision: string) {
      result = await withInterrupt((signal, managed) => applyProjectApply(input(), revision, signal, { managed })); return result;
    },
  };
  return runApprovalCommand(rest, change, io, text => write(text + (result && !approval.json ? resultWords(result) : '')));
}
