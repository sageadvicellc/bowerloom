import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot, projectRefusal } from '../../../packages/project-context/src/index.js';
import type { OwnerVerifier, ProjectContext } from '../../../packages/project-context/src/types.js';
import { inspectOwnedOnly, inspectStartup } from '../../../packages/startup/src/index.js';
import type { Drift, OwnedEntry } from '../../../packages/startup/src/index.js';
import { readConfig } from '../../../packages/project-config/src/index.js';
import { configAdditions, configLine, configObject } from './config-status.js';
import { resolveProject } from '../../../packages/project-sync/src/index.js';
import type { Resolved } from '../../../packages/project-sync/src/index.js';
import { isSharedProject, LOCK_FILE, readLock } from '../../../packages/project-config/src/index.js';
import { authoringVerifier, manifestVerifier } from '../../../packages/project-authoring/src/index.js';
import { managedVerifier } from '../../../packages/managed-skills/src/v2-verifier.js';
import { legacyPresent } from '../../../packages/managed-skills/src/migrate.js';
import { newCommandJson, plainText } from './human.js';
import { planProjectApply } from '../../../packages/project-sync/src/index.js';
import type { AgentItem } from '../../../packages/project-sync/src/index.js';
import { noticeWords, sliceNoteLines } from './apply.js';
import type { SliceItem } from '../../../packages/project-sync/src/index.js';
import { editedPrompts, missingItems, planHolds, uniqueHolds } from './held.js';
import type { HeldItem } from './held.js';

/**
 * The registered owners of paths inside `.bowerloom/` (build plan 01, section 2): authoring, the skills.json manifest,
 * and managed skills, whose receipts sit under the project's private state folder. When that folder's path is not
 * one managed skills accepts, the managed owner is left out, so `managed/` shows as unexpected rather than trusted.
 */
export function projectOwners(project: ProjectContext, env: NodeJS.ProcessEnv, home: string): OwnerVerifier[] {
  const owners = [authoringVerifier(project.dir), manifestVerifier(project.dir)];
  try { owners.push(managedVerifier(project.dir, join(privateStateRoot(env, home), project.projectId, 'items'))); } catch { /* Left out: see above. */ }
  return owners;
}

