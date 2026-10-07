import { DefinitionError } from '../../../packages/contracts/src/index.js';

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
};

/** Exit codes: 0 done, 1 refused, 2 usage, 3 approval required, 4 held by a gate. */
export function exitCodeFor(code: string): number {
  return code === 'USAGE' ? 2 : code === 'APPROVAL_REQUIRED' ? 3 : code === 'WORKERS_HELD' ? 4 : 1;
}

const INIT_NEXT = 'bowerloom init plan --mode existing --target <directory> --name <name> --goal <goal>';
const REFUSALS: Readonly<Record<string, { sentence: string; next: string }>> = {
  USAGE: { sentence: 'The command line did not match a Bowerloom command, so nothing was changed.', next: 'bowerloom help' },
  APPROVAL_REQUIRED: { sentence: 'This change needs your approval before it is applied.', next: 'run the same command again with --approve <revision>' },
  APPROVAL_DECLINED: { sentence: 'You declined, so nothing was changed.', next: 'run the same command again to see the plan' },
  STALE_APPROVAL: { sentence: 'The plan changed after you saw it, so nothing was applied.', next: 'run the same command again, without --approve, to see the new plan' },
  PROJECT_NOT_FOUND: { sentence: 'Bowerloom looked in this folder and in every parent folder up to your home folder.', next: INIT_NEXT },
  PROJECT_ROOT_REFUSED: { sentence: 'A whole disk or home folder is too broad to be a project.', next: 'cd <project-folder>' },
  PROJECT_IN_CLOUD_FOLDER: { sentence: 'Cloud sync changes file times and moves files, which breaks the checks that keep a project safe.', next: 'mv <project-folder> ~/Projects/' },
  PROJECT_UNSAFE: { sentence: 'Bowerloom will not trust a .bowerloom folder that other people or links can change.', next: 'ls -ld .bowerloom' },
  PROJECT_LOCKED: { sentence: 'Two commands must not change one project at the same time, so nothing was changed.', next: 'bowerloom status' },
  PROJECT_LOCK_UNAVAILABLE: { sentence: 'The lock uses a local port, and this computer would not give it out.', next: 'bowerloom status' },
  PROJECT_LOCK_SLOT_COLLISION: { sentence: 'The lock uses a local port, and another program is listening on it. The message names the port.', next: 'lsof -nP -iTCP:<port> -sTCP:LISTEN' },
  WORKERS_HELD: { sentence: 'The project is prepared. No worker was started.', next: 'bowerloom status' },
};
const GENERIC = { sentence: 'Nothing more is known about this refusal beyond its code.', next: 'bowerloom help' };

/** One refusal in plain words. The fixed refusal code stays visible. */
export function renderRefusal(code: string, message: string): string {
  const { sentence, next } = REFUSALS[code] ?? GENERIC;
  return `Refused (${code}): ${message}\n${sentence}\nNext: ${next}\n`;
}

/**
 * What to print on stderr and which exit code to use. A terminal gets plain words. Anything else gets today's
 * JSON envelope, which agents parse.
 */
export function reportFailure(error: unknown, tty: boolean): { text: string; exitCode: number } {
  const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,100}$/.test(error.code) ? error.code : 'IO_ERROR';
  const safe = error instanceof DefinitionError ? error : new DefinitionError(code, 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.');
  return { text: tty ? renderRefusal(safe.code, safe.message) : `${JSON.stringify({ error: { code: safe.code, message: safe.message } })}\n`, exitCode: exitCodeFor(safe.code) };
}
