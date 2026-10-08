import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, verifyProjectPins } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { LIMITS, readGuarded } from '../../../packages/project-authoring/src/files.js';
import { readManifestState } from '../../../packages/skill-manifest/src/add.js';
import { parseManifest } from '../../../packages/skill-manifest/src/schema.js';
import { newCommandJson, plainText } from './human.js';

const SECTIONS = ['teams', 'skills', 'prompts'] as const;
type Section = typeof SECTIONS[number];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIMIT = 256;

export interface Listing {
  teams: string[]; skills: string[]; prompts: string[]; unlisted: number;
  /** Review freeze finding 11: the npm and GitHub skills that .bowerloom/skills.json pins, by id. Null when it cannot be read. */
  pinned?: { id: string; pin: string }[] | null;
  /** The display name of first-team: the team name the person gave setup. Null when the brief cannot be read. */
  firstTeamName?: string | null;
}

/** first-team's display name, read from .bowerloom/brief.json with the authoring guards. */
function firstTeamName(project: ProjectContext): string | null {
  try {
    const value = JSON.parse(readGuarded(join(project.dir, '.bowerloom', 'brief.json'), LIMITS.briefBytes).toString('utf8')) as { teamName?: unknown };
    return typeof value.teamName === 'string' ? value.teamName : null;
  } catch { return null; }
}
/** The pinned skills of skills.json, read with the manifest guards. An empty list when there is no skills.json. */
function pinnedSkills(project: ProjectContext): { id: string; pin: string }[] | null {
  try {
    const state = readManifestState(project.dir);
    if (state.file === null) return [];
    return parseManifest(state.file.bytes).skills.flatMap(e => e.source.kind === 'npm' ? [{ id: e.id, pin: `npm ${e.source.package}@${e.source.version}` }]
      : e.source.kind === 'git' ? [{ id: e.id, pin: `GitHub ${e.source.repository}@${e.source.commit}` }] : []).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  } catch { return null; }
}

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
  const pinned = pinnedSkills(project), name = teams.names.includes('first-team') ? firstTeamName(project) : null;
  verifyProjectPins(project);
  return { teams: teams.names, skills: skills.names, prompts: prompts.names, unlisted: teams.unlisted + skills.unlisted + prompts.unlisted, pinned, firstTeamName: name };
}

const title = (section: Section): string => section[0]!.toUpperCase() + section.slice(1);
export function renderListing(listing: Listing, only: Section | null, json: boolean): string {
  const shown = only ? [only] : [...SECTIONS], pinned = listing.pinned ?? [];
  // F' code review B: a skills.json that cannot be read is pinned: null, so an agent never reads it as "no pins".
  if (json) return newCommandJson({ format: 'bowerloom/ls/v1beta1', ...Object.fromEntries(shown.map(s => [s, listing[s]])), ...(shown.includes('skills') ? { pinned: listing.pinned === null ? null : pinned.map(p => p.id) } : {}), unlisted: listing.unlisted });
  const width = Math.max(0, ...pinned.map(p => p.id.length));
  const lines = (s: Section): string[] => s === 'teams'
    ? listing.teams.map(n => n === 'first-team' && listing.firstTeamName && listing.firstTeamName !== n ? `  ${n} (${plainText(listing.firstTeamName)})` : `  ${plainText(n)}`)
    : s === 'skills' ? [...listing.skills.map(n => `  ${plainText(n)}`), ...pinned.map(p => `  ${plainText(p.id.padEnd(width))}  pinned: ${plainText(p.pin)}`)]
    : listing[s].map(n => `  ${plainText(n)}`);
  const blocks = shown.map(s => { const l = lines(s); return `${title(s)}\n${l.length ? l.join('\n') : '  none yet'}\n`; });
  const note = listing.unlisted ? `\nNot listed: ${listing.unlisted} ${listing.unlisted === 1 ? 'entry' : 'entries'} with an unusual name or type. Run bowerloom status.\n` : '';
  const manifest = shown.includes('skills') && listing.pinned === null ? '\nPinned skills are not listed: .bowerloom/skills.json cannot be read. Run bowerloom skills check.\n' : '';
  return blocks.join('\n') + note + manifest;
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
