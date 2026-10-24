/**
 * The invented catalog behind the "Add skills" panel of the prototype (spec 6.2 and section 11). Nothing here is read from a disk.
 * It holds one library a person can add, "Lantern Works" (6 skills and 3 agents), and three folders that "found" some skills.
 * Every name, text and path is invented, and none of them is in the sample world (`generateWorld`). The paths are cache paths that do not exist.
 * Pure data and two small readers: no clock, no random number, no file.
 */
import { hashText } from './sample.js';
import type { InterfaceId } from './types.js';

/** A skill a catalog library holds. `interfaces` are the interfaces whose cache holds it. */
export interface CatalogSkill { readonly key: string; readonly name: string; readonly description: string; readonly interfaces: readonly InterfaceId[]; readonly text: string }

/** An agent a catalog library holds. `skillKeys` name skills of the same library, in order. */
export interface CatalogAgent { readonly key: string; readonly name: string; readonly role: string; readonly instructions: string; readonly skillKeys: readonly string[] }

/** A library a person can add. It becomes a `LibrarySource` and read-only items in the global harness. */
export interface CatalogLibrary {
  readonly id: string; readonly name: string; readonly version: string; readonly summary: string; readonly cacheRoot: string;
  readonly skills: readonly CatalogSkill[]; readonly agents: readonly CatalogAgent[];
}

/** A skill found in a folder. Finding it changes nothing: the first release only lists it. */
export interface FolderSkill { readonly id: string; readonly name: string; readonly description: string }

/** A folder the prototype pretends to have found. `path` is a detail line, never the main label. */
export interface FolderCandidate { readonly id: string; readonly name: string; readonly path: string; readonly skills: readonly FolderSkill[] }

const skillText = (name: string, description: string, body: string): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

const WORKS_SKILLS: readonly CatalogSkill[] = [
  { key: 'wick-trimming', name: 'wick-trimming', description: 'Trim a wick to the right length before the evening shift.', interfaces: ['claude-code', 'codex'], text: skillText('wick-trimming', 'Trim a wick to the right length before the evening shift.', 'Cut the wick level. Leave about the width of a thumbnail. Note the lamp number in the log.') },
  { key: 'oil-topping', name: 'oil-topping', description: 'Top up the oil reservoir and record how much it took.', interfaces: ['claude-code'], text: skillText('oil-topping', 'Top up the oil reservoir and record how much it took.', 'Fill to the mark and no higher. Wipe the rim. Write the amount in the log.') },
  { key: 'glass-polishing', name: 'glass-polishing', description: 'Polish the lens glass without leaving streaks.', interfaces: ['claude-code', 'codex', 'opencode'], text: skillText('glass-polishing', 'Polish the lens glass without leaving streaks.', 'Use a dry cloth first, then a damp one. Work from the centre outward. Check the lens against the light.') },
  { key: 'flame-guarding', name: 'flame-guarding', description: 'Check that the flame guard sits firm before lighting.', interfaces: ['codex'], text: skillText('flame-guarding', 'Check that the flame guard sits firm before lighting.', 'Press each clip. Look for a bent rim. Do not light a lamp with a loose guard.') },
  { key: 'shutter-timing', name: 'shutter-timing', description: 'Set the shutter turn so the beam sweeps once a minute.', interfaces: ['claude-code', 'opencode'], text: skillText('shutter-timing', 'Set the shutter turn so the beam sweeps once a minute.', 'Count one full sweep against a clock. Adjust the weight. Count again.') },
  { key: 'beam-aiming', name: 'beam-aiming', description: 'Aim the beam at the far marker and note the offset.', interfaces: ['claude-code'], text: skillText('beam-aiming', 'Aim the beam at the far marker and note the offset.', 'Face the marker. Turn the mount in small steps. Write the offset in degrees.') },
];

