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
    'bowerloom up --team <name>            Prepare this project for a team. Shows each plan first.',
    'bowerloom ls [teams|skills|prompts]   List what this project holds.',
    'bowerloom status                      Show whether this project is ready.',
  ] },
  { title: 'Skills and setup', lines: [
    'bowerloom skills add npm:<package>@<version>:<path>',
    'bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path>',
    'bowerloom skills check                Check the pins in .bowerloom/skills.json.',
    'bowerloom skills sync [--offline]     Install the pinned skills on this machine.',
    'bowerloom apply [--harness claude|codex|both]',
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
    'Shows whether this project\'s setup is ready. It names each changed file or folder since setup, and each held',
    'or missing skill, prompt or team, with its next step.',
    'It reads only and writes nothing, and it starts no workers.',
    'Add --json for one machine-readable object.',
    'bowerloom status --installation <private.json> still reads a prepared session. See bowerloom help advanced.', '',
  ].join('\n'),
  skills: [
    'Usage:',
    '  bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--approve <revision>] [--json]',
    '  bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--approve <revision>] [--json]',
    '  bowerloom skills check [--json]', '',
    'skills add pins one skill in .bowerloom/skills.json, the file you commit so every machine gets the same skills.',
    'The pin must be exact: an npm version such as 1.2.3, or a full 40-character lower-case Git commit.',
    'Ranges, tags, branches and short commits are refused before anything is fetched.',
    '<path> is the skill folder inside the package or repository, for example:',
    '  bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections',
    'It reads only registry.npmjs.org or api.github.com, without credentials, and takes MIT or Apache-2.0 skills only.',
    'It shows the plan first. Agents pass --approve <revision> or --json. It records the pin only: nothing is installed or run.',
    '--id sets the entry id; the default is the skill name. --team limits the skill to a team; without it, every team gets it.',
    '--replace moves an existing id to another version or commit of the same package or repository. The plan shows the',
    'old pin and the new pin, and the entry keeps its teams unless you pass --team. Then skills sync updates the copies:',
    '  bowerloom skills add npm:@tanstack/db-skills@0.0.2:skills/tanstack-db/collections --id <id> --replace', '',
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
  up: [
    'Usage:', '  bowerloom up --team <name> [--goal <goal>] [--name <project-name>] [--approve <revision>] [--json]', '',
    'Prepares this project for a team, one step at a time, and starts no workers.',
    'Each run looks at the project and shows the one next step:',
    '  init    when no folder above holds .bowerloom: sets up this folder. It needs --goal; the project name is the',
    '          folder name unless you pass --name, and <name> becomes the display name of first-team.',
    '  team    when <name> is neither first-team (its id or display name) nor a team you created: team create <name>.',
    '  sync    when .bowerloom/skills.json has skills of the team to install: skills sync --team <team>.',
    '  apply   when skills or prompts of the team need copies for Claude Code and Codex: apply.',
    'At the end it prints "prepared, workers held", points to .bowerloom/START-HERE.md, and exits 4. When a skill, prompt',
    'or team is held or gone, it prints "prepared, N items held" instead, with the next command for each item.',
    'In a terminal it asks before each step. Agents pass --approve <revision>: the step whose revision matches is',
    'applied, then the next plan is shown with its revision (exit 3). If the next plan then refuses, the refusal says',
    'that the step was applied.',
    'With --json, every line is one JSON document: an --approve run prints the result of the step it applied,',
    'then the next plan. Read stdout line by line.',
    'It never edits AGENTS.md or CLAUDE.md, and never runs claude, codex or any other program.',
    'bowerloom up --demo --pro|--5x|--20x --installation <private.json> still runs the demo session. See bowerloom help advanced.', '',
  ].join('\n'),
  apply: [
    'Usage:', '  bowerloom apply [--harness claude|codex|both] [--approve <revision>] [--json]', '',
    'Puts the skills in .bowerloom/skills.json and the prompts in .bowerloom/prompts in place for Claude Code, Codex,',
    'or both (the default), from what this machine already holds.',
    'Skills go to .claude/skills and .agents/skills. A prompt becomes the Claude Code command .claude/commands/<name>.md',
    'and the Codex skill .agents/skills/prompt-<name>. These copies stay on this machine.',
    'It never fetches: a pin that is not cached yet refuses, and bowerloom skills sync fetches it.',
    'It adds copies for the harness you choose and never removes one. A copy you changed is held, never overwritten.',
    'It never edits AGENTS.md or CLAUDE.md: it prints a line you can add there yourself.',
    'It shows the plan first. Agents pass --approve <revision> or --json. It starts no workers and runs nothing.', '',
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
    'When the file of a prompt you created is gone, the same command puts it back with the text it was created with.',
    'The name is the prompt id, such as weekly-update, at most 57 characters.',
    '--team limits the prompt to a team that exists; without it, every team gets it.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.',
    'It writes inside .bowerloom only. It starts no workers and runs nothing.', '',
  ].join('\n'),
};

/** The exit codes: 0 done, 1 refused, 2 usage, 3 approval required, 4 held by a gate, 130 stopped at a prompt. */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 130;
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

// Freeze review finding 3: Ctrl-C or Ctrl-D at a "[y/N]" prompt. Membership is the error object itself, as above.
const stoppedAtPrompt = new WeakSet<object>();
/**
 * The stop of a person who pressed Ctrl-C or Ctrl-D at a prompt: exit 130, never the generic failure words.
 * `applied` names a step of the same run that was applied before the prompt, so the words stay true.
 */
export function promptStopped(applied?: string): DefinitionError {
  const error = new DefinitionError('APPROVAL_STOPPED', applied ? `Stopped. The ${applied} step was applied, and nothing else was changed.` : 'Stopped. Nothing was changed.');
  stoppedAtPrompt.add(error); return error;
}
export const isPromptStopped = (error: unknown): error is DefinitionError => typeof error === 'object' && error !== null && stoppedAtPrompt.has(error);
const codeOf = (error: unknown): string | null =>
  error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,100}$/.test(error.code) ? error.code : null;

