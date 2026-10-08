import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';

/**
 * The first screen a person sees, and the plain-words refusals. Output only: nothing here reads or writes a file.
 *
 * To add a command when its milestone lands:
 * 1. Add its usage line to a section in SECTIONS (or a new section).
 * 2. Add its full help text to TOPICS, keyed by the command word.
 * 3. Add its refusal codes to REFUSALS.
 * Only commands that exist at this commit may appear here. tests/help-human.test.ts checks the list.
 */
interface Section { readonly title: string; readonly lines: readonly string[] }
const SECTIONS: readonly Section[] = [
  { title: 'Start here', lines: [
    'bowerloom init plan|apply --mode new|existing --target <directory> --name <name> --goal <goal>',
    'bowerloom ls [teams|skills|prompts]   List what this project holds.',
    'bowerloom status                      Show whether this project is ready.',
  ] },
  { title: 'Skills and setup', lines: [
    'bowerloom skills add npm:<package>@<version>:<path>',
    'bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path>',
    'bowerloom skills check                Check the pins in .bowerloom/skills.json.',
    'bowerloom skills sync [--offline]     Install the pinned skills on this machine.',
  ] },
  { title: 'Create (mostly used by agents)', lines: [
    'bowerloom team create <name> [--profile engineer|founder|research]',
    'bowerloom skill create <name> [--team <team>]',
    'bowerloom prompt create <name> [--team <team>]',
  ] },
];
const INTRO = "Set up agent teams, skills, and prompts for Claude Code and Codex.";
const OUTRO = [
  'Every change shows a plan first. Agents pass --approve <revision> or --json.',
  'No command here starts workers yet.', '',
  '  bowerloom help <command>   bowerloom help advanced',
];

/** The short help, without the release heading. */
export function shortHelp(): string {
  return [INTRO, '', ...SECTIONS.flatMap(section => [section.title, ...section.lines.map(line => `  ${line}`), '']), ...OUTRO, ''].join('\n');
}

