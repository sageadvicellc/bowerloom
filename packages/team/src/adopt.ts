/**
 * Adoption of a 0.7 team (section 9, decisions 4 and 5). It reads `team.yaml` and `maps/relay.json` and writes a
 * `team.json` by copy. The 0.7 files keep every byte.
 *
 * - The 0.7 schema has no engine field, so a person picks the engine of each owner. Bowerloom never guesses one.
 * - `modelClass` has no engine mapping. It stays in the member's `x-crew-v0.7` block, and a person names one explicit
 *   model per member.
 * - The 0.7 tasks, with their outputs and acceptance, stay in the team's `x-crew-v0.7` block. `x-crew-v0.7/team.yaml`
 *   keeps an unchanged copy of the 0.7 file.
 *
 * `planTeamAdoption` reads only. `applyTeamAdoption` plans again, writes only when the revision is the same, creates
 * files only (never replaces one), writes `team.json` last, and checks that the team loads and the 0.7 files are
 * unchanged. On any failure it removes what it wrote.
 */
import fs from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalJson, DefinitionError, type CrewDefinition } from '../../contracts/src/index.js';
import { parseCrew } from '../../crew/src/index.js';
import { ENGINE_IDS, isEngineId, safeName, type DefinitionFile, type JsonValue, type Problem } from '../../harness-definition/src/index.js';
import { decodeText } from '../../harness-definition/src/json.js';
import {
  PortableRefusal, checkAncestors, makeDir, readAbs, removeEmptyDirs, sha, writeAbs,
} from '../../project-sync/src/portable-files.js';
import { loadTeam } from './load.js';
import type { TeamFile } from './types.js';
import { scanFiles, validateTeam } from './validate.js';
import { CREW_BLOCK, HUMAN, RELAY_MAP_PATH, TEAM_FORMAT } from './words.js';

/** A person's answer for one 0.7 owner. Only `engine` and `model` have no default. */
export interface MemberAnswer {
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
  /** The absolute path of the 0.8 team folder, `.bowerloom/teams/<id>`. It can be the source folder. */
  readonly target: string;
  readonly answers?: AdoptionAnswers;
}