/**
 * The exit code for a command's outcome: `null` when it finished, else the error it raised.
 * USAGE is 2 for every command. 3 and 4 only for an error from newCommandRefusal; any other error, whatever its code, is 1.
 */
export function exitCodeFor(error: unknown): ExitCode {
  if (error === null) return 0;
  if (isPromptStopped(error)) return 130;
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

// Freeze review finding 5: a folder with no project starts with up, never with the init plumbing.
const INIT_NEXT = 'bowerloom up --team <name> --goal <goal>';
interface Words { readonly sentence: string; readonly next: string }
const REFUSALS: Readonly<Record<string, Words>> = {
  USAGE: { sentence: 'Nothing was changed.', next: 'bowerloom help' },
  APPROVAL_DECLINED: { sentence: 'Bowerloom applies a plan only when you answer y.', next: 'run the same command again to see the plan' },
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
  SKILLS_ADD_EXISTS: { sentence: 'skills.json already pins this. To move that skill to another version or commit, add --replace.', next: 'bowerloom skills add <source> --id <id> --replace' },
  SKILLS_ADD_SOURCE_CHANGED: { sentence: '--replace keeps the npm package or GitHub repository and moves only its version or commit. To use another source, add it under a new id.', next: 'bowerloom skills check' },
  SKILLS_ADD_REPLACE_MISSING: { sentence: 'There is no skill with this id to replace.', next: 'bowerloom skills check' },
  SKILLS_ADD_NOT_FOUND: { sentence: 'Check the package name, version, commit and folder.', next: 'bowerloom help skills' },
  SKILLS_ADD_SKILL_MISSING: { sentence: 'A skill folder holds a SKILL.md file at its top.', next: 'bowerloom help skills' },
  SKILLS_ADD_LICENSE_UNKNOWN: { sentence: 'This beta installs a skill only when its MIT or Apache-2.0 license is shipped with it.', next: 'bowerloom help skills' },
  SKILLS_ADD_UNSAFE_CONTENT: { sentence: 'Skills here are text files only, and nothing in them is run.', next: 'bowerloom help skills' },
  SKILLS_ADD_NETWORK: { sentence: 'Nothing was changed.', next: 'run the same command again' },
  SKILLS_ADD_HOST_REFUSED: { sentence: 'Bowerloom asked no other host, and nothing was changed.', next: 'bowerloom help skills' },
  TEAM_NOT_FOUND: { sentence: 'A skill or prompt can be limited only to a team that exists.', next: 'bowerloom ls teams' },
  TEAM_EXISTS: { sentence: 'Each team needs its own id.', next: 'bowerloom ls teams' },
  TEAM_ID_RESERVED: { sentence: 'Setup made first-team, so a new team needs another id.', next: 'bowerloom team create <another-name>' },
  TEAM_NAME_TAKEN: { sentence: 'bowerloom up --team takes first-team by its id or its display name, so a new team needs another id.', next: 'bowerloom team create <another-name>' },
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
  AUTHORING_WRITE_INTERRUPTED: { sentence: 'Part of the item may be in place, and the next plan shows how it is finished or cleared.', next: 'run the same command again, without --approve, to see the new plan' },
  AUTHORING_ITEM_MISSING: { sentence: 'Bowerloom reports a created item that is gone, so it is not lost silently.', next: 'bowerloom status' },
  PROMPT_RESTORE_TEAMS: { sentence: 'A restore puts the prompt back as it was created, with the same teams.', next: 'bowerloom prompt create <name>' },
  PROMPT_RESTORE_UNAVAILABLE: { sentence: 'Create writes only the text it would write today, and the record names other text.', next: 'git restore .bowerloom/prompts' },
  APPLY_NAME_COLLISION: { sentence: 'Bowerloom never overwrites what it did not install, and two items cannot share one place.', next: 'bowerloom apply' },
  PROMPT_INVALID: { sentence: 'Bowerloom reads only plain prompt files you own.', next: 'ls -l .bowerloom/prompts' },
  SKILLS_OFFLINE: { sentence: 'Only bowerloom skills sync fetches, and only the pins that are not cached yet.', next: 'bowerloom skills sync' },
  SKILLS_SYNC_CONTENT_MISMATCH: { sentence: 'Bowerloom installs only bytes that match skills.json exactly, so it stopped before any change to the project.', next: 'bowerloom skills check' },
  SKILLS_SYNC_INTERRUPTED: { sentence: 'Every skill it finished is complete, and the rest are untouched.', next: 'bowerloom skills sync' },
  SKILLS_SYNC_LIMIT: { sentence: 'This beta syncs at most 64 skills at once.', next: 'bowerloom skills check' },
  SKILLS_CACHE_RECOVERY_REQUIRED: { sentence: 'The private cache needs a look before this pin can be read.', next: 'bowerloom help advanced' },
  SKILLS_STATE_UNSAFE: { sentence: 'Bowerloom keeps receipts and the cache in a private folder that only you can change, outside the project.', next: 'check the private state folder: $XDG_STATE_HOME/bowerloom when XDG_STATE_HOME is set, else ~/.local/state/bowerloom' },
  SKILLS_STATE_STRAY_ENTRY: { sentence: 'Bowerloom keeps only its own operation folders there, and changes nothing it did not make.', next: 'move the named entry out of the private state folder with mv' },
  SKILLS_RECOVER_NOTHING: { sentence: 'Nothing of this item is unfinished.', next: 'bowerloom status' },
  SKILLS_MIGRATE_NOTHING: { sentence: 'The project has no .bowerloom-skills folder.', next: 'bowerloom skills sync' },
  SKILLS_MIGRATE_STATE_INVALID: { sentence: 'Migrate needs the private state folder the earlier install was made with.', next: 'bowerloom help skills' },
  SKILLS_MIGRATE_NOT_IN_MANIFEST: { sentence: 'skills.json must pin the installed skill before it can be migrated.', next: 'bowerloom skills check' },
  MANAGED_SKILL_LEGACY_PRESENT: { sentence: 'Skills from an earlier Bowerloom must be migrated before sync can manage this project.', next: 'bowerloom skills migrate plan --state <earlier-state-folder>' },
  MANAGED_SKILL_RECOVERY_REQUIRED: { sentence: 'A change was interrupted inside one skill, and Bowerloom changes nothing else until it is recovered.', next: 'bowerloom skills recover plan --item <id>' },
  MANAGED_SKILL_LOCAL_DRIFT: { sentence: 'Bowerloom never overwrites a copy you changed.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_PATH_OCCUPIED: { sentence: 'Something Bowerloom did not install is where a copy goes.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_HISTORY_FULL: { sentence: 'Bowerloom deletes no history by itself.', next: 'bowerloom skills sync' },
  // Freeze review finding 14: the managed codes that pass through from managed-skills.
  MANAGED_SKILL_STALE_APPROVAL: { sentence: 'A copy changed after you approved the plan, so Bowerloom stopped before that copy.', next: 'run the same command again, without --approve, to see the new plan' },
  MANAGED_SKILL_LOCKED: { sentence: 'Two commands must not change one project at the same time.', next: 'run the same command again when the other command is done' },
  MANAGED_SKILL_LOCK_NOT_HELD: { sentence: 'Bowerloom stops when it cannot show that it still holds the project lock.', next: 'bowerloom status' },
  MANAGED_SKILL_LOCK_SLOT_COLLISION: { sentence: 'The lock uses a local port, and another program is listening on it.', next: 'lsof -nP -iTCP:<port> -sTCP:LISTEN' },
  MANAGED_SKILL_ABORTED: { sentence: 'The change stopped before it finished. Status shows any item that needs recovery.', next: 'bowerloom status' },
  MANAGED_SKILL_TIMEOUT: { sentence: 'A step ran past its time limit, so Bowerloom stopped it. Status shows any item that needs recovery.', next: 'bowerloom status' },
  MANAGED_SKILL_REFUSED: { sentence: 'A safety check of the copies failed, so Bowerloom changed nothing more.', next: 'bowerloom status' },
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
  if ((code === 'PROJECT_LOCK_SLOT_COLLISION' || code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION') && validPort(detail.port)) {
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
  // Freeze review finding 3: a stop at a prompt is not a failure. A terminal gets one plain line.
  if (isPromptStopped(error)) return { text: tty ? `${plainText(error.message)}\n` : `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`, exitCode: 130 };
  // Freeze review finding 4: in a terminal, workers held is the successful end of up, already printed on stdout.
  // Agents keep the JSON envelope on a pipe.
  if (tty && marked(error) && error.code === 'WORKERS_HELD') return { text: '', exitCode: 4 };
  const code = codeOf(error) ?? 'IO_ERROR';
  const safe = error instanceof DefinitionError ? error : new DefinitionError(code, 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.');
  const port = error instanceof DefinitionError && 'port' in error ? (error as { port?: unknown }).port : undefined;
  const hint = error instanceof DefinitionError && 'hint' in error ? (error as { hint?: unknown }).hint : undefined;
  const detail: RefusalDetail = { raisedByNewCommand: marked(error), ...(validPort(port) ? { port } : {}), ...(hint === LEFTOVER_TEMP_LINK ? { hint } : {}) };
  const exitCode = exitCodeFor(marked(error) ? error : safe) as Exclude<ExitCode, 0>;
  return { text: tty ? renderRefusal(safe.code, safe.message, detail) : `${JSON.stringify({ error: { code: safe.code, message: safe.message } })}\n`, exitCode };
}