/** Full help for one command, keyed by the command word. `init` has its own text in main.ts. */
export const TOPICS: Readonly<Record<string, string>> = {
  ls: [
    'Usage:', '  bowerloom ls [teams|skills|prompts] [--json]', '',
    "Lists the teams, skills, and prompts in this project's .bowerloom folder. It reads only and writes nothing.",
    'The project is the nearest parent folder that holds .bowerloom, found the way git finds .git.',
    'It stops at your home folder and refuses cloud-synced folders.',
    'Add --json for one machine-readable object.', '',
  ].join('\n'),
  status: [
    'Usage:', '  bowerloom status [--json]', '',
    'Shows whether this project\'s setup is ready, and lists any file that changed since it was installed.',
    'It reads only and writes nothing, and it starts no workers.',
    'Add --json for one machine-readable object.',
    'bowerloom status --installation <private.json> still reads a prepared session. See bowerloom help advanced.', '',
  ].join('\n'),
  skills: [
    'Usage:',
    '  bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--approve <revision>] [--json]',
    '  bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--approve <revision>] [--json]',
    '  bowerloom skills check [--json]', '',
    'skills add pins one skill in .bowerloom/skills.json, the file you commit so every machine gets the same skills.',
    'The pin must be exact: an npm version such as 1.2.3, or a full 40-character lower-case Git commit.',
    'Ranges, tags, branches and short commits are refused before anything is fetched.',
    '<path> is the skill folder inside the package or repository, for example:',
    '  bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections',
    'It reads only registry.npmjs.org or api.github.com, without credentials, and takes MIT or Apache-2.0 skills only.',
    'It shows the plan first. Agents pass --approve <revision> or --json. It records the pin only: nothing is installed or run.',
    '--id sets the entry id; the default is the skill name. --team limits the skill to a team; without it, every team gets it.', '',
    'skills check reads .bowerloom/skills.json and checks every pin, offline. It writes nothing.', '',
    '  bowerloom skills sync [--offline] [--team <team>] [--approve <revision>] [--json]',
    'skills sync installs every skill in skills.json for Claude Code and Codex (the harnesses skills.json names):',
    'into .bowerloom/managed, .claude/skills and .agents/skills. Those copies stay on this machine; commit skills.json.',
    'It fetches only pins that are not in the private cache yet, and checks every byte against its pin first.',
    '--offline refuses before any change if a pin still needs fetching. --team syncs only that team\'s skills.',
    'A skill whose copy you changed is held and shown with its next step; the others apply. Sync removes nothing.',
    'Ctrl-C stops it between two skills, never inside one.', '',
    '  bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon] [--approve <revision>] [--json]',
    'skills recover finishes or undoes the one unfinished change of an item, after a crash or a refusal inside it.', '',
    '  bowerloom skills migrate plan|apply --state <earlier-state-folder> [--approve <revision>] [--json]',
    'skills migrate moves a skill installed by an earlier Bowerloom (.bowerloom-skills) to .bowerloom/managed.',
    'skills.json must pin the same source first; migrate plan prints the skills add command if it does not.', '',
    'The other skills forms are listed by bowerloom help advanced.', '',
  ].join('\n'),
  team: [
    'Usage:', '  bowerloom team create <name> [--profile engineer|founder|research] [--approve <revision>] [--json]', '',
    "Creates a team in .bowerloom/teams/<name>, from the project brief, with a lead, a maker and a reviewer.",
    'The name is the team id: lower-case words joined by hyphens, such as research-desk. first-team is taken by setup.',
    'The profile defaults to the one in the project brief.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the files it makes.',
    'It writes inside .bowerloom only. It starts no workers and runs nothing.', '',
  ].join('\n'),
  skill: [
    'Usage:', '  bowerloom skill create <name> [--team <team>]... [--approve <revision>] [--json]', '',
    'Creates a skill of your own in .bowerloom/skills/<name>/SKILL.md, and lists it in .bowerloom/skills.json as a local skill.',
    'The name is the skill id, such as house-style. personal-assistant and ids that start with prompt- are reserved.',
    '--team limits the skill to a team that exists; without it, every team gets it.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.',
    'It writes inside .bowerloom only. It starts no workers and runs nothing.',
    'To pin a skill from npm or GitHub instead, see bowerloom help skills.', '',
  ].join('\n'),
  prompt: [
    'Usage:', '  bowerloom prompt create <name> [--team <team>]... [--approve <revision>] [--json]', '',
    'Creates a reusable prompt in .bowerloom/prompts/<name>.md.',
    'The name is the prompt id, such as weekly-update, at most 57 characters.',
    '--team limits the prompt to a team that exists; without it, every team gets it.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.',
    'It writes inside .bowerloom only. It starts no workers and runs nothing.', '',
  ].join('\n'),
};

/** The exit codes: 0 done, 1 refused, 2 usage, 3 approval required, 4 held by a gate. */
export type ExitCode = 0 | 1 | 2 | 3 | 4;
type GateCode = 'APPROVAL_REQUIRED' | 'WORKERS_HELD';
const GATE_EXIT: Readonly<Record<GateCode, 3 | 4>> = { APPROVAL_REQUIRED: 3, WORKERS_HELD: 4 };

// The marker of an error a new command raised. Only newCommandRefusal adds to it, and membership is the object
// itself: a copy, a spread or a prototype child of a marked error is not marked. Existing plumbing (recipes, broker,
// controlled tests) raises APPROVAL_REQUIRED of its own; that never reaches exit 3 or the --approve hint.
const raisedByNewCommand = new WeakSet<object>();

