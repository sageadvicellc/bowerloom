/**
 * Adoption of a 0.7 team (section 9, decisions 4 and 5). It reads a 0.7 team folder and writes a `team.json` by copy.
 * The 0.7 files keep every byte.
 *
 * - The 0.7 schema has no engine field, so a person picks the engine of each owner. Bowerloom never guesses one.
 * - `modelClass` has no engine mapping. It stays in the member's `x-crew-v0.7` block, and a person names one explicit
 *   model per member.
 * - The 0.7 tasks, with their outputs and acceptance, stay in the team's `x-crew-v0.7` block.
 * - Every 0.7 entry of the folder (`team.yaml`, `prompts/`, `agents/`, `skills/`, `assets/`, `maps/vines.json`) is
 *   copied byte for byte under `x-crew-v0.7/`. What cannot be copied is listed in `notCarried`, and the plan waits for
 *   a person to acknowledge it (ruling T9).
 * - Every derived value is listed in `defaults`. The 0.7 permissions and scope become no guardrail: `notMapped` says so,
 *   and the plan waits for an acknowledgement (ruling T11).
 * - Answers are checked at once, while other questions are open (ruling T17). A 0.7 id that is not a 0.8 id is a
 *   rename question (ruling T19).
 *
 * `planTeamAdoption` reads only. `applyTeamAdoption` plans again, writes only when the revision is the same, creates
 * files only (never replaces one), writes `team.json` last, and checks that the team loads and the 0.7 files are
 * unchanged. On any failure it removes what it wrote, and reports anything it could not remove.
 */
import fs from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalJson, DefinitionError, type CrewDefinition } from '../../contracts/src/index.js';
import { parseCrew } from '../../crew/src/index.js';
import { ENGINE_IDS, isEngineId, isId, safeName, type DefinitionFile, type JsonValue } from '../../harness-definition/src/index.js';
import { decodeText } from '../../harness-definition/src/json.js';
import {
  PortableRefusal, checkAncestors, makeDir, readAbs, removeEmptyDirs, sha, writeAbs,
} from '../../project-sync/src/portable-files.js';
import { confineFolder } from './folders.js';
import { loadTeam, plainName } from './load.js';
import { finish, plain, shown, type TeamProblem } from './messages.js';
import { normalizeFolder } from './scan.js';
import { MODEL_NAME } from './schema.js';
import type { TeamFile } from './types.js';
import { scanFiles, validateTeam } from './validate.js';
import {
  CREW_BLOCK, HUMAN, INBOX_MODES, MODEL_CLASSES, RELAY_MAP_PATH, START_MODES, TEAM_FORMAT, TEAM_LEGACY_NAMES, TEAM_LIMITS,
} from './words.js';

/** A person's answer for one 0.7 owner. Only `engine` and `model` have no default. `id` renames the owner. */
export interface MemberAnswer {
  readonly id?: string;
  readonly engine?: string;
  readonly model?: string;
  readonly harness?: string;
  readonly folder?: string;
  readonly start?: string;
  readonly inbox?: string;
  readonly reports_to?: string;
  readonly purpose?: string;
}
export interface AdoptionAnswers {
  /** A new team id, when the 0.7 id is not a valid 0.8 id. */
  readonly id?: string;
  /** The default harness id of the team. */
  readonly harness?: string;
  /** A one-line description, when the 0.7 description does not fit on one line of 1024 characters. */
  readonly description?: string;
  /** Answers by 0.7 owner id. */
  readonly members?: Readonly<Record<string, MemberAnswer>>;
}
export interface AdoptionInput {
  /** The absolute path of the 0.7 team folder, which holds `team.yaml`. */
  readonly source: string;
  /** The absolute path of the 0.8 team folder, `<project>/.bowerloom/teams/<id>`. It can be the source folder. */
  readonly target: string;
  readonly answers?: AdoptionAnswers;
  /** The ids of the `notCarried` and `notMapped` items a person has read and accepts. */
  readonly acknowledged?: readonly string[];
  /** The home folder, for folder confinement (ruling T1). Default: the user's home folder. */
  readonly home?: string;
}

