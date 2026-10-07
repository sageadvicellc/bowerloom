import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject } from '../../../packages/project-context/src/index.js';
import { inspectStartup } from '../../../packages/startup/src/index.js';
import { newCommandJson, plainText } from './human.js';

/** `bowerloom status [--json]` for the project that holds the working folder. Reads only. Returns the text to print; the words escape control characters, the JSON is exact. */
export async function runProjectStatus(args: readonly string[], cwd: string, home: string): Promise<string> {
  const words = args.slice(1);
  if (words.some(w => w !== '--json') || words.length > 1) throw new DefinitionError('USAGE', 'Use bowerloom status [--json]. For a prepared session, use bowerloom status --installation <private.json>.');
  const project = discoverProject(cwd, home), inspection = await inspectStartup(project.dir);
  const status = inspection.status === 'ready-for-review' ? 'ready' : inspection.status;
  if (words[0] === '--json') {
    return newCommandJson({ format: 'bowerloom/project-status/v1beta1', project: project.dir, projectId: project.projectId, status, specReady: inspection.specReady, runtimeReady: false, executionAuthorized: false, revision: inspection.revision, drift: inspection.drift });
  }
  return [
    `Project: ${plainText(project.dir)}`,
    `Setup: ${plainText(status)}`,
    ...(inspection.revision ? [`Revision: ${plainText(inspection.revision)}`] : []),
    ...inspection.drift.map(item => `  ${plainText(item.kind)}: ${plainText(item.path)}`),
    'Workers: none started (this beta starts none)',
    '',
  ].join('\n');
}
