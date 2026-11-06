/** One note for each engine a project lists that Bowerloom has no writer for. Used by commands that read Claude Code agents only and write nothing. */
import { nonWriterEngines } from '../../../packages/project-sync/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';

export function engineNotes(project: ProjectContext): string[] {
  return nonWriterEngines(project).map(engine => `Note: this project lists the engine ${engine}. Bowerloom has no writer for ${engine} yet. This command writes nothing and reads Claude Code agents only, so it ran anyway.\n`);
}
