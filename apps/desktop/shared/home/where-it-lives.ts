/**
 * "Show where it lives": for an agent, a skill or a tool, the place it is kept in each program that holds it, as a sample path with the home folder written as "~"
 * ("~/Studio/.claude/skills/write-a-reply.md"). The paths come from the sample world's own folders (the invented "Studio" under the invented home folder), never from
 * the machine the preview runs on, and a stored name that reads like a made-up word pair is written as the plain name of the thing ("write-a-reply"). One path for
 * each program, the first place it was found there. Pure: no React, no DOM.
 */
import type { HarnessItem, InterfaceId, World } from '../world/types.js';
import { realPlacesOf } from '../real/plain-fallback.js';
import { PROGRAM_NAMES, PROGRAM_ORDER } from './plain-details.js';

/** One program that holds the thing, and where. */
export interface Place { readonly app: string; readonly path: string }

/** The home folder of the sample world, which is written "~" on screen. */
const SAMPLE_HOME = '/Users/sample';

/** The words of a name as a file name: "Write a reply" is "write-a-reply". */
export function slugOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'item' : slug;
}

/**
 * The sample path of one place, with the stored name of the item replaced by the plain one. A skill is kept as `<name>/SKILL.md` and an agent as `<name>.md` (or `.toml`);
 * they become `<plain-name>.md`. A file that holds more than one thing (`config.toml`, `settings.json`) keeps its own name.
 */
export function samplePath(path: string, storedName: string, plainName: string): string {
  const slug = slugOf(plainName), tilde = path.startsWith(`${SAMPLE_HOME}/`) ? `~${path.slice(SAMPLE_HOME.length)}` : path;
  const dir = `/${storedName}/SKILL.md`;
  if (tilde.endsWith(dir)) return `${tilde.slice(0, tilde.length - dir.length)}/${slug}.md`;
  const file = /\.[a-z]+$/.exec(tilde)?.[0] ?? '';
  const named = `/${storedName}${file}`;
  return tilde.endsWith(named) ? `${tilde.slice(0, tilde.length - named.length)}/${slug}${file}` : tilde;
}

const FOLDER: Readonly<Record<InterfaceId, string>> = Object.freeze({ 'claude-code': '.claude', codex: '.codex', opencode: '.opencode', hermes: '.hermes', bowerloom: '.bowerloom' });
const HOME_FOLDER = '~/Studio';
/** The file that holds a program's connections. A table with a key for every program, so a program added to the list fails the typecheck until it has its file. */
const CONNECTIONS_FILE: Readonly<Record<InterfaceId, string>> = Object.freeze({
  'claude-code': '.claude/connections.json', codex: '.codex/config.toml', opencode: 'opencode.json', hermes: '.hermes/config.yaml', bowerloom: '.bowerloom/connections.json',
});

/**
 * Where a thing that has no path of its own in the sample (one added from the web or kept as a copy in this preview, or a ready-made agent) would be kept in a program,
 * written the way the sample world writes its own: in the home folder of the Studio, or, for a ready-made one, in the cache of its library.
 */
function keptPath(item: HarnessItem, face: InterfaceId, slug: string): string {
  const dir = item.kind === 'skill' ? 'skills' : item.kind === 'agent' ? 'agents' : item.kind === 'tool' && item.toolKind === 'prompt' ? (face === 'codex' ? 'prompts' : 'commands') : '';
  if (item.library !== null) return `~/.cache/evergreen-kit/${item.library.pinnedVersion}/${dir === '' ? 'tools' : dir}/${slug}.md`;
  if (item.kind === 'tool' && item.toolKind === 'mcp') return `${HOME_FOLDER}/${CONNECTIONS_FILE[face]}`;
  if (item.kind === 'tool' && item.toolKind === 'hook') return `${HOME_FOLDER}/${FOLDER[face]}/settings.json`;
  return `${HOME_FOLDER}/${FOLDER[face]}/${dir}/${slug}.${item.kind === 'agent' && face === 'codex' ? 'toml' : 'md'}`;
}

/** The places of an item, one for each program that holds it, in the order the details show the programs. */
export function placesOfItem(item: HarnessItem, plainName: string): Place[] {
  // An item from the person's own setup has its real paths (the home folder written "~"), never a sample path.
  const real = realPlacesOf(item);
  if (real !== null) return real;
  const out: Place[] = [];
  for (const program of PROGRAM_ORDER) {
    const found = item.foundAt.find(f => f.interface === program);
    if (found === undefined) continue;
    // A server is kept in a file that holds other servers too; its name carries a technical word that no screen may say, so the sample writes its own file name for it.
    const own = found.path.startsWith('/') && !(item.kind === 'tool' && item.toolKind === 'mcp');
    const path = own ? samplePath(found.path, item.name, plainName) : keptPath(item, program, slugOf(plainName));
    out.push({ app: PROGRAM_NAMES[program], path });
  }
  return out;
}

/** The places of the agent, skill or tool with this id in a world, or an empty list when it is not there (a set of notes lives in no file). */
export function placesOf(world: World, kind: 'agent' | 'skill' | 'tool' | 'note', id: string, plainName: string): Place[] {
  if (kind === 'note') return [];
  const item = world.items.find(i => i.id === id && i.kind === kind);
  return item === undefined ? [] : placesOfItem(item, plainName);
}
