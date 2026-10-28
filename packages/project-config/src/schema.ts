/**
 * `bowerloom.json`, format `bowerloom/project/v1beta1`: which skills, prompts, and teams a project uses, and from where.
 * The parser is strict and mirrors parseManifest in packages/skill-manifest. This module reads nothing from disk.
 */
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, captureSkillData } from '../../skill-sources/src/validation.js';
import { strictUtf8 } from '../../skill-sources/src/cache.js';
import { OLD_ENGINES_KEY, decodeEngines, engineField, engineKeyOf, engineListProblem, sameForm } from '../../skill-manifest/src/engine.js';
import type { Engine } from '../../skill-manifest/src/engine.js';
import { configRefusal, refuse } from './refusal.js';

export const CONFIG_FILE = 'bowerloom.json' as const;
export const CONFIG_FORMAT = 'bowerloom/project/v1beta1' as const;
export const CONFIG_LIMITS = Object.freeze({ bytes: 1048576, skills: 128, prompts: 128, teams: 32, idLength: 64 });
export type ConfigKind = 'skill' | 'prompt' | 'team';
export type ConfigSource = 'store' | 'project';
export interface ConfigEntry { id: string; source: ConfigSource; via?: string[] }
/**
 * `oldForm` is set on a config read from a file that names its engines the old way (`harnesses`, with `claude`).
 * serializeConfig then writes the same form, so a write-back never changes the spelling of a file Bowerloom did not create.
 */
export interface ProjectConfig { format: typeof CONFIG_FORMAT; engines: Engine[]; skills: ConfigEntry[]; prompts: ConfigEntry[]; teams: ConfigEntry[]; oldForm?: true }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIRST_TEAM = 'first-team';
const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= CONFIG_LIMITS.idLength && ID.test(v);
// Copies of isSkillId, isPromptId, and isTeamId in packages/project-authoring/src/state.ts, so that this package does not
// import project-authoring (spec 06 makes project-authoring import this one). packages/project-authoring/test/id-parity.test.mjs keeps them equal.
export const isStoreSkillId = (v: unknown): v is string => isId(v) && v !== 'personal-assistant' && !v.startsWith('prompt-');
/** `prompt-<id>` is the Codex wrapper's folder name, so a prompt id leaves room for that prefix. */
export const isStorePromptId = (v: unknown): v is string => isId(v) && v.length <= 57;
export const isStoreTeamId = (v: unknown): v is string => isId(v) && v !== FIRST_TEAM;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function invalid(ok: unknown): asserts ok { if (!ok) refuse('CONFIG_INVALID'); }
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const KIND_TEST: Readonly<Record<ConfigKind, (id: unknown) => boolean>> = { skill: isStoreSkillId, prompt: isStorePromptId, team: isStoreTeamId };
const LISTS = [['skills', 'skill'], ['prompts', 'prompt'], ['teams', 'team']] as const;

/** Step 5 for one entry: its keys, id pattern, source, store-id test, and the shape of `via`. */
function entryOf(value: unknown, kind: ConfigKind): ConfigEntry {
  invalid(isRecord(value));
  const keys = Object.keys(value);
  invalid(keys.every(k => k === 'id' || k === 'source' || k === 'via') && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'source'));
  invalid(isId(value.id));
  invalid(value.source === 'store' || value.source === 'project');
  if (value.source === 'store') invalid(KIND_TEST[kind](value.id));
  if (!Object.hasOwn(value, 'via')) return { id: value.id, source: value.source };
  invalid(value.source === 'store' && Array.isArray(value.via) && value.via.length > 0 && value.via.every(isId));
  return { id: value.id, source: value.source, via: [...value.via] as string[] };
}

