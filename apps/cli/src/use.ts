/**
 * `bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--approve <revision>] [--json]` and
 * `bowerloom unuse skill|prompt|team <id> [--approve <revision>] [--json]` (spec 06, 3.5 and 3.7). They change
 * bowerloom.json, and bowerloom.lock.json when the plan writes it, through the approval wrapper, under the project lock.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { applyConfigChange, planConfigChange } from '../../../packages/project-sync/src/index.js';
import type { ConfigChangePlan, ConfigChangeResult } from '../../../packages/project-sync/src/index.js';
import { itemSurfaces } from '../../../packages/project-sync/src/plan.js';
import { promptSurfaces } from '../../../packages/project-sync/src/prompts.js';
import { entryRequest, lookupCache } from '../../../packages/project-sync/src/cache-index.js';
import { readStoreDefinitions } from '../../../packages/project-sync/src/resolve.js';
import { inspectStore } from '../../../packages/project-context/src/index.js';
import { lockItem, lockSourceLabel, parseLock } from '../../../packages/project-config/src/index.js';
import type { PinnedEntry } from '../../../packages/skill-manifest/src/schema.js';
import { runWithApproval, parseApprovalFlags } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { plainText } from './human.js';
import { fromWire } from '../../../packages/project-sync/src/wire.js';
import { syncError } from '../../../packages/project-sync/src/refusal.js';
import type { OldEngineId, WriterEngine } from '../../../packages/skill-manifest/src/engine.js';
import { terminalIo } from './manifest.js';
import { credentialsLines, githubTokenReader, maxRequestsFlag, TOKEN_TAIL } from './sync.js';
import type { Credentials } from '../../../packages/project-sync/src/store-git.js';
import { TOKEN_STALE_NOTE } from '../../../packages/project-sync/src/store-git.js';
/** Review F5 of PR 97: a plan that proves an authored item on api.github.com names the token in its STALE_APPROVAL. */
export const proofStaleNote = (plan: { network: { hosts: string[] } }): string | null => plan.network.hosts.includes('api.github.com') ? TOKEN_STALE_NOTE : null;

const USE_USAGE = 'Use bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--max-github-requests <n>], with optional --approve <revision> and --json.';
const UNUSE_USAGE = 'Use bowerloom unuse skill|prompt|team <id>, with optional --approve <revision> and --json.';
const KINDS = ['skill', 'prompt', 'team'] as const;
type Kind = typeof KINDS[number];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface UseArgs { op: 'use' | 'unuse'; kind: Kind; id: string; project: boolean; commit: string | null; maxGithubRequests?: number; approval: string[] }
export function parseUseArgs(args: readonly string[]): UseArgs {
  const op = args[0] as 'use' | 'unuse', usage = (): never => { throw new DefinitionError('USAGE', op === 'use' ? USE_USAGE : UNUSE_USAGE); };
  const kind = args[1] as Kind, id = args[2];
  if (!(KINDS as readonly string[]).includes(kind) || id === undefined || !ID.test(id) || id.length > 64) usage();
  let project = false, commit: string | null = null, max: number | undefined; const approval: string[] = [];
  const words = args.slice(3);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--approve') { approval.push(w); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (w === '--json') approval.push(w);
    else if (op === 'use' && w === '--project') { if (project) usage(); project = true; }
    else if (op === 'use' && w === '--commit') {
      const value = words[++i];
      if (commit !== null || value === undefined || !/^[a-f0-9]{40}$/.test(value)) throw new DefinitionError('USAGE', 'Use --commit once, with the 40 lower-case hex characters of a pushed commit of the store remote.');
      commit = value;
    // Round 2 of the reviews of PR 101, item 3: the request limit of apply and skills sync, once at most.
    } else if (op === 'use' && w === '--max-github-requests') { if (max !== undefined) usage(); max = maxRequestsFlag(words[++i], USE_USAGE); if (max === undefined) usage(); }
    else usage();
  }
  if (project && commit !== null) usage();
  return { op, kind, id: id!, project, commit, ...(max !== undefined ? { maxGithubRequests: max } : {}), approval };
}

