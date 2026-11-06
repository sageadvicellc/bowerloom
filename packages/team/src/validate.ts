/**
 * Checks a team from its files, in memory. The loader and adoption both use it, so a team adoption plans is a team the
 * loader takes. Refusals (section 11, checks 1 to 3, 5, and 6):
 * - a route that names an unknown member, or participants that differ from the members;
 * - a bypass flag or `bypassPermissions` anywhere;
 * - a secret value in any file;
 * - two members with the same engine and folder but different harnesses;
 * - a member whose engine cannot carry an enforced team guardrail, unless a recorded approval covers the loss.
 */
import { projectGuardrails } from '../../fidelity/src/index.js';
import {
  INCOMPLETE_RULES, computeRevision, parseStrictJson, safeName, scanSecrets, type DefinitionFile, type Problem,
} from '../../harness-definition/src/index.js';
import { decodeText as decodeTextOrNull } from '../../harness-definition/src/json.js';
import { finish } from './messages.js';
import { bypassPointers, folderKey, namesWidening, normalizeFolder } from './scan.js';
import { Problems, checkRelayMap, checkTeamFile } from './schema.js';
import type { RelayMap, Team, TeamFile, TeamLoadResult, TeamMember, TeamOptions } from './types.js';
import { HUMAN, RELAY_MAP_PATH } from './words.js';

export interface ValidateOptions extends TeamOptions {
  /** The name of the team folder. When given, the team id must equal it (section 9). */
  readonly folderName?: string;
  /** The absolute path of the team folder, recorded on the team. */
  readonly folder?: string;
}

/** Checks a team from its files: `team.json`, `maps/relay.json` when present, and kept 0.7 files. */
export function validateTeam(files: readonly DefinitionFile[], options: ValidateOptions = {}): TeamLoadResult {
  const p = new Problems('team.json');
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const teamBytes = sorted.find(f => f.path === 'team.json');
  if (!teamBytes) return fail([{ code: 'TEAM_FILE_MISSING', path: 'team.json', message: 'The team folder has no team.json.' }]);

  p.list.push(...scanFiles(sorted));

  const text = decodeTextOrNull(teamBytes.bytes);
  const parsed = text === null ? null : parseStrictJson(text);
  if (!parsed || !parsed.ok) {
    p.add('TEAM_JSON_INVALID', `team.json is not strict UTF-8 JSON${parsed && !parsed.ok ? ` (${parsed.code})` : ''}: no duplicate keys, comments, or trailing commas.`);
    return fail(p.list);
  }
  const file = checkTeamFile(p, parsed.value);
  if (file && options.folderName !== undefined && file.id !== options.folderName) {
    p.add('TEAM_ID_FOLDER', `The team id ${safeName(file.id)} must equal the name of its folder, ${safeName(options.folderName)} (section 9).`);
  }

  const relayFile = sorted.find(f => f.path === RELAY_MAP_PATH);
  let relay: RelayMap | null | undefined = null;
  if (relayFile) {
    const relayText = decodeTextOrNull(relayFile.bytes);
    relay = relayText === null ? p.add('TEAM_RELAY_INVALID', 'maps/relay.json is not UTF-8 text.', RELAY_MAP_PATH) : checkRelayMap(p, relayText);
    if (file && file.routes === undefined) p.add('TEAM_ROUTES_POINTER', `The team folder holds ${RELAY_MAP_PATH}, and team.json does not point at it. Set routes to "${RELAY_MAP_PATH}", or remove the map.`);
  } else if (file?.routes !== undefined) {
    p.add('TEAM_ROUTES_POINTER', `routes points at ${RELAY_MAP_PATH}, and the team folder has no such file.`);
  }

  const members = file ? resolveMembers(p, file) : undefined;
  if (file && members) {
    clashes(p, members);
    if (relay) routesCheck(p, relay, members);
    guardrails(p, file, members, options);
  }
  if (p.list.length || !file || !members || relay === undefined) return fail(p.list);
  const team: Team = { folder: options.folder ?? null, file, members, relay, files: sorted, revision: computeRevision(sorted) };
  return { ok: true, team };
}

const fail = (problems: readonly Problem[]): TeamLoadResult => ({ ok: false, problems: finish(problems) });

/** The secret and bypass problems of a set of files (section 4.3, rules 4 and 6). Adoption scans 0.7 files with it. */
export function scanFiles(files: readonly DefinitionFile[]): Problem[] {
  const p = new Problems('team.json');
  secrets(p, files);
  bypasses(p, files);
  return p.list;
}

/** Section 4.3, rule 6. A finding names the file, the rule, and the line or pointer, never the value. */
function secrets(p: Problems, files: readonly DefinitionFile[]): void {
  for (const f of scanSecrets(files)) {
    const where = f.pointer !== undefined ? ` at ${f.pointer || '/'}` : f.line !== undefined ? ` on line ${f.line}` : '';
    if ((INCOMPLETE_RULES as readonly string[]).includes(f.rule)) {
      p.add('TEAM_SECRET_SCAN_INCOMPLETE', `The secret scan could not finish ${f.path}${where} (${f.rule}). A team file must be fully scanned.`, f.path);
    } else {
      p.add('TEAM_SECRET', `${f.path} holds a secret value${where} (${f.rule}). A team file holds no secret value: write a reference such as \${NAME}.`, f.path);
    }
  }
}

