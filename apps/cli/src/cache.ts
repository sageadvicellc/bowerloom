/**
 * `bowerloom cache list [--json]` and `bowerloom cache prune <selectors> [--approve <revision>] [--json]` (spec 09). The
 * library is packages/project-sync/src/cache-admin.ts. List reads only. Prune shows a plan first and deletes only what
 * an approval names, under the cache lock. Nothing is deleted by itself.
 */
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { ProjectContext, PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyCachePrune, cacheUsage, listCache, planCachePrune, CACHE_LIST_LIMIT, CACHE_USAGE } from '../../../packages/project-sync/src/index.js';
import type { CacheEntry, CacheList, CachePruneInput, CachePrunePlan, CachePruneResult, CachePruneSelectors, PartialReason, PickedEntry, PruneInterrupt, Unreadable } from '../../../packages/project-sync/src/index.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, orderedJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

const usage = (): never => { throw cacheUsage(CACHE_USAGE); };
const IN_USE = '(another command is using it)', OLD_LOCK = '(its owner lock is older than a day)';
/** How many unlisted names the text shows. `cache list --json` holds up to 256. */
const UNLISTED_SHOWN = 8;

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
const sized = (files: number | null, bytes: number | null): string => files !== null && bytes !== null ? `  (${files} files, ${humanBytes(bytes)})` : '  (size unknown)';
/** Review L3 of PR 99: what an entry holds, or why it is partial. */
function what(e: { label: string | null; status: string; partialReason: PartialReason | null }): string {
  if (e.status === 'completed') return e.label ?? 'unknown entry';
  switch (e.partialReason) {
    case 'changed': return `${e.label ?? 'store item'}, changed since it was written`;
    case 'unreadable': return 'unreadable entry';
    case 'prune-leftover': return 'left by a stopped prune';
    case 'write-leftover': return 'left by a stopped write';
    default: return 'unfinished fetch';
  }
}
const NEXT: Readonly<Record<string, string>> = { store: 'bowerloom store status', project: 'bowerloom status' };
/** Review M1 of PR 99: each unread source with its code and item, and the next step. */
function notChecked(unreadable: readonly Unreadable[], unreferenced: boolean): string {
  const why = unreadable.map(u => `${u.source} (${u.code}${u.item ? `, ${u.item}` : ''})`).join(' and ');
  const next = [...new Set(unreadable.map(u => NEXT[u.source]!))].join(' and ');
  return `Some references were not checked: ${why}.${unreferenced ? ' --unreferenced picks nothing.' : ''} Next: ${next}`;
}
const unknownCount = (items: readonly { bytes: number | null }[]): number => items.filter(i => i.bytes === null).length;