/** The places a copy of the item has in this project, when a catalog marks one (3.7). A team has none. */
export function copyPlaces(project: ProjectContext, kind: Kind, id: string): string[] {
  if (kind === 'team') return [];
  const catalog = join(project.dir, '.bowerloom', 'managed', 'catalog', `${kind === 'prompt' ? 'prompt-' : ''}${id}.json`);
  if (!existsSync(catalog)) return [];
  let name = id, engines: WriterEngine[] = ['claude-code', 'codex'];
  // The catalog is a stored record of a managed copy: it names its engines the old way (`harnesses`, with `claude`).
  // A catalog that is not JSON gives the default places. A catalog that names an engine it cannot is refused, by file.
  const c = ((): { skill?: { name?: unknown } | null; harnesses?: unknown } | null => {
    try { return JSON.parse(readFileSync(catalog, 'utf8')) as { skill?: { name?: unknown } | null; harnesses?: unknown } | null; } catch (error) {
      if (error instanceof SyntaxError) return null;
      // Any other read error (EACCES, EISDIR) is a refusal that names the file, never an uncoded error.
      const errno = (error as { code?: unknown } | null)?.code;
      throw syncError('MANAGED_SKILL_REFUSED', `The catalog ${relative(project.dir, catalog)} cannot be read${typeof errno === 'string' && /^E[A-Z]{2,20}$/.test(errno) ? ` (${errno})` : ''}. Nothing was changed.`);
    }
  })();
  if (c !== null && typeof c === 'object') {
    if (typeof c.skill?.name === 'string') name = c.skill.name;
    if (Array.isArray(c.harnesses)) engines = fromWire(c.harnesses as OldEngineId[], `The catalog ${relative(project.dir, catalog)}`);
  }
  const surfaces = kind === 'skill' ? itemSurfaces(project.dir, id, name, engines) : promptSurfaces(project.dir, id, engines);
  return surfaces.filter(s => s.id !== 'catalog').map(s => relative(project.dir, s.path));
}
const list = (items: readonly string[]): string => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
/**
 * Spec 07, 3.5: with credentials, the Network: note of a proof gets the token tail and the Credentials: line before it.
 * `lock.ts` shows its notes the same way.
 */
export function tokenNotes(notes: readonly string[], credentials: Credentials | null | undefined): string[] {
  if (!credentials) return [...notes];
  return notes.flatMap(n => n.startsWith('Network: reads api.github.com, to check the pushed copy') ? [...credentialsLines(credentials), `${n} ${TOKEN_TAIL}`] : [n]);
}

/** The plan in plain words (3.5 and 3.7). `cache` is the cache line of a pinned store skill, computed before the review. */
export function renderConfigChange(plan: ConfigChangePlan, places: readonly string[], cache: string | null): string {
  const c = plan.change, lines: string[] = [];
  const lock = plan.lock ? parseLock(Buffer.from(plan.lock.text)) : null;
  if (c.op === 'use') {
    if (plan.created) lines.push(`Create bowerloom.json and list ${plan.listed} items this project defines now, with the source project.`);
    if (c.source === 'store') {
      const promoted = plan.direct.find(d => d.kind === c.kind && d.id === c.id);
      lines.push(`Use ${c.kind} ${c.id} from the store`);
      if (plan.detail) {
        lines.push(`  Source: ${plan.detail.source}`);
        if (plan.detail.teams !== null) lines.push(`  Teams: ${plan.detail.teams}`);
        if (cache !== null) lines.push(`  Cache: ${cache}`);
      }
      if (promoted) lines.push(`Picks ${c.kind} ${c.id} directly. It was picked through team ${promoted.via.join(', ')}.`);
    } else lines.push(`Use ${c.kind} ${c.id} from this project`);
    for (const a of plan.adds) lines.push(`bowerloom.json adds: ${a.kind} ${a.id} (${a.source})`);
    for (const d of plan.direct) lines.push(`bowerloom.json: ${d.kind} ${d.id} is now picked directly`);
    if (plan.lock && lock) {
      if (plan.lock.before === null) lines.push('bowerloom.lock.json: creates it');
      for (const pair of plan.lock.adds) { const [k, i] = pair.split(' ') as [Kind, string], item = lockItem(lock, k, i); lines.push(`bowerloom.lock.json: adds ${pair}${item ? ` (${lockSourceLabel(item)})` : ''}`); }
      for (const pair of plan.lock.removes) lines.push(`bowerloom.lock.json removes: ${pair}`);
    }
    lines.push(...tokenNotes(plan.notes, plan.network.credentials), `${changesLine(plan)} Then run bowerloom skills sync and bowerloom apply.`);
    return lines.join('\n');
  }
  lines.push(`Stop using ${c.kind} ${c.id}`);
  for (const r of plan.removes) lines.push(`bowerloom.json removes: ${r.kind} ${r.id} (${r.source})`);
  for (const pair of plan.lock?.removes ?? []) lines.push(`bowerloom.lock.json removes: ${pair}`);
  if (places.length) lines.push(`Copies stay in ${list(places)}. Bowerloom removes no copy. Delete them yourself if you want them gone.`);
  lines.push(changesLine(plan));
  return lines.join('\n');
}
/**
 * Track 11 of beta.3, item 4: the files the plan writes, and no other. A plan writes the lock only in a shared project
 * whose config has a store entry, or when a lock exists (spec 06, 3.9 and 3.13).
 */