const WORKS_AGENTS: readonly CatalogAgent[] = [
  { key: 'dusk-lamplighter', name: 'dusk-lamplighter', role: 'lamplighter', instructions: 'Light each lamp in order at dusk. Check the wick and the oil first. Report any lamp that will not hold a flame.', skillKeys: ['wick-trimming', 'oil-topping', 'flame-guarding'] },
  { key: 'reef-spotter', name: 'reef-spotter', role: 'spotter', instructions: 'Watch the far marker and the beam. Say when the beam drifts. Keep the offset log up to date.', skillKeys: ['beam-aiming', 'shutter-timing'] },
  { key: 'tower-keeper', name: 'tower-keeper', role: 'keeper', instructions: 'Keep the tower clean and the lenses clear. Hand out the evening jobs. Close the log at dawn.', skillKeys: ['glass-polishing'] },
];

/** The libraries a person can add. The sample world already holds the other one, Evergreen Kit, so it is not here. */
export const LIBRARY_CATALOG: readonly CatalogLibrary[] = Object.freeze([
  {
    id: 'lantern-works', name: 'Lantern Works', version: '1.2.0', cacheRoot: '/Users/sample/.cache/lantern-works/1.2.0',
    summary: 'Six skills and three agents for keeping lamps and lenses.', skills: WORKS_SKILLS, agents: WORKS_AGENTS,
  },
]);

/** The folders the "From a folder" source pretends to find. Invented, and read only after approval. */
export const FOLDER_CANDIDATES: readonly FolderCandidate[] = Object.freeze([
  {
    id: 'folder-harbour', name: 'Harbour notes', path: '/Users/sample/Harbour/.claude/skills',
    skills: [
      { id: 'found-tide-reading', name: 'tide-reading', description: 'Read the tide table and say when the water turns.' },
      { id: 'found-rope-splicing', name: 'rope-splicing', description: 'Splice two ends of rope and note the knot used.' },
    ],
  },
  {
    id: 'folder-orchard', name: 'Orchard work', path: '/Users/sample/Orchard/.codex/skills',
    skills: [
      { id: 'found-graft-checking', name: 'graft-checking', description: 'Check each graft for a clean join before spring.' },
      { id: 'found-crate-labelling', name: 'crate-labelling', description: 'Label each crate with the row and the picking day.' },
      { id: 'found-frost-watching', name: 'frost-watching', description: 'Watch the night temperature and warn when frost is near.' },
    ],
  },
  {
    id: 'folder-workshop', name: 'Workshop jigs', path: '/Users/sample/Workshop/.opencode/skill',
    skills: [
      { id: 'found-jig-setting', name: 'jig-setting', description: 'Set a jig square and lock it before the first cut.' },
      { id: 'found-offcut-sorting', name: 'offcut-sorting', description: 'Sort offcuts by length into the three bins.' },
    ],
  },
]);

/** The id an item of a catalog library gets in the world. */
export const catalogItemId = (libraryId: string, key: string): string => `${libraryId}-${key}`;

const FOLDER: Readonly<Record<InterfaceId, string>> = { 'claude-code': 'claude-code', codex: 'codex', opencode: 'opencode' };

/** Where the cache of one interface holds a skill of the library. Invented. */
export const catalogSkillPath = (lib: CatalogLibrary, skill: CatalogSkill, face: InterfaceId): string => `${lib.cacheRoot}/${FOLDER[face]}/skills/${skill.name}/SKILL.md`;

/** Where the cache holds an agent of the library. Invented. */
export const catalogAgentPath = (lib: CatalogLibrary, agent: CatalogAgent): string => `${lib.cacheRoot}/claude-code/agents/${agent.name}.md`;

/** The text an agent file of the library holds, as the sample world writes one. */
export const catalogAgentText = (agent: CatalogAgent): string => `# ${agent.name}\nrole: ${agent.role}\n\n${agent.instructions}\n`;

/** A short fingerprint of a text, the same one the sample world uses, so a catalog item passes the world's reference check. */
export const catalogHash = (text: string): string => hashText(text);
