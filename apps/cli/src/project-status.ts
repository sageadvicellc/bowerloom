import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot, projectRefusal } from '../../../packages/project-context/src/index.js';
import type { OwnerVerifier, ProjectContext } from '../../../packages/project-context/src/types.js';
import { inspectOwnedOnly, inspectStartup } from '../../../packages/startup/src/index.js';
import type { Drift, OwnedEntry } from '../../../packages/startup/src/index.js';
import { readConfig } from '../../../packages/project-config/src/index.js';
import type { ConfigRead } from '../../../packages/project-config/src/index.js';
import { authoringVerifier, manifestVerifier } from '../../../packages/project-authoring/src/index.js';
import { managedVerifier } from '../../../packages/managed-skills/src/v2-verifier.js';
import { legacyPresent } from '../../../packages/managed-skills/src/migrate.js';
import { newCommandJson, plainText } from './human.js';
import { planProjectApply } from '../../../packages/project-sync/src/index.js';
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

/** True when `.bowerloom/installation-receipt.json` is not there. Any other lstat result counts as present, so the startup inspection reports it. */
function receiptMissing(project: ProjectContext): boolean {
  try { lstatSync(join(project.dir, '.bowerloom', 'installation-receipt.json')); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

/** The `config` object of the status JSON, or null for a project with no bowerloom.json. */
function configObject(read: ConfigRead): Record<string, unknown> | null {
  if (read.state === 'absent') return null;
  const base = { path: 'bowerloom.json', sha256: read.sha256, bytes: read.bytes };
  return read.state === 'valid'
    ? { ...base, state: 'valid', code: null, harnesses: [...read.config.harnesses], counts: { skills: read.config.skills.length, prompts: read.config.prompts.length, teams: read.config.teams.length } }
    : { ...base, state: 'invalid', code: read.code, harnesses: [], counts: { skills: 0, prompts: 0, teams: 0 } };
}
const configLine = (read: ConfigRead): string[] => read.state === 'absent' ? []
  : [read.state === 'valid' ? `Config: bowerloom.json (${read.config.skills.length} skills, ${read.config.prompts.length} prompts, ${read.config.teams.length} teams)` : `Config: bowerloom.json (invalid, ${read.code})`];

/** `bowerloom status [--json]` for the project that holds the working folder. Reads only. Returns the text to print; the words escape control characters, the JSON is exact. */
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
  // Build plan 01, section 6: a skill installed by the earlier format is named, with the command that migrates it.
  let legacy = false; try { legacy = legacyPresent(project.dir); } catch { legacy = true; }
  const MIGRATE = 'bowerloom skills migrate plan --state <earlier-state-folder>';
  if (words[0] === '--json') {
    return newCommandJson({
      format: 'bowerloom/project-status/v1beta2', project: project.dir, projectId: project.projectId,
      markers: { folder: project.bowerloomIdentity !== null, config: project.configPresent }, setup, status, specReady, runtimeReady: false, executionAuthorized: false,
      revision, drift, owned, ...(legacy ? { legacy: { present: true, next: MIGRATE } } : {}), config: configObject(config),
    });
  }
  // Review finding 16: name the files and items, not only their folders. An edited prompts folder names its edited
  // prompt files, and each held or missing item comes with its next step. These reads are best effort: when one
  // cannot be made, the folder line stays.
  const editedFiles = (path: string): string[] => { if (path !== '.bowerloom/prompts') return [path]; const files = editedPrompts(project); return files === null || files.length === 0 ? [path] : files; };
  let held: HeldItem[] = project.bowerloomIdentity === null ? [] : missingItems(project, null);
  if (project.bowerloomIdentity !== null) try {
    const plan = await planProjectApply({ project, stateRoot: privateStateRoot(env, home), harnesses: ['claude', 'codex'], team: null });
    held = uniqueHolds([...held, ...planHolds(plan.skills?.items ?? [], plan.prompts)]);
  } catch { /* The drift lines above still name the folder. */ }
  return [
    `Project: ${plainText(project.dir)}`,
    ...configLine(config),
    `Setup: ${plainText(status)}${setup === 'none' ? ' (no startup setup, this project uses bowerloom.json)' : ''}`,
    ...(revision ? [`Revision: ${plainText(revision)}`] : []),
    ...drift.map(item => `  ${plainText(item.kind)}: ${plainText(item.path)}${item.code ? ` (${plainText(item.code)})` : ''}`),
    ...owned.filter(item => item.state === 'edited').flatMap(item => editedFiles(item.path)).map(path => `  edited: ${plainText(path)}`),
    ...held.map(item => `  ${item.kind} ${plainText(item.id)}: held (${plainText(item.code)}). Next: ${plainText(item.next)}`),
    ...(legacy ? [`Legacy managed skill: .bowerloom-skills. Run ${MIGRATE}`] : []),
    'Workers: none started (this beta starts none)',
    '',
  ].join('\n');
}
