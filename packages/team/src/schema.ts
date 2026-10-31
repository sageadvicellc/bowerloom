/**
 * Field checks of `team.json` (sections 4.1, 4.2, 4.3, and 7) and of the 0.7 relay map (section 5.1). Unknown fields
 * are refused. An `x-<name>` key keeps unknown content (rule 4.3.3), except `x-<engine>`: a team holds no
 * engine-specific syntax (rule 4.3.1). Messages never repeat a value; a key appears only when `safeName` finds it plain.
 */
import { DefinitionError } from '../../contracts/src/index.js';
import { checked } from '../../authoring/src/contracts.js';
import type { RelayMap } from '../../authoring/src/contracts.js';
import { Checker, checkGuardrails } from '../../harness-definition/src/schema.js';
import {
  ENGINE_IDS, isEngineId, isId, parseStrictJson, safeName, type JsonValue, type Problem,
} from '../../harness-definition/src/index.js';
import { normalizeFolder } from './scan.js';
import { BAD_TEXT } from './text.js';
import type { Extensions, MemberFile, TeamFile, TeamGuardrails, TeamLimits } from './types.js';
import {
  INBOX_MODES, MODEL_CLASSES, RELAY_MAP_PATH, START_MODES, TEAM_FORMAT, TEAM_LIMITS, type InboxMode, type StartMode,
} from './words.js';

type Obj = Readonly<Record<string, JsonValue>>;
const EXTENSION = /^x-([a-z0-9]+(?:[.-][a-z0-9]+)*)$/;
const isObj = (v: JsonValue | undefined): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (words: readonly string[]) => words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`;

/** Collects the problems of one file. */
export class Problems {
  readonly list: Problem[] = [];
  constructor(readonly path: string) {}
  add(code: string, message: string, path = this.path): undefined { this.list.push({ code, path, message }); return undefined; }
}

/** Checks the keys of an object and returns its `x-` blocks, or undefined on a fault. */
function keys(p: Problems, value: JsonValue | undefined, where: string, required: readonly string[], optional: readonly string[]): { obj: Obj; extensions: Extensions } | undefined {
  if (!isObj(value)) return p.add('TEAM_INVALID_FIELD', `${where} must be an object.`);
  let ok = true;
  const extensions: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    const m = EXTENSION.exec(key);
    if (m && isEngineId(m[1])) { p.add('TEAM_ENGINE_SYNTAX', `${where} has the engine block ${safeName(key)}. A team holds no engine-specific syntax: each member's harness projects through the normal rules.`); ok = false; continue; }
    if (m) { extensions[key] = value[key]!; continue; }
    p.add('TEAM_UNKNOWN_FIELD', `${where} has the unknown field ${safeName(key)}. Keep other content inside an x-<name> block.`); ok = false;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) { p.add('TEAM_INVALID_FIELD', `${where} is missing the field ${key}.`); ok = false; }
  return ok ? { obj: value, extensions } : undefined;
}

/** One line of text, with none of the characters of `BAD_TEXT` (rulings T6 and V5). */
function oneLine(p: Problems, value: JsonValue | undefined, where: string, max = 1024): string | undefined {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > max || BAD_TEXT.test(value)) {
    return p.add('TEAM_INVALID_FIELD', `${where} must be one line of 1 to ${max} characters with no control or format characters.`);
  }
  return value;
}
/** A model name: it starts with a letter or digit, so it is never read as a flag (ruling T6). */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
function word<T extends string>(p: Problems, value: JsonValue | undefined, words: readonly T[], where: string): T | undefined {
  return typeof value === 'string' && (words as readonly string[]).includes(value) ? value as T : p.add('TEAM_INVALID_FIELD', `${where} must be ${list(words)}.`);
}
function id(p: Problems, value: JsonValue | undefined, where: string): string | undefined {
  return isId(value) ? value : p.add('TEAM_INVALID_ID', `${where} must be lowercase letters, digits, and single hyphens, up to 64 characters.`);
}
function count(p: Problems, value: JsonValue | undefined, where: string, max: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max ? value as number : p.add('TEAM_INVALID_FIELD', `${where} must be a whole number from 1 to ${max}.`);
}