function listLine(e: CacheEntry): string {
  const head = e.scope === 'project-legacy' ? `${e.projectId!.slice(0, 8)}/${id8(e)}` : id8(e);
  const note = e.active ? `  ${e.stale ? OLD_LOCK : IN_USE}` : '';
  return `  ${head}  ${e.status.padEnd(9)}  ${what(e)}${e.status === 'completed' ? sized(e.files, e.bytes) : sized(null, null)}${e.scope === 'project-legacy' ? '' : tags(e.references)}${note}`;
}
/** An entry line, and a Next line for a leftover that cannot be deleted as it is (round 3, M-A). */
const listLines = (e: CacheEntry): string[] => [listLine(e), ...(e.next ? [`    Next: ${e.next}`] : [])];
/** `cache list` in words (3.3, with review M3 and L1 of PR 99). */
export function renderCacheList(list: CacheList): string {
  if (list.entries.length === 0 && list.unlisted === 0) return 'The cache is empty.\n';
  const lines: string[] = [];
  const of = (scope: CacheEntry['scope']) => list.entries.filter(e => e.scope === scope);
  const machine = of('machine'), store = of('store'), legacy = of('project-legacy');
  if (machine.length) lines.push(`Skills cache: ${join(list.stateRoot, 'cache')}`, ...machine.flatMap(listLines));
  if (store.length) lines.push(`Store cache: ${join(list.stateRoot, 'store-cache')}`, ...store.flatMap(listLines));
  if (legacy.length) lines.push(`Earlier per-project caches: ${legacy.length} entries in ${new Set(legacy.map(e => e.projectId)).size} projects`, ...legacy.flatMap(listLines));
  if (list.entries.length === 0) lines.push('The cache holds no entries.');
  else {
    const unknown = unknownCount(list.entries), n = list.totals.entries;
    lines.push(`Total: ${n} entries, ${unknown === 0 ? humanBytes(list.totals.bytes) : unknown === n ? 'size unknown' : `${humanBytes(list.totals.bytes)} and ${unknown} of unknown size`}`);
  }
  if (list.unlisted > 0) {
    lines.push(`Not listed: ${list.unlisted} names that cache prune never deletes.`);
    for (const u of list.unlistedNames.slice(0, UNLISTED_SHOWN)) lines.push(`  ${u.place === 'legacy' ? `legacy ${u.name}` : `${u.place}/${u.name}`}: ${u.reason}${u.next ? `. Next: ${u.next}` : ''}`);
    if (list.unlisted > UNLISTED_SHOWN) lines.push(`  and ${list.unlisted - UNLISTED_SHOWN} more. bowerloom cache list --json lists up to 256 of them.`);
  }
  if (list.truncated) lines.push(`More entries exist. Only the first ${CACHE_LIST_LIMIT} are shown.`);
  if (list.unreadable.length) lines.push(notChecked(list.unreadable, false));
  return plainText(`${lines.join('\n')}\n`, true);
}

const place = (p: { scope: string; projectId: string | null }): string => p.scope === 'machine' ? 'cache' : p.scope === 'store' ? 'store-cache' : `legacy ${p.projectId!.slice(0, 8)}`;
function deleteLine(p: PickedEntry): string {
  const body = p.status === 'completed' ? `${what(p)}${sized(p.files, p.bytes)}` : what(p);
  return `  delete  ${body}  ${place(p)} ${id8(p)}${tags(p.references)}${p.stale ? `  ${OLD_LOCK}` : ''}`;
}
/** Round 3, L-b: the names a prune never touches. */
const unlistedLine = (n: number): string => `${n} names are not listed and are never pruned. bowerloom cache list shows why.`;
/** The notes that every prune path prints when they apply (review M3 and L4 of PR 99). */
function pruneNotes(plan: CachePrunePlan): string[] {
  return [
    ...(plan.selectors.unreferenced && plan.unreadable.length ? [notChecked(plan.unreadable, true)] : []),
    ...(plan.truncated ? [`More entries exist. Only the first ${CACHE_LIST_LIMIT} are listed. Run the command again after this one.`] : []),
    ...(plan.unlisted ? [unlistedLine(plan.unlisted)] : []),
  ];
}
/** The prune plan in words (3.4). */
export function renderCachePrune(plan: CachePrunePlan): string {
  const lines = ['Prune the skills cache', ...plan.picked.map(deleteLine)];
  for (const s of plan.skipped) lines.push(`  skip    ${s.label ?? 'unfinished fetch'}  ${place(s)} ${s.id.slice(0, 8)}  ${IN_USE}`);
  lines.push(...pruneNotes(plan));
  const unknown = unknownCount(plan.picked);
  lines.push(unknown === 0 ? `Frees about ${humanBytes(plan.freed)}.` : unknown === plan.picked.length ? `Frees an unknown amount: ${unknown} entries of unknown size.` : `Frees about ${humanBytes(plan.freed)}, plus ${unknown} entries of unknown size.`);
  if (plan.picked.some(p => p.references.store === true || p.references.project === true)) lines.push('When a command needs an entry that this project or your store still lists, Bowerloom fetches it again.');
  // Review L9 of PR 99.
  if (plan.picked.some(p => p.scope === 'store')) lines.push('Store cache entries come from your store remote. Fetching one again needs the network, and a private store needs BOWERLOOM_GITHUB_TOKEN.');
  lines.push('Other projects on this machine are not checked.', 'This deletes cached skill bytes only. It deletes no project file and no installed copy.');
  return lines.join('\n');
}
/** What a prune prints when it picks nothing (3.4, with review M3 of PR 99). */
export function renderNothingToPrune(plan: CachePrunePlan): string {
  const lines = [...pruneNotes(plan), ...(plan.skipped.length ? [`Skipped ${plan.skipped.length} entries that another command is using.`] : []), 'Nothing to prune.'];
  return plainText(`${lines.join('\n')}\n`, true);
}
/** The words of a finished prune (3.4). */
export function renderPruneResult(result: CachePruneResult, plan: CachePrunePlan): string {
  const unknown = unknownCount(plan.picked), n = result.deleted.length;
  const size = unknown === 0 ? `, about ${humanBytes(plan.freed)}` : unknown === plan.picked.length ? ' of unknown size' : `, about ${humanBytes(plan.freed)}, plus ${unknown} of unknown size`;
  return `Deleted ${n} entries${size}.\n${result.skipped.length ? `Skipped ${result.skipped.length} entries that another command is using.\n` : ''}${plan.unlisted ? `${unlistedLine(plan.unlisted)}\n` : ''}`;
}
/** Review H1 of PR 99: the words of a prune that Ctrl-C stopped between two deletes. */
export function renderStopped(at: { deleted: number; of: number; stoppedAt: string; leftover?: string | null }): string {
  const inside = at.leftover ? ` Its folder ${at.leftover} is partly deleted, and bowerloom cache prune --partial finishes it.` : '';
  return plainText(`Stopped. Deleted ${at.deleted} of ${at.of} entries. It stopped at ${at.stoppedAt}.${inside} Run bowerloom cache list to see what is left.\n`, true);
}