/** Section 4.3, rule 4: JSON files by key and value, other files by their text. */
function bypasses(p: Problems, files: readonly DefinitionFile[]): void {
  for (const f of files) {
    const text = decodeTextOrNull(f.bytes) ?? Buffer.from(f.bytes).toString('latin1');
    const parsed = f.path.endsWith('.json') ? parseStrictJson(text) : null;
    const pointers = parsed?.ok ? bypassPointers(parsed.value) : namesWidening(text) ? [''] : [];
    if (pointers.length) {
      p.add('TEAM_BYPASS', `${f.path} names a bypass or widening form${pointers[0] ? ` at ${pointers.slice(0, 5).join(', ')}` : ''}. A member never uses a bypass (section 4.3, rule 4).`, f.path);
    }
  }
}

/** Resolves each member's harness (decision 10) and folder, and checks ids and `reports_to`. */
function resolveMembers(p: Problems, file: TeamFile): TeamMember[] | undefined {
  const before = p.list.length;
  const ids = new Set<string>();
  file.members.forEach((m, i) => {
    if (ids.has(m.id)) p.add('TEAM_DUPLICATE_MEMBER', `members[${i}] repeats the id ${safeName(m.id)} of an earlier member.`);
    ids.add(m.id);
  });
  const members = file.members.map((m, i): TeamMember | undefined => {
    const harness = m.harness ?? file.harness;
    if (harness === undefined) return p.add('TEAM_MEMBER_NO_HARNESS', `members[${i}] names no harness, and the team has no default harness.`);
    const { harness: _own, ...rest } = m;
    return { ...rest, harness, harnessFrom: m.harness !== undefined ? 'member' : 'team', folder: normalizeFolder(m.folder)! };
  });
  for (const m of file.members) {
    if (m.reports_to === HUMAN) continue;
    if (m.reports_to === m.id) p.add('TEAM_REPORTS_TO', `The member ${safeName(m.id)} reports to itself. reports_to names another member, or human.`);
    else if (!ids.has(m.reports_to)) p.add('TEAM_REPORTS_TO', `The member ${safeName(m.id)} reports to ${safeName(m.reports_to)}, which is not a member.`);
  }
  // A chain of reports_to must reach a person: a loop has no person at its end.
  const next = new Map(file.members.map(m => [m.id, m.reports_to]));
  const looped = new Set<string>();
  for (const m of file.members) {
    const seen = new Set<string>();
    for (let at: string | undefined = m.id; at !== undefined && at !== HUMAN; at = next.get(at)) {
      if (seen.has(at)) { if (at !== next.get(at)) looped.add(at); break; }
      seen.add(at);
    }
  }
  if (looped.size) p.add('TEAM_REPORTS_TO', `The reports_to chain of ${[...looped].sort().map(safeName).join(', ')} is a loop that never reaches human.`);
  return p.list.length === before ? members as TeamMember[] : undefined;
}

/** Section 8, rule 2: one engine and one folder take one harness. */
function clashes(p: Problems, members: readonly TeamMember[]): void {
  const byPlace = new Map<string, TeamMember>();
  for (const m of members) {
    const key = `${m.engine}\n${folderKey(m.folder)}`;
    const other = byPlace.get(key);
    if (!other) { byPlace.set(key, m); continue; }
    if (other.harness !== m.harness) {
      p.add('TEAM_FOLDER_HARNESS_CLASH', `The members ${safeName(other.id)} and ${safeName(m.id)} use ${m.engine} in one folder with the harnesses ${safeName(other.harness)} and ${safeName(m.harness)}. Both harnesses would write the same files. Give one of them its own worktree.`);
    }
  }
}

/** Section 5.1, rule 3: the participants equal the members, and every route names members. */
function routesCheck(p: Problems, relay: RelayMap, members: readonly TeamMember[]): void {
  const ids = new Set(members.map(m => m.id));
  relay.routes.forEach((r, i) => {
    for (const end of [r.fromOwner, r.toOwner]) {
      if (!ids.has(end)) p.add('TEAM_ROUTE_UNKNOWN_MEMBER', `routes[${i}] names ${safeName(end)}, which is not a member of the team.`, RELAY_MAP_PATH);
    }
  });
  const participants = new Set(relay.participants);
  if (participants.size !== ids.size || [...ids].some(id => !participants.has(id))) {
    p.add('TEAM_RELAY_PARTICIPANTS', 'The participants of maps/relay.json must equal the members of the team.', RELAY_MAP_PATH);
  }
}

/** Check 6: each member's engine carries every enforced team guardrail, or a recorded approval covers the loss. */
function guardrails(p: Problems, file: TeamFile, members: readonly TeamMember[], options: TeamOptions): void {
  const { rules, sandbox } = file.guardrails;
  if (!rules.length && !sandbox.length) return;
  const approvalProblems = new Set<string>();
  for (const m of members) {
    const { verdict } = projectGuardrails({ rules, sandbox, engines: [m.engine] }, options.approvals ?? [], options.now ? { now: options.now } : {});
    for (const problem of verdict.problems) {
      if (problem.code === 'APPROVAL_INVALID') approvalProblems.add(`${problem.path}: ${problem.message}`);
      else p.add('TEAM_GUARDRAIL_REPORT', `The loss report for ${safeName(m.id)} has a fault: ${problem.message}`);
    }
    for (const line of verdict.refused) {
      p.add('TEAM_GUARDRAIL_NOT_CARRIED', `The member ${safeName(m.id)} uses ${m.engine}, which carries the enforced team guardrail ${safeName(line.entry)} as ${line.result}: ${line.reason} Record an approval of that loss, or choose another engine.`);
    }
  }
  for (const message of [...approvalProblems].sort()) p.add('TEAM_APPROVAL_INVALID', `An approval record is not valid. ${message}`);
}