function checkMember(p: Problems, value: JsonValue, i: number): MemberFile | undefined {
  const where = `members[${i}]`;
  const k = keys(p, value, where, ['id', 'purpose', 'engine', 'model', 'folder', 'start', 'inbox', 'reports_to'], ['harness']);
  if (!k) return undefined;
  const o = k.obj;
  const memberId = id(p, o.id, `${where}.id`);
  const purpose = oneLine(p, o.purpose, `${where}.purpose`);
  const engine = isEngineId(o.engine) ? o.engine : p.add('TEAM_UNKNOWN_ENGINE', `${where}.engine must be an engine id: ${list(ENGINE_IDS)}.`);
  const harness = Object.hasOwn(o, 'harness') ? id(p, o.harness, `${where}.harness`) : null;
  let model = typeof o.model === 'string' && MODEL_NAME.test(o.model) ? o.model
    : p.add('TEAM_INVALID_FIELD', `${where}.model must be one model name: a letter or digit, then up to 255 letters, digits, or . _ : / @ + -.`);
  if (model !== undefined && (MODEL_CLASSES as readonly string[]).includes(model.toLowerCase())) {
    model = p.add('TEAM_MODEL_CLASS', `${where}.model is a 0.7 model class, not a model. Name one explicit model for the engine (decision 5).`);
  }
  const folder = normalizeFolder(o.folder) === null
    ? p.add('TEAM_FOLDER_INVALID', `${where}.folder must be a relative path inside or beside the project, such as ".", "wt/maker", or "../demo-maker". No absolute path, ~, backslash, empty segment, or .. after a name.`)
    : o.folder as string;
  const start = word<StartMode>(p, o.start, START_MODES, `${where}.start`);
  const inbox = word<InboxMode>(p, o.inbox, INBOX_MODES, `${where}.inbox`);
  const reportsTo = typeof o.reports_to === 'string' && (o.reports_to === 'human' || isId(o.reports_to)) ? o.reports_to : p.add('TEAM_REPORTS_TO', `${where}.reports_to must be another member id, or human.`);
  if (memberId === undefined || purpose === undefined || engine === undefined || harness === undefined || model === undefined
    || folder === undefined || start === undefined || inbox === undefined || reportsTo === undefined) return undefined;
  return { id: memberId, purpose, engine, ...(harness !== null ? { harness } : {}), model, folder, start, inbox, reports_to: reportsTo, extensions: k.extensions };
}

function checkLimits(p: Problems, value: JsonValue | undefined): TeamLimits | undefined {
  const k = keys(p, value, 'limits', ['activeMembers'], ['messages', 'costUsd']);
  if (!k) return undefined;
  const activeMembers = count(p, k.obj.activeMembers, 'limits.activeMembers', TEAM_LIMITS.activeMembers);
  let messages: TeamLimits['messages'] | null | undefined = null;
  if (Object.hasOwn(k.obj, 'messages')) {
    const m = keys(p, k.obj.messages, 'limits.messages', ['perMember', 'windowSeconds'], []);
    const perMember = m && count(p, m.obj.perMember, 'limits.messages.perMember', TEAM_LIMITS.messagesPerMember);
    const windowSeconds = m && count(p, m.obj.windowSeconds, 'limits.messages.windowSeconds', TEAM_LIMITS.windowSeconds);
    messages = perMember !== undefined && windowSeconds !== undefined ? { perMember, windowSeconds } : undefined;
  }
  let costUsd: number | null | undefined = null;
  if (Object.hasOwn(k.obj, 'costUsd')) {
    const c = k.obj.costUsd;
    costUsd = typeof c === 'number' && Number.isFinite(c) && c > 0 && c <= TEAM_LIMITS.costUsd ? c : p.add('TEAM_INVALID_FIELD', `limits.costUsd must be a number of US dollars above 0 and at most ${TEAM_LIMITS.costUsd}.`);
  }
  if (activeMembers === undefined || messages === undefined || costUsd === undefined) return undefined;
  return { activeMembers, ...(messages ? { messages } : {}), ...(costUsd !== null ? { costUsd } : {}) };
}