/** Decision E (tech lead): these discovery refusals mean that the folder is no project, not that the project is unknown. */
const NO_PROJECT = new Set(['PROJECT_NOT_FOUND', 'STORE_NOT_A_PROJECT', 'PROJECT_ROOT_REFUSED']);
/** The project of the current folder: null outside one, and the code of any other discovery refusal (3.2). */
function projectOf(cwd: string, home: string): { project: ProjectContext | null; projectError: string | null } {
  try { return { project: discoverProject(cwd, home), projectError: null }; }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && NO_PROJECT.has(code)) return { project: null, projectError: null };
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
    write(flags.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : renderNothingToPrune(first));
    return 0;
  }
  let pending: CachePrunePlan | null = first, approved: CachePrunePlan = first, result: CachePruneResult | null = null;
  const change: PlannedChange<CachePrunePlan> = {
    async plan() { const p = pending ?? await planCachePrune(input); pending = null; approved = p; return p; },
    revision: p => p.revision,
    review: renderCachePrune,
    async apply(revision: string) { result = await applyCachePrune(input, revision, controller.signal); return result; },
  };
  // Ctrl-C stops the prune between two deletes; apply yields before each one, so this listener runs (review H1).
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  try {
    const outcome = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
    write(outcome.output + (outcome.exitCode === 0 && result && !flags.json ? renderPruneResult(result, approved) : ''));
    return outcome.exitCode;
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name !== 'AbortError') throw error;
    const at = error as Partial<PruneInterrupt>;
    const stopped = typeof at.deleted === 'number' ? { deleted: at.deleted, of: at.of!, stoppedAt: at.stoppedAt!, leftover: at.leftover ?? null } : { deleted: 0, of: approved.picked.length, stoppedAt: null, leftover: null };
    // Review L7 of PR 99: exit 130 keeps --json.
    write(flags.json ? newCommandJson({ stopped: true, ...stopped }) : stopped.stoppedAt === null ? 'Stopped before anything was deleted.\n' : renderStopped(stopped as { deleted: number; of: number; stoppedAt: string }));
    return 130;
  } finally { process.removeListener('SIGINT', stop); }
}
