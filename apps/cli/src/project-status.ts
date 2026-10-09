import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { OwnerVerifier, ProjectContext } from '../../../packages/project-context/src/types.js';
import { inspectStartup } from '../../../packages/startup/src/index.js';
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

/** `bowerloom status [--json]` for the project that holds the working folder. Reads only. Returns the text to print; the words escape control characters, the JSON is exact. */
export async function runProjectStatus(args: readonly string[], cwd: string, home: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const words = args.slice(1);
  if (words.some(w => w !== '--json') || words.length > 1) throw new DefinitionError('USAGE', 'Use bowerloom status [--json]. For a prepared session, use bowerloom status --installation <private.json>.');
  const project = discoverProject(cwd, home), inspection = await inspectStartup(project.dir, { owners: projectOwners(project, env, home) });
  const status = inspection.status === 'ready-for-review' ? 'ready' : inspection.status;
  const owned = inspection.owned ?? [];
  // Build plan 01, section 6: a skill installed by the earlier format is named, with the command that migrates it.
  let legacy = false; try { legacy = legacyPresent(project.dir); } catch { legacy = true; }
  const MIGRATE = 'bowerloom skills migrate plan --state <earlier-state-folder>';
  if (words[0] === '--json') {
    return newCommandJson({ format: 'bowerloom/project-status/v1beta1', project: project.dir, projectId: project.projectId, status, specReady: inspection.specReady, runtimeReady: false, executionAuthorized: false, revision: inspection.revision, drift: inspection.drift, owned, ...(legacy ? { legacy: { present: true, next: MIGRATE } } : {}) });
  }
  // Review finding 16: name the files and items, not only their folders. An edited prompts folder names its edited
  // prompt files, and each held or missing item comes with its next step. These reads are best effort: when one
  // cannot be made, the folder line stays.
  const editedFiles = (path: string): string[] => { if (path !== '.bowerloom/prompts') return [path]; const files = editedPrompts(project); return files === null || files.length === 0 ? [path] : files; };
  let held: HeldItem[] = missingItems(project, null);
  try {
    const plan = await planProjectApply({ project, stateRoot: privateStateRoot(env, home), harnesses: ['claude', 'codex'], team: null });
    held = uniqueHolds([...held, ...planHolds(plan.skills?.items ?? [], plan.prompts)]);
  } catch { /* The drift lines above still name the folder. */ }
  return [
    `Project: ${plainText(project.dir)}`,
    `Setup: ${plainText(status)}`,
    ...(inspection.revision ? [`Revision: ${plainText(inspection.revision)}`] : []),
    ...inspection.drift.map(item => `  ${plainText(item.kind)}: ${plainText(item.path)}${item.code ? ` (${plainText(item.code)})` : ''}`),
    ...owned.filter(item => item.state === 'edited').flatMap(item => editedFiles(item.path)).map(path => `  edited: ${plainText(path)}`),
    ...held.map(item => `  ${item.kind} ${plainText(item.id)}: held (${plainText(item.code)}). Next: ${plainText(item.next)}`),
    ...(legacy ? [`Legacy managed skill: .bowerloom-skills. Run ${MIGRATE}`] : []),
    'Workers: none started (this beta starts none)',
    '',
  ].join('\n');
}