/** A question for a person. A plan is not ready while one is open. */
export interface AdoptionQuestion {
  readonly id: string;
  readonly kind: 'engine' | 'model' | 'harness' | 'purpose' | 'description' | 'rename';
  readonly owner?: string;
  readonly ask: string;
  readonly choices?: readonly string[];
  /** The 0.7 model class of the owner, as context for a model question. Never a default. */
  readonly modelClass?: string;
}
/** A value the plan chose or derived because no answer gave one. A person sees each one. */
export interface AdoptionDefault {
  /** The member, or null for a team value. */
  readonly member: string | null;
  readonly field: 'folder' | 'start' | 'inbox' | 'reports_to' | 'purpose' | 'description' | 'limits.activeMembers';
  readonly value: string;
  readonly reason: string;
}
/** Something of the 0.7 team that adoption does not carry or does not map. A person acknowledges each by its id. */
export interface AdoptionNotice {
  readonly id: string;
  readonly path?: string;
  readonly what?: string;
  readonly reason: string;
}
export interface AdoptionWrite {
  /** The path relative to the target folder. */
  readonly path: string;
  readonly kind: 'new' | 'copy';
  /** For a copy, the path relative to the source folder. */
  readonly from?: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface AdoptionPlan {
  readonly ready: boolean;
  readonly questions: readonly AdoptionQuestion[];
  readonly problems: readonly TeamProblem[];
  readonly defaults: readonly AdoptionDefault[];
  /** 0.7 entries adoption does not copy, with why. The plan is not ready until each is acknowledged. */
  readonly notCarried: readonly AdoptionNotice[];
  /** 0.7 meanings that adoption keeps as a record only, with why. The plan is not ready until each is acknowledged. */
  readonly notMapped: readonly AdoptionNotice[];
  readonly writes: readonly AdoptionWrite[];
  /** The 0.7 files and their hashes. Apply checks that they are unchanged. */
  readonly originals: readonly { readonly path: string; readonly sha256: string }[];
  /** The team that apply writes, or null while a question is open or a problem stands. */
  readonly team: TeamFile | null;
  /** The revision of the written team folder, as `loadTeam` computes it. */
  readonly teamRevision: string | null;
  /** The plan revision. A person approves it, and apply writes only when it is the same. */
  readonly revision: string;
  readonly writesAuthorized: false;
}
export type AdoptionApplyResult =
  | { readonly ok: true; readonly written: readonly string[] }
  | { readonly ok: false; readonly problems: readonly TeamProblem[] };
/** Test hooks. `beforeApply` runs after the revision check; `afterWrite` runs after each file is written. */
export interface AdoptionHooks {
  readonly beforeApply?: () => void;
  readonly afterWrite?: (path: string) => void;
}

const MEMBER_ANSWER_KEYS = ['id', 'engine', 'model', 'harness', 'folder', 'start', 'inbox', 'reports_to', 'purpose'];
const ANSWER_KEYS = ['id', 'harness', 'description', 'members'];
const DEFAULTS: readonly (readonly ['folder' | 'start' | 'inbox' | 'reports_to', string, string])[] = [
  ['folder', '.', 'The project folder. A member that shares an engine with another member on another harness needs its own worktree.'],
  ['start', 'manual', 'A person starts the instance, so every approval reaches a person (decision 9).'],
  ['inbox', 'hold', 'Arriving messages wait. Bowerloom 0.8 has no relay bus (decision 7).'],
  ['reports_to', HUMAN, 'A 0.7 owner reports to no one, so the member reports to a person.'],
];
const PERMISSIONS_NOTICE: AdoptionNotice = {
  id: 'owner-permissions',
  what: 'owner permissions and scope are kept in x-crew-v0.7, not enforced; no team guardrail is created',
  reason: 'The 0.7 permissions and scope are path and command effects with no neutral guardrail form. Add team guardrails by hand if the team needs them.',
};
const fits = (text: string) => text !== '' && [...text].length <= 1024 && !/[\p{Cc}\p{Cf}]/u.test(text);
const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
type Add = (code: string, message: string, path?: string) => void;

interface SourceRead {
  readonly yaml: Buffer | null;
  readonly relay: Buffer | null;
  /** 0.7 entries to copy under x-crew-v0.7, by their path in the source. */
  readonly carried: readonly { readonly rel: string; readonly bytes: Buffer }[];
  readonly notCarried: readonly AdoptionNotice[];
}
interface Built { readonly plan: AdoptionPlan; readonly bytes: ReadonlyMap<string, Buffer>; readonly source: string; readonly target: string }

/** Plans the adoption. It reads the 0.7 folder and the target folder, and writes nothing. */
export function planTeamAdoption(input: AdoptionInput): AdoptionPlan {
  return build(input).plan;
}

function build(input: AdoptionInput): Built {
  const problems: TeamProblem[] = [];
  const add: Add = (code, message, path = 'team.yaml') => { problems.push({ code, path, message }); };
  const questions: AdoptionQuestion[] = [];
  const defaults: AdoptionDefault[] = [];
  const notMapped: AdoptionNotice[] = [];
  const originals: { path: string; sha256: string }[] = [];
  const bytes = new Map<string, Buffer>();
  const writes: AdoptionWrite[] = [];
  let notCarried: readonly AdoptionNotice[] = [];
  let team: TeamFile | null = null;
  let teamRevision: string | null = null;
  const source = typeof input?.source === 'string' && isAbsolute(input.source) ? resolve(input.source) : '';
  const target = typeof input?.target === 'string' && isAbsolute(input.target) ? resolve(input.target) : '';
  const acknowledged = new Set(Array.isArray(input?.acknowledged) ? input.acknowledged.filter(a => typeof a === 'string') : []);
  const finishPlan = (): Built => {
    const open = [...notCarried, ...notMapped].filter(n => !acknowledged.has(n.id));
    const checked = finish(problems);
    const ready = questions.length === 0 && checked.length === 0 && team !== null && open.length === 0;
    const body = { source, target, originals, questions, problems: checked, defaults, notCarried, notMapped, writes, team, teamRevision, ready };
    return { plan: { ...body, revision: `sha256:${sha(canonicalJson(body))}`, writesAuthorized: false }, bytes, source, target };
  };
  if (!source || !target) { add('TEAM_ADOPT_USAGE', 'source and target must be absolute paths of team folders.', '.'); return finishPlan(); }
  if (basename(dirname(target)) !== 'teams' || basename(dirname(dirname(target))) !== '.bowerloom') {
    add('TEAM_ADOPT_USAGE', 'The target must be a team folder of a project: <project>/.bowerloom/teams/<id>.', '.');
    return finishPlan();
  }
  const project = dirname(dirname(dirname(target)));
  const same = sameFolder(source, target);

  // The 0.7 folder.
  const read = readSource(source, add);
  notCarried = read.notCarried;
  if (read.yaml === null) { if (!problems.length) add('TEAM_ADOPT_SOURCE_MISSING', 'The source folder has no team.yaml.'); return finishPlan(); }
  const yaml = read.yaml, relay = read.relay;
  originals.push({ path: 'team.yaml', sha256: sha(yaml) });
  if (relay) originals.push({ path: RELAY_MAP_PATH, sha256: sha(relay) });
  for (const c of read.carried) originals.push({ path: c.rel, sha256: sha(c.bytes) });
  const sourceFiles: DefinitionFile[] = [
    { path: 'team.yaml', bytes: yaml }, ...(relay ? [{ path: RELAY_MAP_PATH, bytes: relay }] : []), ...read.carried.map(c => ({ path: c.rel, bytes: c.bytes })),
  ];
  if (problems.length) { problems.push(...scanFiles(sourceFiles)); return finishPlan(); }

  let crew: CrewDefinition;
  try {
    const text = decodeText(yaml);
    if (text === null) throw new DefinitionError('INVALID_ENCODING', 'not UTF-8');
    crew = parseCrew(text);
  } catch (error) {
    if (!(error instanceof DefinitionError)) throw error;
    add('TEAM_ADOPT_SOURCE_INVALID', `team.yaml is not a valid 0.7 crew file (trellis/crew/v0.7-alpha): ${error.code}.`);
    problems.push(...scanFiles(sourceFiles));
    return finishPlan();
  }

  // Answers (ruling T17): every answered field is checked now.
  const answers: AdoptionAnswers = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const memberAnswers: Readonly<Record<string, MemberAnswer>> = answers.members && typeof answers.members === 'object' ? answers.members : {};
  checkAnswers(answers, memberAnswers, crew, project, input.home, add);
  for (const id of acknowledged) {
    if (![...notCarried, ...(ownerRestrictions(crew) ? [PERMISSIONS_NOTICE] : [])].some(n => n.id === id)) {
      add('TEAM_ADOPT_ANSWER', `acknowledged names ${safeName(id)}, which is not a notCarried or notMapped item of this plan.`, 'acknowledged');
    }
  }

  // Questions and derived values.
  const teamId = answers.id ?? crew.id;
  if (answers.id === undefined && !isId(crew.id)) {
    questions.push({ id: 'rename:team', kind: 'rename', ask: `The 0.7 team id ${safeName(crew.id)} is not a valid 0.8 id: lowercase letters, digits, and single hyphens. Give the team a new id. The target folder name must equal it.` });
  }
  if (answers.harness === undefined) questions.push({ id: 'harness', kind: 'harness', ask: 'Which harness do the members use by default? A member can name its own (decision 10).' });
  const description = answers.description ?? plain(crew.description);
  if (answers.description === undefined) {
    if (!fits(description)) questions.push({ id: 'description', kind: 'description', ask: 'The 0.7 description does not fit on one line of 1024 characters. Write one sentence on what the team is for.' });
    else defaults.push({ member: null, field: 'description', value: shown(description) ?? '(a value not shown)', reason: 'The 0.7 description, on one line.' });
  }
  defaults.push({ member: null, field: 'limits.activeMembers', value: String(crew.budget.maxActiveWorkers), reason: 'The 0.7 budget.maxActiveWorkers.' });
  if (ownerRestrictions(crew)) notMapped.push(PERMISSIONS_NOTICE);

  const idOf = new Map<string, string>();
  const members: Record<string, JsonValue>[] = [];
  for (const owner of crew.owners) {
    const a: MemberAnswer = memberAnswers[owner.id] ?? {};
    const name = safeName(owner.id);
    const role = shown(plain(owner.role).slice(0, 120));
    const about = role ? ` (${role})` : '';
    idOf.set(owner.id, a.id ?? owner.id);
    if (a.id === undefined && !isId(owner.id)) {
      questions.push({ id: `rename:${owner.id}`, kind: 'rename', owner: owner.id, ask: `The 0.7 owner id ${name} is not a valid 0.8 id: lowercase letters, digits, and single hyphens. Give the member a new id.` });
    }
    if (a.engine === undefined) {
      questions.push({ id: `engine:${owner.id}`, kind: 'engine', owner: owner.id, choices: ENGINE_IDS, ask: `Which engine runs the owner ${name}${about}? The 0.7 file names no engine, so Bowerloom does not guess.` });
    }
    if (a.model === undefined) {
      questions.push({ id: `model:${owner.id}`, kind: 'model', owner: owner.id, modelClass: owner.modelClass, ask: `Name one explicit model for ${name} on its engine. In 0.7 it had the model class ${owner.modelClass}, which maps to no model (decision 5).` });
    }
    const chosen: Record<string, string> = {};
    for (const [field, value, reason] of DEFAULTS) {
      const given = a[field];
      if (given === undefined) { chosen[field] = value; defaults.push({ member: owner.id, field, value, reason }); } else chosen[field] = given;
    }
    if (a.folder === undefined) {
      const place = confineFolder(project, '.', { mustExist: false, ...(input.home !== undefined ? { home: input.home } : {}) });
      if (!place.ok) add(place.code, `The default folder of ${name}, the project folder, ${place.message}. Answer a folder for it.`, 'answers');
    }
    const purpose = a.purpose ?? plain(owner.role);
    if (a.purpose === undefined) {
      if (!fits(purpose)) questions.push({ id: `purpose:${owner.id}`, kind: 'purpose', owner: owner.id, ask: `The 0.7 role of ${name} does not fit on one line. Write one sentence on what this member does.` });
      else defaults.push({ member: owner.id, field: 'purpose', value: shown(purpose) ?? '(a value not shown)', reason: 'The 0.7 role, on one line.' });
    }
    const { id: _id, ...kept } = owner;
    members.push({
      id: a.id ?? owner.id, purpose, engine: a.engine ?? '', ...(a.harness !== undefined ? { harness: a.harness } : {}), model: a.model ?? '',
      folder: chosen.folder!, start: chosen.start!, inbox: chosen.inbox!, reports_to: chosen.reports_to!, [CREW_BLOCK]: kept as unknown as JsonValue,
    });
  }

  // The relay map: a renamed participant needs a new map (ruling T19).
  let newRelay: Buffer | null = null;
  if (relay && [...idOf].some(([from, to]) => from !== to)) {
    const parsedRelay = parseRelay(relay);
    if (parsedRelay) {
      const rename = (id: string) => idOf.get(id) ?? id;
      const map = { ...parsedRelay, participants: parsedRelay.participants.map(rename), routes: parsedRelay.routes.map(r => ({ ...r, fromOwner: rename(r.fromOwner), toOwner: rename(r.toOwner) })) };
      newRelay = Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8');
      if (same) add('TEAM_ADOPT_RENAME_IN_PLACE', 'A renamed member is named in maps/relay.json, which adoption in place cannot change. Adopt into another team folder.', RELAY_MAP_PATH);
    }
  }

  // The target folder.
  targetCheck(target, same, add);
  if (same && read.notCarried.length) {
    add('TEAM_ADOPT_IN_PLACE_BLOCKED', 'The folder holds entries a team folder refuses (see notCarried). In place they would stay and the team would not load. Move them, or adopt into another team folder.', '.');
  }

  if (questions.length || problems.length) {
    problems.push(...scanFiles(sourceFiles));
    return finishPlan();
  }

  const { owners: _owners, id: _crewId, format, description: crewDescription, ...rest } = crew;
  const teamJson = {
    format: TEAM_FORMAT, id: teamId, description, harness: answers.harness!, members,
    ...(relay ? { routes: RELAY_MAP_PATH } : {}),
    limits: { activeMembers: crew.budget.maxActiveWorkers },
    [CREW_BLOCK]: { format, id: crew.id, description: crewDescription, ...rest },
  };
  const teamBytes = Buffer.from(JSON.stringify(teamJson, null, 2) + '\n', 'utf8');
  const write = (path: string, data: Buffer, kind: 'new' | 'copy', from?: string) => {
    bytes.set(path, data);
    writes.push({ path, kind, ...(from !== undefined ? { from } : {}), sha256: sha(data), bytes: data.length });
  };
  write(`${CREW_BLOCK}/team.yaml`, yaml, 'copy', 'team.yaml');
  for (const c of read.carried) write(`${CREW_BLOCK}/${c.rel}`, c.bytes, 'copy', c.rel);
  if (relay && newRelay) { write(`${CREW_BLOCK}/${RELAY_MAP_PATH}`, relay, 'copy', RELAY_MAP_PATH); write(RELAY_MAP_PATH, newRelay, 'new'); }
  else if (relay && !same) write(RELAY_MAP_PATH, relay, 'copy', RELAY_MAP_PATH);
  write('team.json', teamBytes, 'new');

  // What the target folder holds after apply, as the loader reads it (ruling T10).
  const files: DefinitionFile[] = writes.map(w => ({ path: w.path, bytes: bytes.get(w.path)! }));
  if (same) files.push(...sourceFiles);
  const checked = validateTeam(files, { folderName: basename(target) });
  if (checked.ok) { team = checked.team.file; teamRevision = checked.team.revision; } else { problems.push(...checked.problems); writes.splice(0); }
  return finishPlan();
}

function ownerRestrictions(crew: CrewDefinition): boolean {
  return crew.scope.length > 0 || crew.owners.some(o => o.permissions.length > 0);
}

function parseRelay(relay: Buffer): { participants: string[]; routes: { fromOwner: string; toOwner: string }[] } | null {
  try {
    const v = JSON.parse(relay.toString('utf8')) as { participants?: unknown; routes?: unknown };
    return Array.isArray(v.participants) && Array.isArray(v.routes) ? v as { participants: string[]; routes: { fromOwner: string; toOwner: string }[] } : null;
  } catch { return null; }
}

/** Checks each answered field at once, with the codes the loader uses (ruling T17). */
function checkAnswers(answers: AdoptionAnswers, members: Readonly<Record<string, MemberAnswer>>, crew: CrewDefinition, project: string, home: string | undefined, add: Add): void {
  const at = 'answers';
  if (typeof answers !== 'object' || Object.keys(answers).some(k => !ANSWER_KEYS.includes(k))) add('TEAM_ADOPT_ANSWER', `The answers hold a field that is not known. The fields are ${ANSWER_KEYS.join(', ')}.`, at);
  if (answers.id !== undefined && !isId(answers.id)) add('TEAM_INVALID_ID', 'The answered team id must be lowercase letters, digits, and single hyphens.', at);
  if (answers.harness !== undefined && !isId(answers.harness)) add('TEAM_INVALID_ID', 'The answered harness must be a harness id: lowercase letters, digits, and single hyphens.', at);
  if (answers.description !== undefined && !(typeof answers.description === 'string' && fits(answers.description))) add('TEAM_INVALID_FIELD', 'The answered description must be one line of 1 to 1024 characters with no control or format characters.', at);
  const owners = new Set(crew.owners.map(o => o.id));
  const newIds = new Set(crew.owners.map(o => members[o.id]?.id ?? o.id));
  for (const [owner, a] of Object.entries(members)) {
    const who = safeName(owner);
    if (!owners.has(owner)) { add('TEAM_ADOPT_UNKNOWN_OWNER', `The answers name ${who}, which is not an owner of the 0.7 team.`, at); continue; }
    if (a === null || typeof a !== 'object' || Object.keys(a).some(k => !MEMBER_ANSWER_KEYS.includes(k))) {
      add('TEAM_ADOPT_ANSWER', `The answer for ${who} holds a field that is not known. The fields are ${MEMBER_ANSWER_KEYS.join(', ')}.`, at);
      continue;
    }
    if (MEMBER_ANSWER_KEYS.some(k => (a as Record<string, unknown>)[k] !== undefined && typeof (a as Record<string, unknown>)[k] !== 'string')) { add('TEAM_ADOPT_ANSWER', `Each answer for ${who} must be text.`, at); continue; }
    if (a.id !== undefined && !isId(a.id)) add('TEAM_INVALID_ID', `The new id for ${who} must be lowercase letters, digits, and single hyphens.`, at);
    if (a.engine !== undefined && !isEngineId(a.engine)) add('TEAM_ADOPT_ANSWER', `The engine for ${who} must be one of ${ENGINE_IDS.join(', ')}.`, at);
    if (a.model !== undefined) {
      if (!MODEL_NAME.test(a.model)) add('TEAM_INVALID_FIELD', `The model for ${who} must be one model name: a letter or digit, then letters, digits, or . _ : / @ + -.`, at);
      else if ((MODEL_CLASSES as readonly string[]).includes(a.model.toLowerCase())) add('TEAM_MODEL_CLASS', `The model for ${who} is a 0.7 model class, not a model. Name one explicit model (decision 5).`, at);
    }
    if (a.harness !== undefined && !isId(a.harness)) add('TEAM_INVALID_ID', `The harness for ${who} must be a harness id.`, at);
    if (a.folder !== undefined) {
      if (normalizeFolder(a.folder) === null) add('TEAM_FOLDER_INVALID', `The folder for ${who} must be inside the project, or exactly one level beside it as ../<name>.`, at);
      else {
        const place = confineFolder(project, a.folder, { mustExist: false, ...(home !== undefined ? { home } : {}) });
        if (!place.ok) add(place.code, `The folder for ${who} ${place.message}.`, at);
      }
    }
    if (a.start !== undefined && !(START_MODES as readonly string[]).includes(a.start)) add('TEAM_INVALID_FIELD', `The start for ${who} must be ${START_MODES.join(', ')}.`, at);
    if (a.inbox !== undefined && !(INBOX_MODES as readonly string[]).includes(a.inbox)) add('TEAM_INVALID_FIELD', `The inbox for ${who} must be ${INBOX_MODES.join(', ')}.`, at);
    if (a.reports_to !== undefined && a.reports_to !== HUMAN && !newIds.has(a.reports_to)) add('TEAM_REPORTS_TO', `The reports_to of ${who} must be another member id, or human.`, at);
    if (a.purpose !== undefined && !fits(a.purpose)) add('TEAM_INVALID_FIELD', `The purpose for ${who} must be one line of 1 to 1024 characters with no control or format characters.`, at);
  }
}

/**
 * Reads the 0.7 folder. `team.yaml` and `maps/relay.json` are read; every other 0.7 entry is collected to copy. An
 * entry that is not a 0.7 entry, is a link, has a name that is not plain, cannot be read, or is too deep is listed in
 * `notCarried` with its reason (ruling T9).
 */
function readSource(source: string, add: Add): SourceRead {
  const carried: { rel: string; bytes: Buffer }[] = [];
  const notCarried: AdoptionNotice[] = [];
  const skip = (path: string, reason: string) => { notCarried.push({ id: `carry:${path}`, path, reason }); };
  let count = 0;
  let yaml: Buffer | null = null, relay: Buffer | null = null;
  const readFile = (rel: string): Buffer | null => {
    try {
      const r = readAbs(join(source, rel), rel);
      if (r) return r.bytes;
      skip(rel, 'It went away while adoption read it.');
    } catch (error) {
      if (!(error instanceof PortableRefusal)) throw error;
      skip(rel, 'It is not a plain file of yours, has more than one link, is larger than 1 MiB, or cannot be read.');
    }
    return null;
  };
  const list = (rel: string): string[] => {
    let names: string[];
    try { names = fs.readdirSync(rel === '.' ? source : join(source, rel)).sort(); } catch (e) { skip(rel, `The folder cannot be read (${errno(e) ?? 'unknown error'}).`); return []; }
    let hidden = 0;
    return names.filter(n => {
      if (plainName(n)) return true;
      skip(`${rel === '.' ? '' : `${rel}/`}#${++hidden}`, 'Its name is not plain or looks like a secret, so it is not shown or copied.');
      return false;
    });
  };
  const walk = (rel: string, depth: number): void => {
    let st: fs.Stats;
    try { st = fs.lstatSync(join(source, rel)); } catch (e) { skip(rel, `It cannot be read (${errno(e) ?? 'unknown error'}).`); return; }
    if (st.isSymbolicLink()) { skip(rel, 'It is a link. Adoption copies plain files only.'); return; }
    if (st.isDirectory()) {
      if (depth > TEAM_LIMITS.keptDepth) { skip(rel, `It is deeper than ${TEAM_LIMITS.keptDepth} folders.`); return; }
      for (const n of list(rel)) walk(`${rel}/${n}`, depth + 1);
      return;
    }
    if (!st.isFile()) { skip(rel, 'It is not a plain file.'); return; }
    if (++count > TEAM_LIMITS.files) { skip(rel, `The 0.7 folder holds more than ${TEAM_LIMITS.files} files.`); return; }
    const b = readFile(rel);
    if (b) carried.push({ rel, bytes: b });
  };

  try {
    const st = fs.lstatSync(source);
    if (st.isSymbolicLink() || !st.isDirectory()) { add('TEAM_FILE_UNSAFE', 'The source folder is a link or not a folder.', '.'); return { yaml, relay, carried, notCarried }; }
  } catch (e) {
    if (errno(e) === 'ENOENT') add('TEAM_ADOPT_SOURCE_MISSING', 'The source folder does not exist.', '.');
    else add('TEAM_FILE_UNREADABLE', `The source folder cannot be read (${errno(e) ?? 'unknown error'}).`, '.');
    return { yaml, relay, carried, notCarried };
  }
  for (const name of list('.')) {
    if (name === 'team.yaml') {
      const st = fs.lstatSync(join(source, name));
      if (st.isSymbolicLink() || !st.isFile()) add('TEAM_FILE_UNSAFE', 'team.yaml is a link or not a plain file.', name);
      else { try { yaml = readAbs(join(source, name), name)?.bytes ?? null; } catch (error) { if (!(error instanceof PortableRefusal)) throw error; add('TEAM_FILE_UNSAFE', 'team.yaml is not a plain file of yours, has more than one link, or is larger than 1 MiB.', name); } }
    } else if (name === 'maps') {
      const st = fs.lstatSync(join(source, name));
      if (st.isSymbolicLink() || !st.isDirectory()) { skip('maps', 'It is a link or not a folder.'); continue; }
      for (const n of list('maps')) {
        const rel = `maps/${n}`;
        if (n === 'relay.json') {
          const s2 = fs.lstatSync(join(source, rel));
          if (s2.isSymbolicLink() || !s2.isFile()) { add('TEAM_FILE_UNSAFE', 'maps/relay.json is a link or not a plain file.', rel); continue; }
          try { relay = readAbs(join(source, rel), rel)?.bytes ?? null; } catch (error) { if (!(error instanceof PortableRefusal)) throw error; add('TEAM_FILE_UNSAFE', 'maps/relay.json is not a plain file of yours, has more than one link, or is larger than 1 MiB.', rel); }
        } else if (n === 'vines.json') walk(rel, 2);
        else skip(rel, 'It is not a 0.7 map. maps/ holds relay.json and vines.json.');
      }
    } else if ((TEAM_LEGACY_NAMES as readonly string[]).includes(name)) walk(name, 1);
    else if (name === 'team.json' || name === CREW_BLOCK) continue;
    else skip(name, 'It is not an entry of a 0.7 team folder.');
  }
  return { yaml, relay, carried, notCarried };
}

function realOrResolved(abs: string): string {
  try { return fs.realpathSync(abs); } catch { try { return join(fs.realpathSync(dirname(abs)), basename(abs)); } catch { return abs; } }
}
function sameFolder(a: string, b: string): boolean {
  return realOrResolved(a) === realOrResolved(b);
}

/** The target must be a real folder, or a new one in a real folder, and hold no team yet. */
function targetCheck(target: string, same: boolean, add: Add): void {
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(target); } catch (e) {
    if (errno(e) !== 'ENOENT') { add('TEAM_FILE_UNREADABLE', `The target folder cannot be read (${errno(e) ?? 'unknown error'}).`, '.'); return; }
  }
  if (st === null) {
    try { const parent = fs.lstatSync(dirname(target)); if (parent.isDirectory() && !parent.isSymbolicLink()) return; } catch { /* reported below */ }
    add('TEAM_ADOPT_USAGE', 'The teams folder that would hold the target team folder does not exist, or is a link.', '.');
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) { add('TEAM_FILE_UNSAFE', 'The target folder is a link or not a folder.', '.'); return; }
  const taken = ['team.json', CREW_BLOCK, ...(same ? [] : [RELAY_MAP_PATH])].filter(rel => {
    try { fs.lstatSync(join(target, rel)); return true; } catch { return false; }
  });
  if (taken.length) add('TEAM_ADOPT_EXISTS', `The target folder already holds ${taken.join(', ')}. Adoption creates files only and never replaces one.`, taken[0]);
}

