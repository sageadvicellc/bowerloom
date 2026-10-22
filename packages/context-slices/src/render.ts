/**
 * The rendered index of a slice (`renderSliceIndex`, spec 05, section 4.5) and the file `slice create` writes
 * (`sliceTemplate`, section 4.3). Both are pure. The index holds paths and titles only: no hash, size, time, or absolute
 * path, so two runs over the same tree give the same bytes.
 */
import type { SliceDefinition, SliceRoot } from './slice-file.js';
import type { SliceResolution } from './resolve.js';

export interface IndexDisplay {
  /** `the project folder`, the root path, or `<relative path> (registered folder <name>)`. */
  source: string;
  /** The root's path from the project folder, '' for the project folder itself. Member paths start with it. */
  prefix: string;
}
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
export const GUARD_LINE = "Bowerloom's guard blocks a read under the source folder that this list does not name.";

export function renderSliceIndex(id: string, def: SliceDefinition, resolution: Pick<SliceResolution, 'members'>, display: IndexDisplay): string {
  const lines = resolution.members
    .map(m => ({ path: display.prefix === '' ? m.path : `${display.prefix}/${m.path}`, summary: def.summary.kind === 'none' ? null : m.summary }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map(m => `- \`${m.path}\`${m.summary === null ? '' : `: ${m.summary}`}`);
  return [
    '---',
    `name: slice-${id}`,
    `description: ${JSON.stringify(def.description).replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029')}`,
    'user-invocable: false',
    '---',
    '',
    `# Context slice ${id}`,
    '',
    `Bowerloom made this file from .bowerloom/slices/${id}.yaml. Do not edit it. Edit the slice file, then run bowerloom apply.`,
    '',
    'The files below are the context for your work. They stay where they are. Read a file with the Read tool when your task needs it. Paths are relative to the project folder, the nearest folder above your working folder that holds .bowerloom.',
    '',
    `Source folder: ${display.source}`,
    `Files: ${resolution.members.length}`,
    ...(def.guard === 'root' ? [GUARD_LINE] : []),
    '',
    ...lines,
    '',
  ].join('\n');
}

/** The text `slice create <name>` writes (section 4.3). */
export function sliceTemplate(input: { root: SliceRoot; includes: readonly string[] }): string {
  const root = input.root.kind === 'project'
    ? [`root: ${JSON.stringify(input.root.path)}`]
    : ['root:', `  registered: ${input.root.name}`, `  path: ${JSON.stringify(input.root.path)}`];
  return [
    'format: bowerloom/context-slice/v1beta1',
    'description: Describe what this slice holds and which agents use it.',
    ...root,
    'include:',
    ...input.includes.map(p => `  - ${JSON.stringify(p)}`),
    'summary: heading',
    'guard: root',
    '',
  ].join('\n');
}
