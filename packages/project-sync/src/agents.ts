/**
 * Team agents in `bowerloom apply` (spec 01a). An agent is a Claude Code subagent file kept at
 * `.bowerloom/teams/<team>/agents/<role>.md`. Apply installs it as a managed v1beta2 item of kind `agent`: one copy,
 * `.claude/agents/<role>.md`, and a catalog record `agent_<role>.json`. Its private folder is named `agent_<role>`.
 *
 * Planning reads only. A bad agent file holds that one agent; the rest of the plan still applies. Only a problem that
 * is not about one agent refuses the plan: an unsafe agents folder, more than 128 agents, or an unsafe `.claude`.
 * Apply never removes a copy and never overwrites one it did not install. A hand-made copy that equals the Bowerloom
 * copy is adopted: the install check lets that one file through, and the transaction keeps the original as its backup
 * until the operation commits.
 */
import { lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { LIMITS, OP_TEMP, directory, exists, names, stablePins } from '../../managed-skills/src/observed.js';
import { readLocalAgent } from '../../managed-skills/src/local-source.js';
import { claudeCopyBytes } from '../../managed-skills/src/agent-copy.js';
import { catalogPath, currentV2, locateV2, ownSurface, surfaceV2 } from '../../managed-skills/src/v2-observed.js';
import type { InventoryRow, ItemClosure, ItemRef, LocalClosure, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { AGENT_STEM, AGENT_STEM_MAX, parseAgent } from '../../project-authoring/src/agent-file.js';
import type { AgentParseCode, ParsedAgent } from '../../project-authoring/src/agent-file.js';
import { folderNames, lstatOrNull, realFolder } from '../../project-authoring/src/files.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import type { ItemSurface, SyncItem } from './plan.js';
import { MIN_FREE_BYTES, beforePins, driftNext, driftedPaths, historyNext, readCatalog, recoverNext, strayHold } from './plan.js';
import { managedCode, syncError } from './refusal.js';

export { claudeCopyBytes };

/** The built-in Claude Code subagents (code.claude.com/docs/en/sub-agents, verified 2026-10-22). */
export const BUILTIN_AGENT_NAMES: readonly string[] = Object.freeze(['Explore', 'Plan', 'general-purpose', 'statusline-setup', 'claude-code-guide', 'claude']);
const BUILTIN_FOLDED = new Set(BUILTIN_AGENT_NAMES.map(n => n.toLowerCase()));
export const AGENT_LIMIT = 128;
const SHELL_TOOLS = ['Bash', 'PowerShell', 'Monitor'];

export type AgentState = 'new' | 'adopt' | 'edited' | 'up-to-date' | 'drift' | 'orphaned' | 'held';
/** What a Claude Code subagent can do beyond text, in the order of the notice line. The review names them; it never quotes the file. */
export type AgentNotice = 'hooks' | 'mcpServers' | 'permissionMode:acceptEdits' | 'permissionMode:auto'
  | 'permissionMode:dontAsk' | 'permissionMode:bypassPermissions' | 'permissionMode:manual'
  | 'shell-tools' | 'all-tools';
export interface AgentItem {
  /** The role, or the entry name of an invalid entry. */
  id: string;
  /** The team folder that holds the source; null for an orphan. */
  team: string | null;
  /** `agent_<id>`: the name of its private folder and its catalog. */
  itemId: string;
  state: AgentState;
  action: 'install' | 'update' | 'none' | 'hold';
  harnesses: ['claude'];
  expected: { files: InventoryRow[]; surfaces: ItemSurface[]; source: { kind: 'agent'; path: string } | null };
  before: SyncItem['before'];
  previousReceiptRevision: string | null;
  history: number;
  hold: { code: string; next: string } | null;
  notices: AgentNotice[];
  builtin: boolean;
  /** Reserved for spec 01b. */
  capabilities: null;
  enforcement: [];
}

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const fold = (name: string): string => name.normalize('NFC').toLowerCase();
const sourceOf = (team: string, entry: string): string => `.bowerloom/teams/${team}/agents/${entry}`;
type Hold = { code: string; next: string };

/** The notices of one agent file, in the order of the notice line. */
export function agentNotices(agent: ParsedAgent): AgentNotice[] {
  const out: AgentNotice[] = [];
  if (agent.keys.includes('hooks')) out.push('hooks');
  if (agent.keys.includes('mcpServers')) out.push('mcpServers');
  if (agent.permissionMode !== null && agent.permissionMode !== 'default' && agent.permissionMode !== 'plan') out.push(`permissionMode:${agent.permissionMode}` as AgentNotice);
  if (agent.tools === null) out.push('all-tools');
  else if (agent.tools.some(entry => SHELL_TOOLS.includes(entry.split('(')[0]!))) out.push('shell-tools');
  return out;
}
export const isBuiltinAgentName = (role: string): boolean => BUILTIN_FOLDED.has(role.toLowerCase());

/** One entry of an `agents/` folder, validated. A valid entry has a closure and a parsed file; any other has a hold. */
export interface ScannedAgent {
  team: string; entry: string; role: string;
  closure: LocalClosure | null; parsed: ParsedAgent | null; hold: Hold | null;
}
export interface AgentScan { entries: ScannedAgent[]; fileCount: number }

function registeredTeams(dir: string): string[] {
  const state = readAuthoringState(join(dir, '.bowerloom'));
  return (state.receipt?.value.items ?? []).filter(i => i.kind === 'team').map(i => i.id);
}
const validStem = (entry: string): string | null => {
  if (!entry.endsWith('.md') || entry.startsWith('.')) return null;
  const stem = entry.slice(0, -3);
  return stem.length >= 1 && stem.length <= AGENT_STEM_MAX && AGENT_STEM.test(stem) && !stem.startsWith('prompt-') ? stem : null;
};
const invalidHold = (path: string, detail: string): Hold => ({ code: 'AGENT_INVALID', next: `Fix ${path}: ${detail}. Then run bowerloom apply.` });
const joinPaths = (paths: string[]): string => paths.length === 2 ? `${paths[0]} and ${paths[1]}` : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`;
function parseHold(code: AgentParseCode, detail: string, stem: string, path: string): Hold {
  if (code === 'AGENT_KEY_UNKNOWN') return { code, next: `Remove ${/^[A-Za-z0-9_.-]{1,64}$/.test(detail) ? `the key ${detail}` : 'a key with unsupported characters'} from ${path}, then run bowerloom apply.` };
  if (code === 'AGENT_NAME_MISMATCH') return { code, next: `Make the name key equal ${stem} in ${path}, and name the file with lowercase letters, digits, and single hyphens. Then run bowerloom apply.` };
  return invalidHold(path, detail);
}

/**
 * Lists and checks every agent file of every team folder, whatever `--harness` and `--team` say (spec section 3.6).
 * Refuses the whole plan for an unsafe folder (AUTHORING_UNSAFE_PATH) and for more than 128 entries (AGENT_LIMIT).
 * Everything else is a hold on one entry. Reads only.
 */
export function scanAgents(dir: string): AgentScan {
  const bowerloom = join(dir, '.bowerloom'), teamsDir = join(bowerloom, 'teams');
  if (lstatOrNull(teamsDir) === null) return { entries: [], fileCount: 0 };
  realFolder(teamsDir);
  const ids = new Set(registeredTeams(dir));
  if (lstatOrNull(join(teamsDir, 'first-team')) !== null) ids.add('first-team');
  const listing: { team: string; entry: string }[] = [];
  for (const team of [...ids].sort(cmp)) {
    const teamDir = join(teamsDir, team);
    if (lstatOrNull(teamDir) === null) continue;
    realFolder(teamDir);
    const agents = join(teamDir, 'agents');
    if (lstatOrNull(agents) === null) continue;
    for (const entry of folderNames(agents)) listing.push({ team, entry });
  }
  if (listing.length > AGENT_LIMIT) throw syncError('AGENT_LIMIT');
  const groups = new Map<string, { team: string; entry: string }[]>();
  for (const l of listing) { const stem = validStem(l.entry); if (stem !== null) groups.set(stem, [...(groups.get(stem) ?? []), l]); }
  const entries: ScannedAgent[] = [];
  for (const { team, entry } of listing) {
    const path = sourceOf(team, entry), stem = validStem(entry), role = entry.endsWith('.md') ? entry.slice(0, -3) : entry;
    const out: ScannedAgent = { team, entry, role, closure: null, parsed: null, hold: null };
    entries.push(out);
    const twins = stem === null ? [] : groups.get(stem)!;
    if (twins.length > 1) {
      out.hold = { code: 'APPLY_AGENT_DUPLICATE', next: `${joinPaths(twins.map(t => sourceOf(t.team, t.entry)))} both define ${stem}. Rename or remove one, then run bowerloom apply.` };
      continue;
    }
    let isFile = false; try { const s = lstatSync(join(bowerloom, 'teams', team, 'agents', entry)); isFile = s.isFile() && !s.isSymbolicLink(); } catch { isFile = false; }
    if (entry.startsWith('.') || !entry.endsWith('.md') || !isFile) { out.hold = invalidHold(path, `only plain files named <role>.md are agents`); continue; }
    if (stem === null) { out.hold = { code: 'AGENT_NAME_MISMATCH', next: `Make the name key equal ${role} in ${path}, and name the file with lowercase letters, digits, and single hyphens. Then run bowerloom apply.` }; continue; }
    let closure: LocalClosure;
    try { closure = readLocalAgent(dir, team, stem, () => {}); } catch { out.hold = invalidHold(path, 'the file cannot be read as a plain text file that you own, with one link, no write access for others, and at most 64 KiB'); continue; }
    const parsed = parseAgent(closure.files[0]!.text, stem, team);
    if (!parsed.ok) { out.hold = parseHold(parsed.code, parsed.detail, stem, path); continue; }
    out.closure = closure; out.parsed = parsed.agent;
  }
  entries.sort((a, b) => cmp(a.role, b.role) || cmp(a.team, b.team));
  return { entries, fileCount: listing.length };
}

/**
 * `.claude` and `.claude/agents`, when they exist, must be real folders that the group and others cannot write.
 * Refuses the whole plan before any write (APPLY_AGENTS_FOLDER_UNSAFE).
 */
export function checkClaudeFolders(dir: string): void {
  for (const rel of ['.claude', '.claude/agents']) {
    let s; try { s = lstatSync(join(dir, rel)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw syncError('APPLY_AGENTS_FOLDER_UNSAFE'); }
    if (s.isSymbolicLink() || !s.isDirectory() || (s.mode & 0o022) !== 0) throw syncError('APPLY_AGENTS_FOLDER_UNSAFE');
  }
}

/** The item surfaces of an agent, as the managed planner places them. */
export function agentSurfaces(project: string, id: string): { id: ItemSurface['id']; kind: 'directory' | 'file'; path: string }[] {
  const req = { projectDir: project, item: { kind: 'agent', id }, harnesses: ['claude'] } as unknown as ManagedItemRequest;
  return locateV2(req, { name: id } as ItemClosure, { ignore: false, legacy: false }).filter(ownSurface);
}

const heldItem = (s: ScannedAgent): AgentItem => ({
  id: s.role, team: s.team, itemId: 'agent_' + s.role, state: 'held', action: 'hold', harnesses: ['claude'],
  expected: { files: [], surfaces: [], source: null }, before: [], previousReceiptRevision: null, history: 0, hold: s.hold, notices: [],
  builtin: false, capabilities: null, enforcement: [],
});

/**
 * Looks at `.claude/agents` for the place of a new agent (spec section 3.3). Returns `adopt` for one equal hand-made copy,
 * a hold for anything else that is there, and null for an empty place.
 */
function targetState(project: string, s: ScannedAgent): 'adopt' | Hold | null {
  const role = s.role, file = `.claude/agents/${role}.md`, folder = join(project, '.claude/agents'), source = sourceOf(s.team, s.entry);
  if (!exists(folder)) return null;
  let listing: string[]; try { listing = readdirSync(folder); } catch { return { code: 'AGENT_TARGET_OCCUPIED', next: `${file} was not installed by Bowerloom and cannot be read as a plain file that you own. Move it aside, then run bowerloom apply.` }; }
  const want = fold(role + '.md'), same = listing.filter(n => fold(n) === want), alias = same.find(n => n !== role + '.md');
  if (alias !== undefined) return { code: 'AGENT_TARGET_OCCUPIED', next: `.claude/agents/${alias} was not installed by Bowerloom and is the same file as ${file} on a disk that ignores case. Move it aside, then run bowerloom apply.` };
  if (same.length === 0) return null;
  try {
    const pins = surfaceV2('agent-claude', 'file', join(project, file)).pins;
    if (pins !== null && pins.length === 1 && pins[0]!.sha256 === s.closure!.files[0]!.sha256) return 'adopt';
  } catch { return { code: 'AGENT_TARGET_OCCUPIED', next: `${file} was not installed by Bowerloom and cannot be read as a plain file that you own. Move it aside, then run bowerloom apply.` }; }
  return { code: 'AGENT_TARGET_OCCUPIED', next: `${file} was not installed by Bowerloom and differs from ${source}. Move it aside, then run bowerloom apply.` };
}

/** Classifies one scanned agent. Reads only. A held entry comes back as a held item. */
export function classifyAgent(project: string, itemsRoot: string, s: ScannedAgent): AgentItem {
  if (s.hold !== null || s.closure === null || s.parsed === null) return heldItem(s);
  const role = s.role, ref: ItemRef = { kind: 'agent', id: role }, itemId = 'agent_' + role, stateDir = join(itemsRoot, itemId), source = sourceOf(s.team, s.entry);
  const files = [...s.closure.inventory], sourcePath = `teams/${s.team}/agents/${s.entry}`;
  let hold: Hold | null = null, heldCode: string | null = null, state: AgentState = 'held', action: AgentItem['action'] = 'hold', previous: ManagedItemReceipt | null = null, ops: string[] = [];
  const occupiedCatalog: Hold = { code: 'MANAGED_SKILL_PATH_OCCUPIED', next: `Move .bowerloom/managed/catalog/${itemId}.json aside, then run bowerloom apply.` };
  if (exists(stateDir)) {
    try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
    const all = names(stateDir).filter(n => !OP_TEMP.test(n)); ops = all.filter(n => /^op-[a-f0-9]{64}$/.test(n));
    const stray = all.filter(n => !ops.includes(n));
    if (stray.length) hold = strayHold(itemId, stray, 'bowerloom apply');
    else if (ops.some(n => !exists(join(stateDir, n, 'receipt.json')))) hold = { code: 'MANAGED_SKILL_RECOVERY_REQUIRED', next: recoverNext(itemId) };
  }
  const catalog = catalogPath(project, ref);
  if (!exists(catalog)) { state = 'new'; action = 'install'; }
  else if (!exists(stateDir)) hold = hold ?? occupiedCatalog;
  else {
    try { previous = currentV2(project, stateDir, ref); } catch (e) { previous = null; heldCode = managedCode(e); }
    if (heldCode === 'MANAGED_SKILL_PATH_OCCUPIED') { hold = hold ?? occupiedCatalog; heldCode = null; }
    if (previous !== null) {
      const view = readCatalog(catalog), was = view.source as { path?: unknown };
      if (!same(view.inventory, files) || was.path !== sourcePath) { state = 'edited'; action = 'update'; }
      else { state = 'up-to-date'; action = 'none'; }
    }
  }
  const surfaces = agentSurfaces(project, role), before = beforePins(surfaces, project);
  if (heldCode !== null && hold === null) {
    const changed = heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftedPaths(project, stateDir, ref.id) : [];
    hold = { code: heldCode, next: heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftNext(changed.length ? changed : before.map(b => b.path), source).replace('bowerloom skills sync', 'bowerloom apply').replace('Sync never', 'Apply never') : `Run bowerloom status to see what changed in the copies of agent ${role}.` };
    if (heldCode === 'MANAGED_SKILL_LOCAL_DRIFT') state = 'drift';
  }
  if (action === 'install' && hold === null) {
    const found = targetState(project, s);
    if (found === 'adopt') state = 'adopt';
    else if (found !== null) hold = found;
  }
  if ((action === 'install' || action === 'update') && hold === null && ops.length >= LIMITS.history) {
    hold = { code: 'MANAGED_SKILL_HISTORY_FULL', next: historyNext(itemId, previous ? `op-${previous.operationKey}` : 'the newest op-<key> folder', 'bowerloom apply') };
  }
  if (hold !== null) { action = 'hold'; if (state !== 'drift') state = 'held'; }
  return {
    id: role, team: s.team, itemId, state, action, harnesses: ['claude'],
    expected: { files, surfaces: surfaces.map(x => ({ id: x.id, path: relative(project, x.path) })), source: { kind: 'agent', path: sourcePath } }, before,
    previousReceiptRevision: previous?.revision ?? null, history: ops.length, hold, notices: agentNotices(s.parsed), builtin: isBuiltinAgentName(role),
    capabilities: null, enforcement: [],
  };
}

/** An agent whose catalog is here and whose source file is gone from every team. It is kept, never removed. */
export function orphanAgent(project: string, itemsRoot: string, id: string): AgentItem {
  let previous: ManagedItemReceipt | null = null;
  try { previous = currentV2(project, join(itemsRoot, 'agent_' + id), { kind: 'agent', id }); } catch { previous = null; }
  return {
    id, team: null, itemId: 'agent_' + id, state: 'orphaned', action: 'none', harnesses: ['claude'], expected: { files: [], surfaces: [], source: null }, before: [],
    previousReceiptRevision: previous?.revision ?? null, history: 0, hold: null, notices: [], builtin: false, capabilities: null, enforcement: [],
  };
}

/** The child request of one agent. Every field comes from the plan this run computed. */
export function agentRequest(project: string, itemsRoot: string, item: AgentItem): ManagedItemRequest {
  return {
    operation: item.action === 'install' ? 'install' : 'update', projectDir: project, stateDir: join(itemsRoot, item.itemId),
    item: { kind: 'agent', id: item.id }, harnesses: ['claude'], source: { kind: 'agent', team: item.team!, name: item.id },
    expectedPreviousRevision: item.previousReceiptRevision, minFreeBytes: MIN_FREE_BYTES, legacy: null,
  };
}

const rel = (dir: string, p: string): string => p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
/** Phase B check of one agent child against the parent plan's bindings. Anything that differs means a change since the approval. */
export function checkAgentChild(dir: string, item: AgentItem, req: ManagedItemRequest, child: ManagedItemPlan | UpToDateV2): ManagedItemPlan {
  if (child.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale(`Agent ${item.id} changed since the plan.`);
  const c = child as ManagedItemPlan, closure = c.core.closure;
  if (!same(c.core.request, req)) throw stale();
  if (!same(closure.inventory, item.expected.files) || !same(closure.source, { kind: 'agent', path: `teams/${item.team}/agents/${item.id}.md` }) || closure.skill !== null) throw stale(`Agent ${item.id} changed since the plan.`);
  const own = c.core.before.filter(ownSurface);
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path) })), item.expected.surfaces)) throw stale();
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path), stablePinsDigest: revisionOf(stablePins(s.pins)) })), item.before)) throw stale(`Agent ${item.id} changed since the plan.`);
  if ((c.core.previous?.revision ?? null) !== item.previousReceiptRevision) throw stale();
  return c;
}