/** Refusals of the apply plan that `status` leaves to its drift lines: a legacy install, an unfinished operation, a pending revise, and an uncached pin. */
const EXPECTED_PLAN_REFUSALS = ['MANAGED_SKILL_LEGACY_PRESENT', 'MANAGED_SKILL_RECOVERY_REQUIRED', 'REVISION_PENDING', 'SKILLS_OFFLINE'];
/** What an installed copy says, in the words of the status line. A copy that is gone or does not parse is named, with the grant keys a loose scan finds. */
function installedWords(copy: NonNullable<AgentItem['installed']>): string {
  if (copy.copy === 'missing') return 'copy missing';
  if (copy.copy === 'unparsed') return `notices unknown, the copy does not parse${copy.loose.length ? `; it names ${copy.loose.join(', ')}` : ''}`;
  return copy.notices.length ? copy.notices.map(noticeWords).join(', ') : 'no notices';
}
/** True when `.bowerloom/installation-receipt.json` is not there. Any other lstat result counts as present, so the startup inspection reports it. */
function receiptMissing(project: ProjectContext): boolean {
  try { lstatSync(join(project.dir, '.bowerloom', 'installation-receipt.json')); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
  // A folder that holds other startup files lost its receipt; that is drift, not an authored-only project.
  for (const evidence of ['brief.json', 'START-HERE.md', join('teams', 'first-team')]) {
    try { lstatSync(join(project.dir, '.bowerloom', evidence)); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
  }
  return true;
}

/** `bowerloom status [--json]` for the project that holds the working folder. Reads only. Returns the text to print; the words escape control characters, the JSON is exact. */
/** The status lines of installed slices: an out-of-date index, and the count of notes with the command that lists them. */
function sliceLines(slices: readonly SliceItem[], project: string): string[] {
  return slices.filter(s => s.installed).flatMap(s => [
    ...(s.action === 'update' ? [`  slice ${plainText(s.id)}: index out of date (${s.changes.added} added, ${s.changes.gone} gone, ${s.changes.summaries} summaries changed). Next: bowerloom apply`] : []),
    ...(sliceNoteLines(s, project).length > 0 ? [`slice ${plainText(s.id)}: ${sliceNoteLines(s, project).length} notes, run bowerloom context show ${plainText(s.id)}`] : []),
  ]);
}
export async function runProjectStatus(args: readonly string[], cwd: string, home: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const words = args.slice(1);
  if (words.some(w => w !== '--json') || words.length > 1) throw new DefinitionError('USAGE', 'Use bowerloom status [--json]. For a prepared session, use bowerloom status --installation <private.json>.');
  const project = discoverProject(cwd, home);
  const config = readConfig(project);
  if (config.state === 'absent' && project.configPresent) throw projectRefusal('PROJECT_UNSAFE');
  const owners = projectOwners(project, env, home);
  // A project with no .bowerloom folder, or one with an authored .bowerloom and a config but no startup receipt, has no
  // startup setup. Every other project is inspected as before.
  let setup: 'startup' | 'none' = 'startup', drift: Drift[] = [], owned: OwnedEntry[] = [], revision: string | null = null, specReady = false;
  let status: 'ready' | 'drifted' | 'revision-pending';
  if (project.bowerloomIdentity === null) {
    setup = 'none'; status = 'ready';
  } else if (project.configPresent && receiptMissing(project)) {
    setup = 'none'; ({ drift, owned } = await inspectOwnedOnly(project.dir, owners)); status = drift.length ? 'drifted' : 'ready';
  } else {
    const inspection = await inspectStartup(project.dir, { owners });
    status = inspection.status === 'ready-for-review' ? 'ready' : inspection.status;
    drift = inspection.drift; owned = inspection.owned ?? []; revision = inspection.revision; specReady = inspection.specReady;
  }
  if (config.state === 'invalid') { drift = [...drift, { path: 'bowerloom.json', kind: 'config-invalid', code: config.code }]; if (status === 'ready') status = 'drifted'; }
  // Spec 06, 3.20 and 4.6: the store and the lock of a config project. A lock with no config is drift when .bowerloom exists.
  let resolved: Resolved | null = null, lockError: string | null = null;
  if (config.state === 'valid') {
    try { resolved = resolveProject({ project, home, frozen: false, tolerateStore: true }); }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && code.startsWith('LOCK_')) lockError = code;
      // Review F4: any other refusal of the resolver is drift with its code, never a status that looks clean.
      else { drift = [...drift, { path: 'bowerloom.json', kind: 'resolve-error', code: typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'IO_ERROR' }]; if (status === 'ready') status = 'drifted'; }
    }
  }
  if (resolved?.lock.state === 'invalid' || lockError !== null) { drift = [...drift, { path: LOCK_FILE, kind: 'lock-invalid', code: resolved?.lock.code ?? lockError ?? 'LOCK_INVALID' }]; if (status === 'ready') status = 'drifted'; }
  // Review F4: with an invalid config the lock file is still reported: not used when absent, invalid when it cannot be read.
  let lockFile: { state: string; code: string | null } | null = null;
  if (config.state === 'invalid') { try { lockFile = readLock(project).state === 'absent' ? { state: 'not-used', code: null } : { state: 'mismatch', code: 'CONFIG_INVALID' }; } catch (error) { const code = (error as { code?: unknown } | null)?.code; lockFile = { state: 'invalid', code: typeof code === 'string' ? code : 'LOCK_INVALID' }; } }
  if (config.state === 'absent' && project.bowerloomIdentity !== null) { let present = false; try { lstatSync(join(project.dir, LOCK_FILE)); present = true; } catch { present = false; } if (present) { drift = [...drift, { path: LOCK_FILE, kind: 'lock-orphan' }]; if (status === 'ready') status = 'drifted'; } }
  const shared = config.state === 'valid' ? isSharedProject(project).shared : false;
  // Build plan 01, section 6: a skill installed by the earlier format is named, with the command that migrates it.
  let legacy = false; try { legacy = legacyPresent(project.dir); } catch { legacy = true; }
  const MIGRATE = 'bowerloom skills migrate plan --state <earlier-state-folder>';
  if (words[0] === '--json') {
    return newCommandJson({
      format: 'bowerloom/project-status/v1beta3', project: project.dir, projectId: project.projectId,
      markers: { folder: project.bowerloomIdentity !== null, config: project.configPresent }, setup, status, specReady, runtimeReady: false, executionAuthorized: false,
      revision, drift, owned, ...(legacy ? { legacy: { present: true, next: MIGRATE } } : {}), config: config.state === 'absent' ? null : { ...configObject(config), ...configAdditions(resolved, config, shared, lockError, lockFile) },
    });
  }
  // Review finding 16: name the files and items, not only their folders. An edited prompts folder names its edited
  // prompt files, and each held or missing item comes with its next step. These reads are best effort: when one
  // cannot be made, the folder line stays.
  const editedFiles = (path: string): string[] => { if (path !== '.bowerloom/prompts' && path !== '.bowerloom/slices') return [path]; const files = editedPrompts(project, path === '.bowerloom/slices' ? 'slice' : 'prompt'); return files === null || files.length === 0 ? [path] : files; };
  let held: HeldItem[] = project.bowerloomIdentity === null ? [] : missingItems(project, null), unavailable: string | null = null, drifted = false, agents: readonly AgentItem[] = [], stale: string[] = [];
  const base = { project, stateRoot: privateStateRoot(env, home), home, engines: ['claude-code' as const, 'codex' as const], team: null };
  if (project.bowerloomIdentity !== null) try {
    const plan = await planProjectApply(base);
    agents = plan.agents; held = uniqueHolds([...held, ...planHolds(plan.skills?.items ?? [], plan.prompts, plan.agents, plan.slices)]);
    stale = sliceLines(plan.slices, project.dir);
  } catch (error) {
    // The refusal is named. Some already show as drift lines, so they leave the setup as it is; any other makes it drifted.
    const code = (error as { code?: unknown } | null)?.code;
    unavailable = typeof code === 'string' && /^[A-Z_]{1,100}$/.test(code) ? code : 'IO_ERROR';
    drifted = !EXPECTED_PLAN_REFUSALS.includes(String(code));
    // The agents are planned on their own, so their holds still show.
    try { const only = await planProjectApply({ ...base, agentsOnly: true }); agents = only.agents; held = uniqueHolds([...held, ...planHolds([], [], only.agents, only.slices)]); stale = sliceLines(only.slices, project.dir); } catch { /* Nothing more to show. */ }
  }
  const installed = agents.filter(a => a.installed !== null).map(a => `  agent ${plainText(a.id)}: installed copy still active (${installedWords(a.installed!)})`);
  return [
    `Project: ${plainText(project.dir)}`,
    ...configLine(config),
    ...(resolved !== null ? [`Lock: ${resolved.lock.state}${resolved.lock.code ? ` (${plainText(resolved.lock.code)})` : ''}`, ...resolved.notes.map(n => `  ${plainText(n.replace(/^ {2}/, ''))}`), ...(resolved.storeCode ? [`  The store cannot be used (${plainText(resolved.storeCode)}). Run bowerloom store status.`] : [])] : lockFile !== null ? [`Lock: ${lockFile.state}${lockFile.code ? ` (${plainText(lockFile.code)})` : ''}`] : []),
    `Setup: ${plainText(drifted ? 'drifted' : status)}${setup === 'none' ? ' (no startup setup, this project uses bowerloom.json)' : ''}`,
    ...(revision ? [`Revision: ${plainText(revision)}`] : []),
    ...drift.map(item => `  ${plainText(item.kind)}: ${plainText(item.path)}${item.code ? ` (${plainText(item.code)})` : ''}`),
    ...owned.filter(item => item.state === 'edited').flatMap(item => editedFiles(item.path)).map(path => `  edited: ${plainText(path)}`),
    ...(unavailable !== null ? [`  plan unavailable (${plainText(unavailable)})`] : []),
    ...installed,
    ...held.map(item => `  ${item.kind} ${plainText(item.id)}: held (${plainText(item.code)}). Next: ${plainText(item.next)}`),
    ...stale,
    ...(legacy ? [`Legacy managed skill: .bowerloom-skills. Run ${MIGRATE}`] : []),
    'Workers: none started (this beta starts none)',
    '',
  ].join('\n');
}
