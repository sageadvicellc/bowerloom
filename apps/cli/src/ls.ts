/**
 * `bowerloom ls [teams|skills|prompts] [--global] [--json]` (format bowerloom/ls/v1beta2). It reads only and writes nothing.
 * Without `--global` it lists the project, and tags every item `project`. With `--global` it lists the store, `~/.bowerloom`,
 * from any folder, and tags every item `store`. A project listing never mixes in store items. Spec 06 adds `via`, `locked`
 * and `resolvedFrom` values; the fields are fixed here.
 */
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, inspectStore, projectRefusal, verifyProjectPins, verifyStorePins } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { LIMITS, readGuarded } from '../../../packages/project-authoring/src/files.js';
import { readManifestState, projectTarget, storeTarget } from '../../../packages/skill-manifest/src/add.js';
import type { ManifestTarget } from '../../../packages/skill-manifest/src/add.js';
import { pinOf } from '../../../packages/skill-manifest/src/check.js';
import { parseManifest } from '../../../packages/skill-manifest/src/schema.js';
import { readConfig } from '../../../packages/project-config/src/index.js';
import { configLine } from './config-status.js';
import { newCommandJson, plainText } from './human.js';

const SECTIONS = ['teams', 'skills', 'prompts'] as const;
type Section = typeof SECTIONS[number];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIMIT = 256;

