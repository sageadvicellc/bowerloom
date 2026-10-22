/**
 * `bowerloom cache list [--json]` and `bowerloom cache prune <selectors> [--approve <revision>] [--json]` (spec 09). The
 * library is packages/project-sync/src/cache-admin.ts. List reads only. Prune shows a plan first and deletes only what
 * an approval names, under the cache lock. Nothing is deleted by itself.
 */
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { ProjectContext, PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyCachePrune, listCache, planCachePrune, CACHE_LIST_LIMIT, CACHE_USAGE } from '../../../packages/project-sync/src/index.js';
import type { CacheEntry, CacheList, CachePruneInput, CachePrunePlan, CachePruneResult, CachePruneSelectors, PickedEntry, PruneInterrupt } from '../../../packages/project-sync/src/index.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, orderedJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

const usage = (): never => { throw new DefinitionError('USAGE', CACHE_USAGE); };
const IN_USE = '(another command is using it)', OLD_LOCK = '(its owner lock is older than a day)';

/** A size in words (3.3): bytes below 1024, then KiB, then MiB, with one decimal. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
/** The short id of a line: the first 8 characters, or the whole name of a leftover, whose id is its name. */
const id8 = (e: { id: string; name: string }): string => e.id === e.name ? e.name : e.id.slice(0, 8);
const tags = (r: { store: boolean | null; project: boolean | null }): string => {
  const t = [...(r.store === true ? ['[store]'] : []), ...(r.project === true ? ['[project]'] : [])];
  return t.length ? `  ${t.join(' ')}` : '';
};
const sized = (files: number | null, bytes: number | null): string => files !== null && bytes !== null ? `  (${files} files, ${humanBytes(bytes)})` : '';
const what = (e: { label: string | null }): string => e.label ?? 'unfinished fetch';
const sources = (names: readonly string[]): string => names.join(' and ');

function listLine(e: CacheEntry): string {
  const head = e.scope === 'project-legacy' ? `${e.projectId!.slice(0, 8)}/${id8(e)}` : id8(e);
  const note = e.active ? `  ${e.stale ? OLD_LOCK : IN_USE}` : '';
  return `  ${head}  ${e.status.padEnd(9)}  ${what(e)}${e.status === 'completed' ? sized(e.files, e.bytes) : ''}${e.scope === 'project-legacy' ? '' : tags(e.references)}${note}`;
}
/** `cache list` in words (3.3). */
export function renderCacheList(list: CacheList): string {
  if (list.entries.length === 0) return 'The cache is empty.\n';
  const lines: string[] = [];
  const of = (scope: CacheEntry['scope']) => list.entries.filter(e => e.scope === scope);
  const machine = of('machine'), store = of('store'), legacy = of('project-legacy');
  if (machine.length) lines.push(`Skills cache: ${join(list.stateRoot, 'cache')}`, ...machine.map(listLine));
  if (store.length) lines.push(`Store cache: ${join(list.stateRoot, 'store-cache')}`, ...store.map(listLine));
  if (legacy.length) lines.push(`Earlier per-project caches: ${legacy.length} entries in ${new Set(legacy.map(e => e.projectId)).size} projects`, ...legacy.map(listLine));
  lines.push(`Total: ${list.totals.entries} entries, ${humanBytes(list.totals.bytes)}`);
  if (list.truncated) lines.push(`More entries exist. Only the first ${CACHE_LIST_LIMIT} are shown.`);
  if (list.unreadableSources.length) lines.push(`Some references were not checked: ${sources(list.unreadableSources)}.`);
  return plainText(`${lines.join('\n')}\n`, true);
}

const place = (p: { scope: string; projectId: string | null }): string => p.scope === 'machine' ? 'cache' : p.scope === 'store' ? 'store-cache' : `legacy ${p.projectId!.slice(0, 8)}`;
function deleteLine(p: PickedEntry): string {
  const body = p.status === 'completed' ? `${what(p)}${sized(p.files, p.bytes)}` : what(p);
  return `  delete  ${body}  ${place(p)} ${id8(p)}${tags(p.references)}${p.stale ? `  ${OLD_LOCK}` : ''}`;
}
/** The prune plan in words (3.4). */
export function renderCachePrune(plan: CachePrunePlan): string {
  const lines = ['Prune the skills cache', ...plan.picked.map(deleteLine)];
  for (const s of plan.skipped) lines.push(`  skip    ${s.label ?? 'unfinished fetch'}  ${place(s)} ${s.id.slice(0, 8)}  ${IN_USE}`);
  if (plan.unreadableSources.length) lines.push(`Some references were not checked: ${sources(plan.unreadableSources)}. --unreferenced picks nothing.`);
  if (plan.truncated) lines.push(`More entries exist. Only the first ${CACHE_LIST_LIMIT} are listed. Run the command again after this one.`);
  lines.push(`Frees about ${humanBytes(plan.freed)}.`);
  if (plan.picked.some(p => p.references.store === true || p.references.project === true)) lines.push('When a command needs an entry that this project or your store still lists, Bowerloom fetches it again.');
  lines.push('Other projects on this machine are not checked.', 'This deletes cached skill bytes only. It deletes no project file and no installed copy.');
  return lines.join('\n');
}
const entries = (n: number): string => `${n} entries`;
/** The words of a finished prune (3.4). */
export function renderPruneResult(result: CachePruneResult, plan: CachePrunePlan): string {
  return `Deleted ${entries(result.deleted.length)}, about ${humanBytes(plan.freed)}.\n${result.skipped.length ? `Skipped ${entries(result.skipped.length)} that another command is using.\n` : ''}`;
}