/** A question for a person. A plan is not ready while one is open. */
export interface AdoptionQuestion {
  readonly id: string;
  readonly kind: 'engine' | 'model' | 'harness' | 'purpose' | 'description';
  readonly owner?: string;
  readonly ask: string;
  readonly choices?: readonly string[];
  /** The 0.7 model class of the owner, as context for a model question. Never a default. */
  readonly modelClass?: string;
}
/** A value the plan chose because no answer gave one. A person sees each one. */
export interface AdoptionDefault {
  readonly member: string;
  readonly field: 'folder' | 'start' | 'inbox' | 'reports_to';
  readonly value: string;
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
  readonly problems: readonly Problem[];
  readonly defaults: readonly AdoptionDefault[];
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
  | { readonly ok: false; readonly problems: readonly Problem[] };
/** Test hooks. `afterWrite` runs after each file is written. */
export interface AdoptionHooks {
  readonly afterWrite?: (path: string) => void;
}

const MEMBER_ANSWER_KEYS = ['engine', 'model', 'harness', 'folder', 'start', 'inbox', 'reports_to', 'purpose'];
const ANSWER_KEYS = ['harness', 'description', 'members'];
const DEFAULTS: readonly (readonly [AdoptionDefault['field'], string, string])[] = [
  ['folder', '.', 'The project folder. A member that shares an engine with another member on another harness needs its own worktree.'],
  ['start', 'manual', 'A person starts the instance, so every approval reaches a person (decision 9).'],
  ['inbox', 'hold', 'Arriving messages wait. Bowerloom 0.8 has no relay bus (decision 7).'],
  ['reports_to', HUMAN, 'A 0.7 owner reports to no one, so the member reports to a person.'],
];
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const fits = (text: string) => text !== '' && [...text].length <= 1024;

interface Built { readonly plan: AdoptionPlan; readonly bytes: ReadonlyMap<string, Buffer>; readonly source: string; readonly target: string }

/** Plans the adoption. It reads the 0.7 files and the target folder, and writes nothing. */
export function planTeamAdoption(input: AdoptionInput): AdoptionPlan {
  return build(input).plan;
}

function build(input: AdoptionInput): Built {
  const problems: Problem[] = [];
  const add = (code: string, message: string, path = 'team.yaml') => { problems.push({ code, path, message }); };
  const questions: AdoptionQuestion[] = [];
  const defaults: AdoptionDefault[] = [];
  const originals: { path: string; sha256: string }[] = [];
  const bytes = new Map<string, Buffer>();
  const writes: AdoptionWrite[] = [];
  let team: TeamFile | null = null;
  let teamRevision: string | null = null;
  const source = typeof input?.source === 'string' && isAbsolute(input.source) ? resolve(input.source) : '';
  const target = typeof input?.target === 'string' && isAbsolute(input.target) ? resolve(input.target) : '';
  const finish = (): Built => {
    const ready = questions.length === 0 && problems.length === 0 && team !== null;
    const body = { source, target, originals, questions, problems, defaults, writes, team, teamRevision, ready };
    return { plan: { ...body, revision: `sha256:${sha(canonicalJson(body))}`, writesAuthorized: false }, bytes, source, target };
  };
  if (!source || !target) { add('TEAM_ADOPT_USAGE', 'source and target must be absolute paths of team folders.', '.'); return finish(); }

  // The 0.7 files.
  const yaml = readSource(source, 'team.yaml', add);
  if (yaml === null) { if (!problems.length) add('TEAM_ADOPT_SOURCE_MISSING', 'The source folder has no team.yaml.'); return finish(); }
  const relay = readSource(source, RELAY_MAP_PATH, add);
  if (problems.length) return finish();
  originals.push({ path: 'team.yaml', sha256: sha(yaml) });
  if (relay) originals.push({ path: RELAY_MAP_PATH, sha256: sha(relay) });
  const sourceFiles: DefinitionFile[] = [{ path: 'team.yaml', bytes: yaml }, ...(relay ? [{ path: RELAY_MAP_PATH, bytes: relay }] : [])];

  let crew: CrewDefinition;
  try {
    const text = decodeText(yaml);
    if (text === null) throw new DefinitionError('INVALID_ENCODING', 'not UTF-8');
    crew = parseCrew(text);
  } catch (error) {
    if (!(error instanceof DefinitionError)) throw error;
    add('TEAM_ADOPT_SOURCE_INVALID', `team.yaml is not a valid 0.7 crew file (trellis/crew/v0.7-alpha): ${error.code}.`);
    problems.push(...scanFiles(sourceFiles));
    return finish();
  }

  // Answers, questions, and defaults.
  const answers = input.answers ?? {};
  const owners = new Set(crew.owners.map(o => o.id));
  if (answers === null || typeof answers !== 'object' || Object.keys(answers).some(k => !ANSWER_KEYS.includes(k))) {
    add('TEAM_ADOPT_ANSWER', `The answers hold a field that is not known. The fields are ${ANSWER_KEYS.join(', ')}.`, 'answers');
  }
  const memberAnswers: Readonly<Record<string, MemberAnswer>> = answers.members && typeof answers.members === 'object' ? answers.members : {};
  for (const [owner, answer] of Object.entries(memberAnswers)) {
    if (!owners.has(owner)) { add('TEAM_ADOPT_UNKNOWN_OWNER', `The answers name ${safeName(owner)}, which is not an owner of the 0.7 team.`, 'answers'); continue; }
    if (answer === null || typeof answer !== 'object' || Object.keys(answer).some(k => !MEMBER_ANSWER_KEYS.includes(k))) {
      add('TEAM_ADOPT_ANSWER', `The answer for ${safeName(owner)} holds a field that is not known. The fields are ${MEMBER_ANSWER_KEYS.join(', ')}.`, 'answers');
      continue;
    }
    if (answer.engine !== undefined && !isEngineId(answer.engine)) add('TEAM_ADOPT_ANSWER', `The engine for ${safeName(owner)} must be one of ${ENGINE_IDS.join(', ')}.`, 'answers');
    for (const key of MEMBER_ANSWER_KEYS) {
      const v = (answer as Record<string, unknown>)[key];
      if (v !== undefined && typeof v !== 'string') add('TEAM_ADOPT_ANSWER', `The ${key} for ${safeName(owner)} must be text.`, 'answers');
    }
  }
  if (answers.harness === undefined) questions.push({ id: 'harness', kind: 'harness', ask: 'Which harness do the members use by default? A member can name its own (decision 10).' });
  else if (typeof answers.harness !== 'string') add('TEAM_ADOPT_ANSWER', 'The harness must be text.', 'answers');
  const description = answers.description ?? oneLine(crew.description);
  if (answers.description === undefined && !fits(description)) {
    questions.push({ id: 'description', kind: 'description', ask: 'The 0.7 description does not fit on one line of 1024 characters. Write one sentence on what the team is for.' });
  }

  const members: Record<string, JsonValue>[] = [];
  for (const owner of crew.owners) {
    const a: MemberAnswer = memberAnswers[owner.id] ?? {};
    if (a.engine === undefined) {
      questions.push({ id: `engine:${owner.id}`, kind: 'engine', owner: owner.id, choices: ENGINE_IDS, ask: `Which engine runs the owner ${safeName(owner.id)} (${oneLine(owner.role).slice(0, 120)})? The 0.7 file names no engine, so Bowerloom does not guess.` });
    }
    if (a.model === undefined) {
      questions.push({ id: `model:${owner.id}`, kind: 'model', owner: owner.id, modelClass: owner.modelClass, ask: `Name one explicit model for ${safeName(owner.id)} on its engine. In 0.7 it had the model class ${owner.modelClass}, which maps to no model (decision 5).` });
    }
    const purpose = a.purpose ?? oneLine(owner.role);
    if (a.purpose === undefined && !fits(purpose)) {
      questions.push({ id: `purpose:${owner.id}`, kind: 'purpose', owner: owner.id, ask: `The 0.7 role of ${safeName(owner.id)} does not fit on one line. Write one sentence on what this member does.` });
    }
    const chosen: Record<string, string> = {};
    for (const [field, value, reason] of DEFAULTS) {
      const given = a[field];
      if (given === undefined) { chosen[field] = value; defaults.push({ member: owner.id, field, value, reason }); } else chosen[field] = given;
    }
    const { id, ...kept } = owner;
    members.push({
      id, purpose, engine: a.engine ?? '', ...(a.harness !== undefined ? { harness: a.harness } : {}), model: a.model ?? '',
      folder: chosen.folder!, start: chosen.start!, inbox: chosen.inbox!, reports_to: chosen.reports_to!, [CREW_BLOCK]: kept as unknown as JsonValue,
    });
  }

  // The target folder.
  const same = sameFolder(source, target);
  targetCheck(target, same, add);

  if (questions.length || problems.length) {
    problems.push(...scanFiles(sourceFiles));
    return finish();
  }

  const { owners: _owners, id: crewId, format, description: crewDescription, ...rest } = crew;
  const teamJson = {
    format: TEAM_FORMAT, id: crewId, description, harness: answers.harness!, members,
    ...(relay ? { routes: RELAY_MAP_PATH } : {}),
    limits: { activeMembers: crew.budget.maxActiveWorkers },
    [CREW_BLOCK]: { format, description: crewDescription, ...rest },
  };
  const teamBytes = Buffer.from(JSON.stringify(teamJson, null, 2) + '\n', 'utf8');
  bytes.set(`${CREW_BLOCK}/team.yaml`, yaml);
  writes.push({ path: `${CREW_BLOCK}/team.yaml`, kind: 'copy', from: 'team.yaml', sha256: sha(yaml), bytes: yaml.length });
  if (relay && !same) {
    bytes.set(RELAY_MAP_PATH, relay);
    writes.push({ path: RELAY_MAP_PATH, kind: 'copy', from: RELAY_MAP_PATH, sha256: sha(relay), bytes: relay.length });
  }
  bytes.set('team.json', teamBytes);
  writes.push({ path: 'team.json', kind: 'new', sha256: sha(teamBytes), bytes: teamBytes.length });

  const files: DefinitionFile[] = [
    { path: 'team.json', bytes: teamBytes }, ...(relay ? [{ path: RELAY_MAP_PATH, bytes: relay }] : []), { path: `${CREW_BLOCK}/team.yaml`, bytes: yaml },
  ];
  const checked = validateTeam(files, { folderName: basename(target) });
  if (checked.ok) { team = checked.team.file; teamRevision = checked.team.revision; } else problems.push(...checked.problems);
  if (!checked.ok) writes.splice(0);
  return finish();
}

/** Reads one 0.7 file safely, or null when it is absent. A link or another unsafe file is a problem. */
function readSource(source: string, rel: string, add: (code: string, message: string, path?: string) => void): Buffer | null {
  try {
    const dir = fs.lstatSync(source);
    if (dir.isSymbolicLink() || !dir.isDirectory()) { add('TEAM_FILE_UNSAFE', 'The source folder is a link or not a folder.', '.'); return null; }
    if (checkAncestors(source, rel).length) return null;
    return readAbs(join(source, rel), rel)?.bytes ?? null;
  } catch (error) {
    if (error instanceof PortableRefusal) { add('TEAM_FILE_UNSAFE', `${rel} is a link, is not a plain file of yours, has more than one link, or is larger than 1 MiB.`, rel); return null; }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { add('TEAM_ADOPT_SOURCE_MISSING', 'The source folder does not exist.', '.'); return null; }
    throw error;
  }
}

function realOrResolved(abs: string): string {
  try { return fs.realpathSync(abs); } catch { try { return join(fs.realpathSync(dirname(abs)), basename(abs)); } catch { return abs; } }
}
function sameFolder(a: string, b: string): boolean {
  return realOrResolved(a) === realOrResolved(b);
}

/** The target must be a real folder, or a new one in a real folder, and hold no team yet. */
function targetCheck(target: string, same: boolean, add: (code: string, message: string, path?: string) => void): void {
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { add('TEAM_FILE_UNSAFE', 'The target folder cannot be read.', '.'); return; } }
  if (st === null) {
    try { const parent = fs.lstatSync(dirname(target)); if (parent.isDirectory() && !parent.isSymbolicLink()) return; } catch { /* reported below */ }
    add('TEAM_ADOPT_USAGE', 'The folder that would hold the target team folder does not exist, or is a link.', '.');
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) { add('TEAM_FILE_UNSAFE', 'The target folder is a link or not a folder.', '.'); return; }
  const taken = ['team.json', CREW_BLOCK, ...(same ? [] : [RELAY_MAP_PATH])].filter(rel => {
    try { fs.lstatSync(join(target, rel)); return true; } catch { return false; }
  });
  if (taken.length) add('TEAM_ADOPT_EXISTS', `The target folder already holds ${taken.join(', ')}. Adoption creates files only and never replaces one.`, taken[0]);
}