/** The approval or gate refusal of a new command (0.7.0 and later). Only these errors exit 3 or 4. */
export function newCommandRefusal(code: GateCode, message: string): DefinitionError {
  if (!Object.hasOwn(GATE_EXIT, code)) throw new TypeError('newCommandRefusal takes APPROVAL_REQUIRED or WORKERS_HELD only.');
  const error = new DefinitionError(code, message);
  raisedByNewCommand.add(error); return error;
}
const marked = (error: unknown): error is DefinitionError => typeof error === 'object' && error !== null && raisedByNewCommand.has(error);
const codeOf = (error: unknown): string | null =>
  error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,100}$/.test(error.code) ? error.code : null;

/**
 * The exit code for a command's outcome: `null` when it finished, else the error it raised.
 * USAGE is 2 for every command. 3 and 4 only for an error from newCommandRefusal; any other error, whatever its code, is 1.
 */
export function exitCodeFor(error: unknown): ExitCode {
  if (error === null) return 0;
  const code = codeOf(error);
  if (code === 'USAGE') return 2;
  return marked(error) && Object.hasOwn(GATE_EXIT, error.code) ? GATE_EXIT[error.code as GateCode] : 1;
}

// Every control character (C0, DEL, C1), every format character (the bidi controls, zero-width characters, the byte
// order mark, tag characters), and the line and paragraph separators U+2028 and U+2029 (review M1F 2).
const CONTROLS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const CONTROLS_BUT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\u2028\u2029]/gu;
// Every UTF-16 unit of a match as `\\uXXXX`, so a character outside the basic plane (a tag character) keeps both halves.
const escapeUnits = (c: string): string => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
// DEL (review M3 finding 6), the C1 controls and the format characters (bidi controls, zero-width characters), plus the
// line and paragraph separators.
const JSON_HIDDEN = /[\u007f-\u009f\p{Cf}\u2028\u2029]/gu;
/**
 * The JSON output of a new command (0.7.0 and later): canonical JSON, with DEL, every C1 control, format character (bidi
 * and zero-width included), U+2028 and U+2029 written as a \uXXXX escape, so a terminal shows it as text. The parsed
 * value is the same. Plumbing commands keep their exact envelope and do not use this.
 */
export function newCommandJson(value: unknown): string {
  return `${canonicalJson(value).replace(JSON_HIDDEN, escapeUnits)}\n`;
}

/**
 * Text that is safe to print to a terminal: every C0, C1, DEL and bidi control becomes a visible `\uXXXX`, so a file
 * name or a message cannot move the cursor, recolour the screen or reorder a line. `multiline` keeps the newline.
 * For human output only. JSON output is never passed through here.
 */
export function plainText(value: string, multiline = false): string {
  return value.replace(multiline ? CONTROLS_BUT_NEWLINE : CONTROLS, escapeUnits);
}