export type ListSource = 'project' | 'store';
/** One skill: its kind comes from its skills.json entry, `local` when it has none. `pin` is set for npm and git entries only. */
export interface ListedSkill { id: string; kind: 'local' | 'npm' | 'git'; pin: string | null }
export interface Listing {
  scope: ListSource;
  /** For the store only: `absent` when there is no store yet. */
  storeState?: 'ready' | 'absent';
  teams: string[]; skills: string[]; prompts: string[]; unlisted: number;
  /** Per skill id: its kind and pin. Null when skills.json cannot be read, so an agent never reads it as "no pins". */
  skillInfo: ReadonlyMap<string, ListedSkill> | null;
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
/** The entries of skills.json, read with the manifest guards. An empty list when there is no skills.json; null when it cannot be read. */
function manifestSkills(target: ManifestTarget): ListedSkill[] | null {
  try {
    const state = readManifestState(target, { allowAbsent: target.scope === 'store' });
    if (state.file === null) return [];
    return parseManifest(state.file.bytes, target.limits).skills.map(e => ({ id: e.id, kind: e.source.kind, pin: e.source.kind === 'local' ? null : pinOf(e) }));
  } catch { return null; }
}
/** Folder names and skills.json entries, one item for each id. */
function skillItems(folders: readonly string[], entries: ListedSkill[] | null): { ids: string[]; info: ReadonlyMap<string, ListedSkill> | null } {
  const info = new Map<string, ListedSkill>();
  for (const id of folders) info.set(id, { id, kind: 'local', pin: null });
  for (const e of entries ?? []) info.set(e.id, e);
  return { ids: [...info.keys()].sort(byteOrder), info: entries === null ? null : info };
}
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Reads names only. A link, a stray file, or a name that is not a plain id is counted as unlisted and never followed. */
function entries(base: string, folder: string, wants: 'directory' | 'prompt'): { names: string[]; unlisted: number } {
  const path = join(base, folder);
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
  return { names: names.sort(byteOrder), unlisted };
}

/** Lists the pinned project only: the project folder and its .bowerloom must be the ones discovery pinned, before and after the reads. */
export function listProject(project: ProjectContext): Listing {
  verifyProjectPins(project);
  const base = join(project.dir, '.bowerloom');
  const teams = entries(base, 'teams', 'directory'), skills = entries(base, 'skills', 'directory'), prompts = entries(base, 'prompts', 'prompt');
  const manifest = project.bowerloomIdentity === null ? [] : manifestSkills(projectTarget(project.dir));
  const items = skillItems(skills.names, manifest), name = teams.names.includes('first-team') ? firstTeamName(project) : null;
  verifyProjectPins(project);
  return { scope: 'project', teams: teams.names, skills: items.ids, prompts: prompts.names, unlisted: teams.unlisted + skills.unlisted + prompts.unlisted, skillInfo: items.info, firstTeamName: name };
}

/** Lists the store at `home`. No store gives empty lists with storeState absent; a foreign or unsafe store refuses with its STORE_* code. */
export function listStore(home: string): Listing {
  const found = inspectStore(home);
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  if (found.state === 'absent') return { scope: 'store', storeState: 'absent', teams: [], skills: [], prompts: [], unlisted: 0, skillInfo: new Map(), firstTeamName: null };
  const store = found.context;
  verifyStorePins(store);
  const teams = entries(store.dir, 'teams', 'directory'), skills = entries(store.dir, 'skills', 'directory'), prompts = entries(store.dir, 'prompts', 'prompt');
  const items = skillItems(skills.names, manifestSkills(storeTarget(store.dir)));
  verifyStorePins(store);
  return { scope: 'store', storeState: 'ready', teams: teams.names, skills: items.ids, prompts: prompts.names, unlisted: teams.unlisted + skills.unlisted + prompts.unlisted, skillInfo: items.info, firstTeamName: null };
}

const title = (section: Section): string => section[0]!.toUpperCase() + section.slice(1);
const NO_STORE = 'No store yet. Create one with bowerloom skill create <name> --global.';
const pinText = (skill: ListedSkill): string => `${skill.kind === 'npm' ? 'npm' : 'GitHub'} ${skill.pin}`;
const fixed = (source: ListSource) => ({ via: [] as string[], locked: null, resolvedFrom: source });
export function renderListing(listing: Listing, only: Section | null, json: boolean): string {
  const shown = only ? [only] : [...SECTIONS], source = listing.scope, info = listing.skillInfo;
  if (json) {
    const sections: Record<string, unknown> = {
      teams: listing.teams.map(id => ({ id, source, ...fixed(source), displayName: id === 'first-team' && source === 'project' ? listing.firstTeamName ?? null : null, state: 'ok' })),
      skills: listing.skills.map(id => { const s = info?.get(id) ?? { id, kind: 'local' as const, pin: null }; return { id, source, ...fixed(source), kind: s.kind, pin: s.pin, state: 'ok' }; }),
      prompts: listing.prompts.map(id => ({ id, source, ...fixed(source), state: 'ok' })),
    };
    return newCommandJson({
      format: 'bowerloom/ls/v1beta2', scope: source, listedBy: 'folders',
      ...Object.fromEntries(shown.map(s => [s, sections[s]])),
      // A skills.json that cannot be read is pinsReadable false, so an agent never reads it as "no pins".
      ...(shown.includes('skills') ? { pinsReadable: info !== null } : {}),
      unselected: { skills: [], prompts: [], teams: [] }, unlisted: listing.unlisted,
      ...(listing.scope === 'store' ? { storeState: listing.storeState ?? 'ready' } : {}),
    });
  }
  if (listing.scope === 'store' && listing.storeState === 'absent') return `${NO_STORE}\n`;
  const labelled = (rows: { label: string; tail?: string }[]): string[] => {
    const width = Math.max(0, ...rows.map(r => r.label.length));
    return rows.map(r => `  ${r.label.padEnd(width)}  ${source}${r.tail ? `  ${r.tail}` : ''}`);
  };
  const lines = (s: Section): string[] => s === 'teams'
    ? labelled(listing.teams.map(n => ({ label: n === 'first-team' && source === 'project' && listing.firstTeamName && listing.firstTeamName !== n ? `${n} (${plainText(listing.firstTeamName)})` : plainText(n) })))
    : s === 'skills' ? labelled(listing.skills.map(id => { const k = info?.get(id); return { label: plainText(id), ...(k && k.kind !== 'local' ? { tail: `pinned: ${plainText(pinText(k))}` } : {}) }; }))
    : labelled(listing.prompts.map(n => ({ label: plainText(n) })));
  const blocks = shown.map(s => { const l = lines(s); return `${title(s)}\n${l.length ? l.join('\n') : '  none yet'}\n`; });
  const note = listing.unlisted ? `\nNot listed: ${listing.unlisted} ${listing.unlisted === 1 ? 'entry' : 'entries'} with an unusual name or type. Run bowerloom status.\n` : '';
  const manifest = shown.includes('skills') && info === null
    ? (source === 'store' ? '\nPinned skills are not listed: the store skills.json cannot be read. Run bowerloom store status.\n' : '\nPinned skills are not listed: .bowerloom/skills.json cannot be read. Run bowerloom skills check.\n') : '';
  return blocks.join('\n') + note + manifest;
}

/** `bowerloom ls [teams|skills|prompts] [--global] [--json]`. Returns the text to print. */
export function runLsCommand(args: readonly string[], cwd: string, home: string): string {
  const USAGE = 'Use bowerloom ls [teams|skills|prompts] [--global] [--json].';
  const words = args.slice(1), json = words.includes('--json'), global = words.includes('--global');
  if (words.filter(w => w === '--global').length > 1) throw new DefinitionError('USAGE', 'Use --global once.');
  const rest = words.filter(w => w !== '--json' && w !== '--global');
  if (words.filter(w => w === '--json').length > 1 || rest.length > 1 || rest.some(w => w.startsWith('-')) || (rest[0] !== undefined && !(SECTIONS as readonly string[]).includes(rest[0]))) {
    throw new DefinitionError('USAGE', USAGE);
  }
  const only = (rest[0] as Section | undefined) ?? null;
  if (global) return renderListing(listStore(home), only, json);
  const project = discoverProject(cwd, home), listing = listProject(project);
  const text = renderListing(listing, only, json);
  // A project with a bowerloom.json says so first, as status does: valid with counts, or the code that makes it invalid.
  return json || !project.configPresent ? text : `${configLine(readConfig(project)).join('\n')}\n\n${text}`;
}