function checkTeamGuardrails(p: Problems, value: JsonValue | undefined): TeamGuardrails | undefined {
  if (value === undefined) return { rules: [], sandbox: [] };
  // Ruling T2: a team guardrail carries no x- block. Projection would write an engine block as it stands.
  if (isObj(value)) {
    const entries = [...(Array.isArray(value.rules) ? value.rules.map((r, i) => [`guardrails.rules[${i}]`, r] as const) : []), ...(value.sandbox !== undefined ? [['guardrails.sandbox', value.sandbox] as const] : [])];
    let blocked = false;
    for (const [where, entry] of entries) {
      if (isObj(entry) && Object.keys(entry).some(k => k.startsWith('x-'))) { p.add('TEAM_GUARDRAIL_BLOCK', `${where} has an x- block. A team guardrail carries no x- block: projection would write an engine block as it stands.`); blocked = true; }
    }
    if (blocked) return undefined;
  }
  const c = new Checker(p.path);
  const g = checkGuardrails(c, value);
  for (const problem of c.problems) p.add('TEAM_GUARDRAILS_INVALID', `guardrails: ${problem.message.replace(/^guardrails\.json:? ?/, '')}`);
  return g;
}

/** Checks `team.json`, parsed. Returns the file, or undefined when it has a fault. */
export function checkTeamFile(p: Problems, value: JsonValue): TeamFile | undefined {
  const k = keys(p, value, 'team.json', ['format', 'id', 'description', 'members', 'limits'], ['harness', 'routes', 'guardrails']);
  if (!k) return undefined;
  const o = k.obj;
  const format = o.format === TEAM_FORMAT ? TEAM_FORMAT : p.add('TEAM_FORMAT', `team.json format must be ${TEAM_FORMAT}.`);
  const teamId = id(p, o.id, 'id');
  const description = oneLine(p, o.description, 'description');
  const harness = Object.hasOwn(o, 'harness') ? id(p, o.harness, 'harness') : null;
  const routes = !Object.hasOwn(o, 'routes') ? null
    : o.routes === RELAY_MAP_PATH ? RELAY_MAP_PATH : p.add('TEAM_ROUTES_POINTER', `routes, when present, must be "${RELAY_MAP_PATH}", the relay map in the 0.7 format.`);
  let members: MemberFile[] | undefined;
  if (!Array.isArray(o.members) || o.members.length < 1 || o.members.length > TEAM_LIMITS.members) {
    p.add('TEAM_INVALID_FIELD', `members must be a list of 1 to ${TEAM_LIMITS.members} members.`);
  } else {
    const checkedMembers = o.members.map((m, i) => checkMember(p, m, i));
    members = checkedMembers.every(m => m !== undefined) ? checkedMembers as MemberFile[] : undefined;
  }
  const limits = checkLimits(p, o.limits);
  const guardrails = checkTeamGuardrails(p, o.guardrails);
  if (!format || teamId === undefined || description === undefined || harness === undefined || routes === undefined || !members || !limits || !guardrails) return undefined;
  return {
    format, id: teamId, description, ...(harness !== null ? { harness } : {}), members, ...(routes !== null ? { routes } : {}),
    limits, guardrails, extensions: k.extensions,
  };
}

/** Checks the relay map bytes against the 0.7 schema, exactly. Returns the map, or undefined. */
export function checkRelayMap(p: Problems, text: string): RelayMap | undefined {
  const parsed = parseStrictJson(text);
  if (!parsed.ok) return p.add('TEAM_RELAY_INVALID', `maps/relay.json is not strict JSON (${parsed.code}).`, RELAY_MAP_PATH);
  try { return checked<RelayMap>('relay', parsed.value); } catch (error) {
    if (!(error instanceof DefinitionError)) throw error;
    return p.add('TEAM_RELAY_INVALID', 'maps/relay.json does not fit the 0.7 relay map: format trellis/relay-map/v0.7-alpha, participants, and routes with fromOwner, fromTask, toOwner, toTask, delivery "accepted-output", and bindings.', RELAY_MAP_PATH);
  }
}