const INIT_NEXT = 'bowerloom init plan --mode existing --target <directory> --name <name> --goal <goal>';
interface Words { readonly sentence: string; readonly next: string }
const REFUSALS: Readonly<Record<string, Words>> = {
  USAGE: { sentence: 'The command line did not match a Bowerloom command, so nothing was changed.', next: 'bowerloom help' },
  APPROVAL_DECLINED: { sentence: 'You declined, so nothing was changed.', next: 'run the same command again to see the plan' },
  STALE_APPROVAL: { sentence: 'The plan changed after you saw it, so nothing was applied.', next: 'run the same command again, without --approve, to see the new plan' },
  PROJECT_NOT_FOUND: { sentence: 'Bowerloom looked in this folder and in every parent folder up to your home folder.', next: INIT_NEXT },
  PROJECT_ROOT_REFUSED: { sentence: 'A whole disk or home folder is too broad to be a project.', next: 'cd <project-folder>' },
  PROJECT_IN_CLOUD_FOLDER: { sentence: 'Cloud sync changes file times and moves files, which breaks the checks that keep a project safe.', next: 'mv <project-folder> ~/Projects/' },
  PROJECT_UNSAFE: { sentence: 'Bowerloom will not trust a .bowerloom folder that other people or links can change.', next: 'ls -ld .bowerloom' },
  PROJECT_UNREADABLE: { sentence: 'A folder on the way to the project could not be read, so Bowerloom cannot tell which project holds this folder.', next: 'ls -ld <folder>' },
  PROJECT_LOCKED: { sentence: 'Two commands must not change one project at the same time, so nothing was changed.', next: 'bowerloom status' },
  PROJECT_LOCK_UNAVAILABLE: { sentence: 'The lock uses a local port, and this computer would not give it out.', next: 'bowerloom status' },
  PROJECT_LOCK_SLOT_COLLISION: { sentence: 'The lock uses a local port, and another program is listening on it.', next: 'lsof -nP -iTCP:<port> -sTCP:LISTEN' },
  MANIFEST_NOT_FOUND: { sentence: 'There is nothing to check yet.', next: 'bowerloom skills add npm:<package>@<version>:<path>' },
  MANIFEST_INVALID: { sentence: 'Bowerloom reads skills.json strictly, so a hand edit can break it.', next: 'git diff .bowerloom/skills.json' },
  MANIFEST_UNSAFE: { sentence: 'Bowerloom will not trust a skills.json that other people or links can change.', next: 'ls -l .bowerloom/skills.json' },
  MANIFEST_WRITE_UNCONFIRMED: { sentence: 'skills.json was written, but it changed again before Bowerloom could read it back. Check it before you run the command again.', next: 'bowerloom skills check' },
  MANIFEST_PIN_NOT_EXACT: { sentence: 'A pin that can move would install different files on different machines.', next: 'bowerloom help skills' },
  MANIFEST_LICENSE_UNSUPPORTED: { sentence: 'This beta installs MIT and Apache-2.0 skills only.', next: 'bowerloom help skills' },
  MANIFEST_DUPLICATE_ID: { sentence: 'Each skill needs its own id.', next: 'git diff .bowerloom/skills.json' },
  MANIFEST_LIMIT: { sentence: 'This beta keeps skills.json small: 32 skills and 1 MiB at most.', next: 'bowerloom skills check' },
  SKILLS_ADD_SPEC_INVALID: { sentence: 'The source names a package or repository, an exact pin, and the skill folder.', next: 'bowerloom help skills' },
  SKILLS_ADD_EXISTS: { sentence: 'skills.json already pins this.', next: 'bowerloom skills check' },
  SKILLS_ADD_NOT_FOUND: { sentence: 'Check the package name, version, commit and folder.', next: 'bowerloom help skills' },
  SKILLS_ADD_SKILL_MISSING: { sentence: 'A skill folder holds a SKILL.md file at its top.', next: 'bowerloom help skills' },
  SKILLS_ADD_LICENSE_UNKNOWN: { sentence: 'This beta installs a skill only when its MIT or Apache-2.0 license is shipped with it.', next: 'bowerloom help skills' },
  SKILLS_ADD_UNSAFE_CONTENT: { sentence: 'Skills here are text files only, and nothing in them is run.', next: 'bowerloom help skills' },
  SKILLS_ADD_NETWORK: { sentence: 'Nothing was changed.', next: 'run the same command again' },
  SKILLS_ADD_HOST_REFUSED: { sentence: 'Bowerloom asked no other host, and nothing was changed.', next: 'bowerloom help skills' },
  TEAM_NOT_FOUND: { sentence: 'A skill or prompt can be limited only to a team that exists.', next: 'bowerloom ls teams' },
  TEAM_EXISTS: { sentence: 'Each team needs its own id.', next: 'bowerloom ls teams' },
  TEAM_ID_RESERVED: { sentence: 'Setup made first-team, so a new team needs another id.', next: 'bowerloom team create <another-name>' },
  TEAM_NAME_INVALID: { sentence: 'The id becomes a folder name, so it is kept plain.', next: 'bowerloom help team' },
  SKILL_EXISTS: { sentence: 'Each skill needs its own id.', next: 'bowerloom ls skills' },
  SKILL_NAME_RESERVED: { sentence: 'Bowerloom uses these ids itself.', next: 'bowerloom help skill' },
  SKILL_NAME_INVALID: { sentence: 'The id becomes a folder name, so it is kept plain.', next: 'bowerloom help skill' },
  PROMPT_EXISTS: { sentence: 'Each prompt needs its own id.', next: 'bowerloom ls prompts' },
  PROMPT_NAME_INVALID: { sentence: 'The id becomes a file name, so it is kept plain.', next: 'bowerloom help prompt' },
  PROJECT_BRIEF_INVALID: { sentence: 'A new team is built from the project brief that setup saved.', next: 'bowerloom status' },
  AUTHORING_PENDING: { sentence: 'Bowerloom finishes an interrupted create only when what it left matches its record exactly.', next: 'cat .bowerloom/authoring/pending.json' },
  AUTHORING_RECEIPT_INVALID: { sentence: 'Bowerloom reads its record of created items strictly, so a hand edit can break it.', next: 'git diff .bowerloom/authoring/receipt.json' },
  AUTHORING_UNSAFE_PATH: { sentence: 'Bowerloom will not read or write through links, shared files or files others can change.', next: 'ls -la .bowerloom' },
  AUTHORING_UNREGISTERED: { sentence: 'Bowerloom keeps track only of what create made.', next: 'bowerloom status' },
  REVISION_PENDING: { sentence: 'Create waits until the revise is finished.', next: 'bowerloom help advanced' },
  SKILLS_OFFLINE: { sentence: 'Sync fetches only pins that are not cached yet, and it changed nothing in the project.', next: 'bowerloom skills sync' },
  SKILLS_SYNC_CONTENT_MISMATCH: { sentence: 'Bowerloom installs only bytes that match skills.json exactly, so it stopped before any change to the project.', next: 'bowerloom skills check' },
  SKILLS_SYNC_INTERRUPTED: { sentence: 'Every skill it finished is complete, and the rest are untouched.', next: 'bowerloom skills sync' },
  SKILLS_SYNC_LIMIT: { sentence: 'This beta syncs at most 64 skills at once.', next: 'bowerloom skills check' },
  SKILLS_CACHE_RECOVERY_REQUIRED: { sentence: 'The private cache needs a look before this pin can be read.', next: 'bowerloom help advanced' },
  SKILLS_STATE_UNSAFE: { sentence: 'Bowerloom keeps receipts and the cache in a private folder that only you can change.', next: 'ls -ld ~/.local/state/bowerloom' },
  SKILLS_RECOVER_NOTHING: { sentence: 'Nothing of this item is unfinished.', next: 'bowerloom status' },
  SKILLS_MIGRATE_NOTHING: { sentence: 'The project has no .bowerloom-skills folder.', next: 'bowerloom skills sync' },
  SKILLS_MIGRATE_STATE_INVALID: { sentence: 'Migrate needs the private state folder the earlier install was made with.', next: 'bowerloom help skills' },
  SKILLS_MIGRATE_NOT_IN_MANIFEST: { sentence: 'skills.json must pin the installed skill before it can be migrated.', next: 'bowerloom skills check' },
  MANAGED_SKILL_LEGACY_PRESENT: { sentence: 'Skills from an earlier Bowerloom must be migrated before sync can manage this project.', next: 'bowerloom skills migrate plan --state <earlier-state-folder>' },
  MANAGED_SKILL_RECOVERY_REQUIRED: { sentence: 'A change was interrupted inside one skill, and Bowerloom changes nothing else until it is recovered.', next: 'bowerloom skills recover plan --item <id>' },
  MANAGED_SKILL_LOCAL_DRIFT: { sentence: 'Bowerloom never overwrites a copy you changed.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_PATH_OCCUPIED: { sentence: 'Something Bowerloom did not install is where a copy goes.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_HISTORY_FULL: { sentence: 'Bowerloom deletes no history by itself.', next: 'bowerloom skills sync' },
};
// Only for an error a new command raised (newCommandRefusal).
const GATE_REFUSALS: Readonly<Record<GateCode, Words>> = {
  APPROVAL_REQUIRED: { sentence: 'This change needs your approval before it is applied.', next: 'run the same command again with --approve <revision>' },
  WORKERS_HELD: { sentence: 'The project is prepared. No worker was started.', next: 'bowerloom status' },
};
// APPROVAL_REQUIRED from existing plumbing. Those commands take no --approve <revision>, so the words never name it.
const PLUMBING_APPROVAL: Words = { sentence: 'This command needs a current approval for the exact action before it runs.', next: 'bowerloom help advanced' };
const GENERIC: Words = { sentence: 'Nothing more is known about this refusal beyond its code.', next: 'bowerloom help' };

/** What a refusal carries besides its code and message. */
export interface RefusalDetail {
  /** The local port of a lock slot collision, when the error names one. */
  readonly port?: number;
  /** True only for an error from newCommandRefusal. */
  readonly raisedByNewCommand?: boolean;
  /** A fixed hint name the error carries, for words that are more exact than its code alone. */
  readonly hint?: typeof LEFTOVER_TEMP_LINK;
}
/** The hint of a MANIFEST_UNSAFE whose second link is a leftover `.skills.json.*.tmp` (skill-manifest/src/add.ts). */
const LEFTOVER_TEMP_LINK = 'skills-json-temp-link';
const validPort = (port: unknown): port is number => Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535;

function wordsFor(code: string, detail: RefusalDetail): Words {
  if (Object.hasOwn(GATE_REFUSALS, code)) return detail.raisedByNewCommand === true ? GATE_REFUSALS[code as GateCode] : code === 'APPROVAL_REQUIRED' ? PLUMBING_APPROVAL : GENERIC;
  if (code === 'MANIFEST_UNSAFE' && detail.hint === LEFTOVER_TEMP_LINK) {
    return { sentence: 'An interrupted write left a second link to skills.json, the temporary file .bowerloom/.skills.json.*.tmp. Check that both name the same file, then remove the temporary one.', next: 'ls -li .bowerloom/skills.json .bowerloom/.skills.json.*.tmp' };
  }
  if (code === 'PROJECT_LOCK_SLOT_COLLISION' && validPort(detail.port)) {
    return { sentence: `The lock uses a local port, and another program is listening on port ${detail.port}.`, next: `lsof -nP -iTCP:${detail.port} -sTCP:LISTEN` };
  }
  return Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : GENERIC;
}

/** One refusal in plain words. The fixed refusal code stays visible. Control characters in the code or message are escaped. */
export function renderRefusal(code: string, message: string, detail: RefusalDetail = {}): string {
  const { sentence, next } = wordsFor(code, detail);
  return `Refused (${plainText(code)}): ${plainText(message)}\n${sentence}\nNext: ${next}\n`;
}

/**
 * What to print on stderr and which exit code to use. A terminal gets plain words. Anything else gets today's
 * JSON envelope, byte for byte, which agents parse. Never exit 0.
 */
export function reportFailure(error: unknown, tty: boolean): { text: string; exitCode: Exclude<ExitCode, 0> } {
  const code = codeOf(error) ?? 'IO_ERROR';
  const safe = error instanceof DefinitionError ? error : new DefinitionError(code, 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.');
  const port = error instanceof DefinitionError && 'port' in error ? (error as { port?: unknown }).port : undefined;
  const hint = error instanceof DefinitionError && 'hint' in error ? (error as { hint?: unknown }).hint : undefined;
  const detail: RefusalDetail = { raisedByNewCommand: marked(error), ...(validPort(port) ? { port } : {}), ...(hint === LEFTOVER_TEMP_LINK ? { hint } : {}) };
  const exitCode = exitCodeFor(marked(error) ? error : safe) as Exclude<ExitCode, 0>;
  return { text: tty ? renderRefusal(safe.code, safe.message, detail) : `${JSON.stringify({ error: { code: safe.code, message: safe.message } })}\n`, exitCode };
}