/** Writes the planned files when the plan revision is the same, then checks the result. Removes them on failure. */
export function applyTeamAdoption(input: AdoptionInput, revision: string, hooks: AdoptionHooks = {}): AdoptionApplyResult {
  const built = build(input);
  const { plan } = built;
  const refuse = (code: string, message: string): AdoptionApplyResult => ({ ok: false, problems: [{ code, path: '.', message }, ...plan.problems] });
  if (plan.revision !== revision) return refuse('TEAM_ADOPT_REVISION', 'The plan changed since it was approved. Nothing was written. Plan again.');
  if (!plan.ready) return refuse('TEAM_ADOPT_NOT_READY', 'The plan has open questions or problems. Nothing was written.');
  const root = fs.realpathSync(dirname(built.target));
  const name = basename(built.target);
  const created: string[] = [];
  const written: string[] = [];
  try {
    for (const w of plan.writes) {
      const rel = `${name}/${w.path}`;
      for (const dir of checkAncestors(root, rel)) { makeDir(root, dir); created.push(dir); }
      const abs = join(root, rel);
      writeAbs(abs, built.bytes.get(w.path)!, 0o644, { exclusive: true, label: w.path, onPlaced: () => { written.push(abs); } });
      hooks.afterWrite?.(w.path);
    }
    for (const o of plan.originals) {
      const now = readAbs(join(built.source, o.path), o.path);
      if (!now || sha(now.bytes) !== o.sha256) throw new AdoptionFault('TEAM_ADOPT_SOURCE_CHANGED', `The 0.7 file ${o.path} changed during adoption.`);
    }
    const loaded = loadTeam(built.target);
    if (!loaded.ok || loaded.team.revision !== plan.teamRevision) throw new AdoptionFault('TEAM_ADOPT_VERIFY', 'The written team does not load with the planned revision.');
    return { ok: true, written: plan.writes.map(w => w.path) };
  } catch (error) {
    for (const abs of written.reverse()) { try { fs.unlinkSync(abs); } catch { /* already gone */ } }
    const left = removeEmptyDirs(root, created);
    const fault = error instanceof AdoptionFault ? error : new AdoptionFault('TEAM_ADOPT_WRITE_FAILED', 'A write failed part way.');
    return {
      ok: false,
      problems: [
        { code: fault.code, path: '.', message: `${fault.message} Adoption removed the files it wrote. The 0.7 files were not changed by adoption.` },
        ...left.map(l => ({ code: 'TEAM_ADOPT_LEFT_BEHIND', path: l.path, message: `A folder adoption created was left behind (${l.reason}).` })),
      ],
    };
  }
}

class AdoptionFault extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
