import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, verifyProjectPins } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { plainText } from './human.js';

const SECTIONS = ['teams', 'skills', 'prompts'] as const;
type Section = typeof SECTIONS[number];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIMIT = 256;

export interface Listing { teams: string[]; skills: string[]; prompts: string[]; unlisted: number }

/** Reads names only. A link, a stray file, or a name that is not a plain id is counted as unlisted and never followed. */
function entries(project: ProjectContext, folder: string, wants: 'directory' | 'prompt'): { names: string[]; unlisted: number } {
  const path = join(project.dir, '.bowerloom', folder);
  let stat; try { stat = lstatSync(path); } catch { return { names: [], unlisted: 0 }; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { names: [], unlisted: 1 };
  const all = readdirSync(path, { withFileTypes: true });
  if (all.length > LIMIT) throw new DefinitionError('INSPECTION_LIMIT', 'This folder holds too many entries to list.');
  const names: string[] = []; let unlisted = 0;
  for (const entry of all) {
    const plain = !entry.isSymbolicLink() && (wants === 'directory' ? entry.isDirectory() : entry.isFile());
    const name = wants === 'prompt' ? entry.name.replace(/\.md$/, '') : entry.name;
    if (plain && ID.test(name) && (wants === 'directory' || entry.name.endsWith('.md'))) names.push(name); else unlisted++;
  }
  return { names: names.sort(), unlisted };
}

/** Lists the pinned project only: the project folder and its .bowerloom must be the ones discovery pinned, before and after the reads. */
export function listProject(project: ProjectContext): Listing {
  verifyProjectPins(project);
  const teams = entries(project, 'teams', 'directory'), skills = entries(project, 'skills', 'directory'), prompts = entries(project, 'prompts', 'prompt');
  verifyProjectPins(project);
  return { teams: teams.names, skills: skills.names, prompts: prompts.names, unlisted: teams.unlisted + skills.unlisted + prompts.unlisted };
}

const title = (section: Section): string => section[0]!.toUpperCase() + section.slice(1);
export function renderListing(listing: Listing, only: Section | null, json: boolean): string {
  const shown = only ? [only] : [...SECTIONS];
  if (json) return `${canonicalJson({ format: 'bowerloom/ls/v1beta1', ...Object.fromEntries(shown.map(s => [s, listing[s]])), unlisted: listing.unlisted })}\n`;
  const blocks = shown.map(s => `${title(s)}\n${listing[s].length ? listing[s].map(n => `  ${plainText(n)}`).join('\n') : '  none yet'}\n`);
  const note = listing.unlisted ? `\nNot listed: ${listing.unlisted} ${listing.unlisted === 1 ? 'entry' : 'entries'} with an unusual name or type. Run bowerloom status.\n` : '';
  return blocks.join('\n') + note;
}

/** `bowerloom ls [teams|skills|prompts] [--json]`. Returns the text to print. */
export function runLsCommand(args: readonly string[], cwd: string, home: string): string {
  const words = args.slice(1), json = words.includes('--json');
  const rest = words.filter(w => w !== '--json');
  if (words.filter(w => w === '--json').length > 1 || rest.length > 1 || rest.some(w => w.startsWith('-')) || (rest[0] !== undefined && !(SECTIONS as readonly string[]).includes(rest[0]))) {
    throw new DefinitionError('USAGE', 'Use bowerloom ls [teams|skills|prompts] [--json].');
  }
  return renderListing(listProject(discoverProject(cwd, home)), (rest[0] as Section | undefined) ?? null, json);
}