class AdoptionFault extends Error {
  constructor(readonly code: string, message: string, readonly label: string, options?: { cause?: unknown }) { super(message, options); }
}
const causeOf = (e: unknown): NonNullable<TeamProblem['cause']> => {
  if (!(e instanceof Error)) return { name: typeof e };
  const code = (e as { code?: unknown }).code;
  return { name: e.name, ...(typeof code === 'string' ? { code } : {}) };
};

/** Writes the planned files when the plan revision is the same, then checks the result. Removes them on failure. */
export function applyTeamAdoption(input: AdoptionInput, revision: string, hooks: AdoptionHooks = {}): AdoptionApplyResult {
  const built = build(input);
  const { plan } = built;
  const refuse = (code: string, message: string): AdoptionApplyResult => ({ ok: false, problems: finish([{ code, path: '.', message }, ...plan.problems]) });
  if (plan.revision !== revision) return refuse('TEAM_ADOPT_REVISION', 'The plan changed since it was approved. Nothing was written. Plan again.');
  if (!plan.ready) return refuse('TEAM_ADOPT_NOT_READY', 'The plan has open questions, problems, or items to acknowledge. Nothing was written.');
  const name = basename(built.target);
  const created: string[] = [];
  const written: { abs: string; rel: string }[] = [];
  let root = '';
  let label = '.';
  try {
    hooks.beforeApply?.();
    root = fs.realpathSync(dirname(built.target));
    for (const w of plan.writes) {
      label = w.path;
      const rel = `${name}/${w.path}`;
      for (const dir of checkAncestors(root, rel)) { makeDir(root, dir); created.push(dir); }
      const abs = join(root, rel);
      writeAbs(abs, built.bytes.get(w.path)!, 0o644, { exclusive: true, label: w.path, onPlaced: () => { written.push({ abs, rel: w.path }); } });
      hooks.afterWrite?.(w.path);
    }
    for (const o of plan.originals) {
      label = o.path;
      const now = readAbs(join(built.source, o.path), o.path);
      if (!now || sha(now.bytes) !== o.sha256) throw new AdoptionFault('TEAM_ADOPT_SOURCE_CHANGED', `The 0.7 file ${o.path} changed during adoption.`, o.path);
    }
    label = '.';
    const loaded = loadTeam(built.target);
    if (!loaded.ok || loaded.team.revision !== plan.teamRevision) throw new AdoptionFault('TEAM_ADOPT_VERIFY', 'The written team does not load with the planned revision.', '.');
    return { ok: true, written: plan.writes.map(w => w.path) };
  } catch (error) {
    const fault = error instanceof AdoptionFault ? error
      : new AdoptionFault('TEAM_ADOPT_WRITE_FAILED', `Adoption stopped at ${label}${error instanceof PortableRefusal ? ` (${error.code})` : errno(error) ? ` (${errno(error)})` : ''}.`, label, { cause: error });
    const left: TeamProblem[] = [];
    for (const w of written.reverse()) {
      try { fs.unlinkSync(w.abs); } catch (e) {
        if (errno(e) !== 'ENOENT') left.push({ code: 'TEAM_ADOPT_LEFT_BEHIND', path: w.rel, message: `Adoption wrote ${w.rel} and could not remove it (${errno(e) ?? 'unknown error'}). Remove it by hand.`, cause: causeOf(e) });
      }
    }
    if (root) {
      for (const l of removeEmptyDirs(root, created)) {
        const rel = l.path.startsWith(`${name}/`) ? l.path.slice(name.length + 1) : l.path;
        left.push({ code: 'TEAM_ADOPT_LEFT_BEHIND', path: rel, message: `Adoption made the folder ${rel} and could not remove it (${l.reason}).` });
      }
    }
    const outcome = left.length ? ' Some files or folders adoption wrote are still there; each is listed.' : ' Adoption removed the files it wrote.';
    return {
      ok: false,
      problems: finish([
        { code: fault.code, path: fault.label, message: `${fault.message}${outcome} The 0.7 files were not changed by adoption.`, ...(fault.cause !== undefined ? { cause: causeOf(fault.cause) } : {}) },
        ...left,
      ]),
    };
  }
}