export const changesLine = (plan: Pick<ConfigChangePlan, 'lock'>): string => `This changes ${plan.lock ? 'bowerloom.json and bowerloom.lock.json' : 'bowerloom.json'} only.`;
/** The result in plain words. */
export function resultWords(result: ConfigChangeResult): string {
  const c = result.change;
  return plainText([c.op === 'use' ? `Picked ${c.kind} ${c.id}.` : `Stopped using ${c.kind} ${c.id}.`, ...(result.created ? ['Created bowerloom.json.'] : []), ...(result.lockSha256 !== null ? ['Updated bowerloom.lock.json.'] : []), ''].join('\n'), true);
}

/** The cache line of a pinned store skill: held on this machine, or not held yet. Null for anything else. */
async function cacheLine(plan: ConfigChangePlan, home: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (plan.change.kind !== 'skill' || plan.change.source !== 'store' || plan.detail?.cache !== 'pinned') return null;
  try {
    const found = inspectStore(home); if (found.state !== 'store') return null;
    const got = readStoreDefinitions(found.context).skills.get(plan.change.id); if (!got || got.source.kind === 'local') return null; const entry = got as PinnedEntry;
    const lookup = await lookupCache({ cacheRoot: join(privateStateRoot(env, home), 'cache'), legacyCacheRoot: null }, entryRequest(entry));
    return lookup.status === 'cached' ? 'held on this machine' : `not held yet (skills sync fetches it from ${entry.source.kind === 'npm' ? 'registry.npmjs.org' : 'api.github.com'})`;
  } catch { return null; }
}

/** `use` and `unuse`. Returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runUseCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const parsed = parseUseArgs(args), approval = parseApprovalFlags(parsed.approval);
  if (approval.rest.length) throw new DefinitionError('USAGE', parsed.op === 'use' ? USE_USAGE : UNUSE_USAGE);
  let project = discoverProject(cwd, home);
  const controller = new AbortController(), plans = new Map<string, { plan: ConfigChangePlan; cache: string | null; places: string[] }>();
  // Spec 07: the planner reads the token through this reader only for the proof of an authored store item.
  const githubToken = githubTokenReader(env);
  let result: ConfigChangeResult | null = null;
  const change: PlannedChange<ConfigChangePlan> = {
    async plan() {
      const plan = await planConfigChange({ project, home, op: parsed.op, kind: parsed.kind, id: parsed.id, source: parsed.project ? 'project' : 'store', commit: parsed.commit, signal: controller.signal, githubToken, ...(parsed.maxGithubRequests !== undefined ? { maxGithubRequests: parsed.maxGithubRequests } : {}) });
      plans.set(plan.revision, { plan, cache: await cacheLine(plan, home, env), places: parsed.op === 'unuse' ? copyPlaces(project, parsed.kind, parsed.id) : [] });
      return plan;
    },
    revision: plan => plan.revision,
    review: plan => { const p = plans.get(plan.revision); return renderConfigChange(plan, p?.places ?? [], p?.cache ?? null); }, staleNote: proofStaleNote,
    async apply(revision: string) {
      const p = plans.get(revision); if (!p) throw new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
      const done = await withProjectLock(project.dir, controller.signal, async held => applyConfigChange(p.plan, revision, held, project, home));
      project = done.project; result = done.result; return done.result;
    },
  };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && result && !approval.json ? resultWords(result) : ''));
  return outcome.exitCode;
}