/** The project of the current folder: null outside one, and the code of any other discovery refusal (3.2). */
function projectOf(cwd: string, home: string): { project: ProjectContext | null; projectError: string | null } {
  try { return { project: discoverProject(cwd, home), projectError: null }; }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'PROJECT_NOT_FOUND') return { project: null, projectError: null };
    if (error instanceof DefinitionError && typeof code === 'string') return { project: null, projectError: code };
    throw error;
  }
}
/** Takes the prune selectors out of a command line. Each flag once; --entry once per prefix. */
function parseSelectors(words: readonly string[]): { selectors: CachePruneSelectors; rest: string[] } {
  const selectors: CachePruneSelectors = { unreferenced: false, partial: false, legacy: false, all: false, entries: [] }, rest: string[] = [];
  const flag = (name: 'unreferenced' | 'partial' | 'legacy' | 'all'): void => { if (selectors[name]) usage(); selectors[name] = true; };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--unreferenced') flag('unreferenced');
    else if (word === '--partial') flag('partial');
    else if (word === '--legacy') flag('legacy');
    else if (word === '--all') flag('all');
    else if (word === '--entry') { const value = words[++i]; if (value === undefined || value.startsWith('--')) usage(); selectors.entries.push(value!); }
    else rest.push(word);
  }
  return { selectors, rest };
}

/** `cache list` and `cache prune`. Returns 0 done or nothing to prune, 3 approval required, 130 stopped. A refusal throws. */
export async function runCacheCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const stateRoot = privateStateRoot(env, home);
  if (args[1] === 'list') {
    const rest = args.slice(2);
    if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--json')) usage();
    const list = await listCache({ stateRoot, ...projectOf(cwd, home), home, env });
    write(rest.length ? orderedJson(list) : renderCacheList(list));
    return 0;
  }
  if (args[1] !== 'prune') usage();
  const { selectors, rest } = parseSelectors(args.slice(2));
  const flags = parseApprovalFlags(rest);
  if (flags.rest.length) usage();
  const controller = new AbortController();
  const input: CachePruneInput = { stateRoot, ...projectOf(cwd, home), home, env, selectors };
  const first = await planCachePrune(input);
  if (first.picked.length === 0) {
    const notes = [
      ...(first.unreadableSources.length ? [`Some references were not checked: ${sources(first.unreadableSources)}. --unreferenced picks nothing.`] : []),
      ...(first.skipped.length ? [`Skipped ${entries(first.skipped.length)} that another command is using.`] : []),
    ];
    write(flags.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : plainText(`${[...notes, 'Nothing to prune.'].join('\n')}\n`, true));
    return 0;
  }
  let pending: CachePrunePlan | null = first, approved: CachePrunePlan = first, result: CachePruneResult | null = null;
  const change: PlannedChange<CachePrunePlan> = {
    async plan() { const p = pending ?? await planCachePrune(input); pending = null; approved = p; return p; },
    revision: p => p.revision,
    review: renderCachePrune,
    async apply(revision: string) { result = await applyCachePrune(input, revision, controller.signal); return result; },
  };
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  try {
    const outcome = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
    write(outcome.output + (outcome.exitCode === 0 && result && !flags.json ? renderPruneResult(result, approved) : ''));
    return outcome.exitCode;
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name !== 'AbortError') throw error;
    const at = error as Partial<PruneInterrupt>;
    write(typeof at.deleted === 'number' ? `Stopped. Deleted ${at.deleted} of ${at.of} entries. Run bowerloom cache list to see what is left.\n` : 'Stopped before anything was deleted.\n');
    return 130;
  } finally { process.removeListener('SIGINT', stop); }
}