/** Checks a whole config value, in the order of the spec (size aside). The first failure decides. */
export function validateConfig(value: unknown): ProjectConfig {
  // 1. The top-level keys.
  invalid(isRecord(value));
  const keys = Object.keys(value);
  // The engine list is `engines` (current ids) or `harnesses` (the old name, with `claude`), never both and never neither.
  const engineKey = engineKeyOf(value);
  invalid(engineKey !== null && keys.length === 5 && ['format', engineKey, 'skills', 'prompts', 'teams'].every(k => keys.includes(k)));
  const oldForm = engineKey === OLD_ENGINES_KEY;
  // 2. format.
  invalid(value.format === CONFIG_FORMAT);
  // 3. engines: at least one, sorted, no repeats. An old file takes claude and codex only.
  const problem = engineListProblem(value[engineKey!], oldForm);
  if (problem !== null) throw configRefusal('CONFIG_INVALID', problem);
  const engines = decodeEngines(value[engineKey!], oldForm)!;
  // 4. The list lengths.
  for (const [name] of LISTS) invalid(Array.isArray(value[name]));
  for (const [name] of LISTS) if ((value[name] as unknown[]).length > CONFIG_LIMITS[name]) refuse('CONFIG_LIMIT');
  // 5. Each entry, in the order skills, prompts, teams.
  const lists = {} as Record<'skills' | 'prompts' | 'teams', ConfigEntry[]>;
  for (const [name, kind] of LISTS) lists[name] = (value[name] as unknown[]).map(entry => entryOf(entry, kind));
  // 6. The sort order of each list, and of each `via`. Equal ids sit side by side and are left to step 7.
  for (const [name] of LISTS) {
    const list = lists[name];
    for (let i = 1; i < list.length; i++) invalid(compare(list[i - 1]!.id, list[i]!.id) <= 0);
    for (const entry of list) if (entry.via) for (let i = 1; i < entry.via.length; i++) invalid(compare(entry.via[i - 1]!, entry.via[i]!) < 0);
  }
  // 7. Duplicates.
  for (const [name, kind] of LISTS) {
    const list = lists[name];
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1]!.id !== list[i]!.id) continue;
      const id = list[i]!.id;
      refuse('CONFIG_DUPLICATE_ID', list[i - 1]!.source === list[i]!.source ? `bowerloom.json lists ${kind} ${id} twice.` : `bowerloom.json lists ${kind} ${id} twice: once from store and once from project.`);
    }
  }
  // 8. Each `via` id names a store team.
  const storeTeams = new Set(lists.teams.filter(t => t.source === 'store').map(t => t.id));
  for (const [name] of LISTS) for (const entry of lists[name]) for (const via of entry.via ?? []) invalid(storeTeams.has(via));
  return { format: CONFIG_FORMAT, engines, skills: lists.skills, prompts: lists.prompts, teams: lists.teams, ...(oldForm ? { oldForm: true as const } : {}) };
}

/** Strict parse: at most 1 MiB of UTF-8 with no byte order mark and no duplicate or unknown keys. */
export function parseConfig(bytes: Buffer): ProjectConfig {
  invalid(Buffer.isBuffer(bytes));
  if (bytes.length > CONFIG_LIMITS.bytes) refuse('CONFIG_LIMIT');
  invalid(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
  const text = strictUtf8(bytes); invalid(text !== null);
  let value: unknown;
  try { value = captureSkillData(strictJson(text, CONFIG_LIMITS.bytes)); }
  catch (error) { if (error instanceof AdapterError || error instanceof SkillSourceError) return refuse('CONFIG_INVALID'); throw error; }
  return validateConfig(value);
}

const entryOut = (e: ConfigEntry): ConfigEntry => ({ id: e.id, source: e.source, ...(e.via ? { via: [...e.via] } : {}) });
/** Canonical bytes: the key order of the format, two-space indent, and a final newline. The result is parsed back before it is returned. */
export function serializeConfig(config: ProjectConfig): string {
  invalid(isRecord(config) && Array.isArray(config.engines) && Array.isArray(config.skills) && Array.isArray(config.prompts) && Array.isArray(config.teams));
  const text = `${JSON.stringify({ format: config.format, ...engineField(config.engines, config), skills: config.skills.map(entryOut), prompts: config.prompts.map(entryOut), teams: config.teams.map(entryOut) }, null, 2)}\n`;
  parseConfig(Buffer.from(text));
  return text;
}

/**
 * The bytes of a config that replaces `before` (null when the file does not exist yet). The form of the file is kept: a
 * config rebuilt without the `oldForm` mark of an old file, or with a mark the file never had, is refused, so no write
 * can change the spelling of a file that Bowerloom did not create.
 */
export function serializeConfigFrom(before: ProjectConfig | null, next: ProjectConfig): string {
  if (!sameForm(before, next)) refuse('CONFIG_INVALID');
  return serializeConfig(next);
}
