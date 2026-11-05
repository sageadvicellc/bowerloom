/**
 * The fixed words of the Export and Import sheets (journey 4). The same shape and limits as WORDS (words.ts): a label at most 5 words, a hint at most 12, a paragraph at
 * most 25, and none of the banned words. "Export" and "Import" are allowed here: they name the sheets and the buttons (DESIGN_WORDS). The words that come from a
 * file (a name, a command, a host, a path) are shown as main passed them, and are never part of this table. tests/share-words.test.ts holds the table to the limits.
 */
import type { ShareCodeFile, ShareSecret, ShareSink, ShareSummary, ShareTool } from '../../shared/engine/types.js';
import { EXPORT_TARGET_IN_HARNESS_WORDS, SHARE_LIST_LIMIT } from '../../shared/engine/types.js';

/** The refusal for a save place inside the harness: main's own sentence, shown alone. */
export { EXPORT_TARGET_IN_HARNESS_WORDS };

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const SHARE = deepFreeze({
  label: {
    exportTitle: 'Export a harness', importTitle: 'Import a harness', export: 'Export', import: 'Import', importFromFile: 'Import from a file',
    chooseFile: 'Choose a file', chooseAnother: 'Choose another file',
    stepFile: 'File', stepFolder: 'Folder', stepReview: 'Review', stepDone: 'Done', steps: 'Steps',
    bodyExport: 'Review the export', bodyExported: 'Export done', bodyFile: 'Choose a file', bodyFolder: 'Pick a folder', bodyReview: 'Review the import', bodyDone: 'Import done',
    file: 'File', harness: 'Harness', into: 'Into',
    checkHead: 'Check before you go on',
    toolsHead: 'Tools it uses', codeHead: 'Files that can run', secretsHead: 'Values it reads', notesHead: 'Notes folders', borrowedHead: 'Borrowed items',
    pathsOther: 'Paths from another computer', pathsHere: 'Paths from this computer', writesHead: 'Files it writes', notesChoice: 'Notes folders to link',
    environment: 'Environment', headers: 'Headers', addressPath: 'Address path',
    server: 'Tool server', hook: 'Hook, runs on its own', variable: 'Variable', keychain: 'Keychain entry', runsCode: 'Starts a program', reaches: 'Reaches', event: 'Event', command: 'Command', arguments: 'Arguments',
    link: 'Link a folder', change: 'Change folder', leave: 'Leave out', leaveAll: 'Leave all out', linkedTo: 'Linked to', readBy: 'Read by', line: 'Line', usedBy: 'Used by',
    showAll: 'Show all', showLess: 'Show less', showAllFiles: 'Show all files', showFewer: 'Show fewer files',
    exported: 'Exported', openingFile: 'Opening the file',
  },
  hint: {
    exportWrites: 'Nothing is written until you choose where to save.',
    exportDone: 'The file is written. Nothing else changed.', savedWhere: 'Saved where you chose.',
    fileFoot: 'Bowerloom reads the file once. Nothing is written yet.', folderFoot: 'Nothing is written yet. Pick the folder that gets it.',
    secretsExport: 'The file names these values. It never holds them.',
    secretsImport: 'The file passes these values from this computer to these tools.',
    secretsGo: 'They go to the tools and hosts shown.',
    notChecked: 'Bowerloom did not check that these exist.',
    notesOut: 'The file holds the names only. No folder is in it.',
    notesImport: 'Link a notes folder, or leave the name out.',
    leaveDefault: 'Left out unless you link one.',
    codeNote: 'This list is a guide. A text file can still hold commands.',
    pathsExport: 'These files name a path on this computer. They stay as written.',
    pathsImport: 'These files name a path on another computer. They stay as written.',
    otherPerson: 'This file came from another person. Check what runs before you import.',
    unsavedNote: 'Your unsaved changes are not in the file.',
    nothingRuns: 'Nothing here runs. No value leaves this computer.',
    notInstalled: 'Nothing is installed. Nothing has run.',
    holdsParts: 'Has a harness. Choose an empty folder.', emptyHarness: 'Has an empty harness.', noHarnessYet: 'No harness yet. Import makes one.', harnessUnknown: 'Has a harness. It must be empty.',
    noSinks: 'No tool is named.', noFile: 'Choose a file to go on.', noFolderPicked: 'Pick a folder to go on.',
    noFolders: 'No folder yet. Choose one to start.', chooseFolderHint: 'Pick the folder that gets the harness.',
    cancelledExport: 'You did not save. Nothing was written.', cancelledImport: 'You did not approve. Nothing was written.',
    approvalCleared: 'Approval cleared. Tick again before you import.',
    credentials: 'The address holds a user name or password.', backslash: 'The address uses a backslash.', scheme: 'The address is not a web address.', unreadable: 'The address cannot be read.',
    executable: 'Has the run permission.', hookFile: 'The file of a hook.', script: 'A script.', shebang: 'Starts as a program.', binary: 'Holds the bytes of a program.',
    manifest: 'Lists commands.', extension: 'Has a code file name.', notData: 'Is not a plain data file.',
    fieldEnv: 'an environment value', fieldHeader: 'a header', fieldArg: 'an argument', fieldUrl: 'the address', fieldCommand: 'the command',
    stdio: 'Starts a program on this computer.', http: 'Connects to a web address.', downloads: 'This downloads code at start.',
    tickExport: 'I accept these paths from this computer in the file.',
    tickRead: 'I read what runs and where my values go.', tickReadPaths: 'I read what runs, where my values go and the paths.',
    tickFirst: 'I read the lists shown. More are not shown.',
    blockNone: 'Ready. Press the button to go on.',
    blockBoth: 'Tick both boxes to import.', blockRead: 'Tick the first box to import.', blockWrite: 'Tick the second box to import.', blockPlanning: 'Planning. Then tick again.',
    blockExport: 'Tick the box to export.', blockOne: 'Tick the box to import.', planFailed: 'The plan could not be made. Plan again.', sudoLine: 'This runs with admin rights.', blockNoop: 'The folder already matches. Nothing to import.',
    shellLine: 'This runs text as code.', changesStart: 'This makes the program load extra code.', proxyTraffic: "This sends the program's traffic through another host.", hiddenFields: 'Carries engine settings that are not listed here:', fromThisComputer: 'The value comes from this computer.', toolsNote: 'This list is a guide. Read each command.',
  },
  paragraph: {
    exportIntro: 'Export writes the saved harness to one file. You choose where it goes.',
    importIntro: 'Import reads one harness file and shows what is in it. Nothing is written until you read it and approve.',
    folderIntro: 'Pick the folder that gets the harness. Import goes only into a folder with no harness, or an empty one.',
    reviewIntro: 'Import only writes files, into the .bowerloom folder. Nothing runs until you install. It keeps a save point before and after.',
  },
} as const);

/** The reason a file can run, in words. */
export const CODE_WHY_WORDS: Readonly<Record<ShareCodeFile['why'], string>> = Object.freeze({
  executable: SHARE.hint.executable, hook: SHARE.hint.hookFile, script: SHARE.hint.script, shebang: SHARE.hint.shebang, binary: SHARE.hint.binary,
  manifest: SHARE.hint.manifest, extension: SHARE.hint.extension, 'not-data': SHARE.hint.notData,
});
/** What is odd about a tool's address, in words. */
export const FLAG_WORDS: Readonly<Record<ShareTool['flags'][number], string>> = Object.freeze({
  credentials: SHARE.hint.credentials, backslash: SHARE.hint.backslash, scheme: SHARE.hint.scheme, unreadable: SHARE.hint.unreadable,
});
const FIELD_WORDS: Readonly<Record<ShareSink['field'], string>> = Object.freeze({
  env: SHARE.hint.fieldEnv, header: SHARE.hint.fieldHeader, arg: SHARE.hint.fieldArg, url: SHARE.hint.fieldUrl, command: SHARE.hint.fieldCommand,
});

/**
 * What to do next after each refusal of the share calls, under the refusal's own words. The package codes (BUNDLE_*) and main's, each once. A code that is not here
 * shows its own words alone: that includes the three refusals whose own words already end with the step to take (a tick not made, or no harness to export).
 */
export const SHARE_REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  BUNDLE_USAGE: 'Close the sheet and open it again.',
  BUNDLE_FORMAT: 'Choose a file that Bowerloom exported.',
  BUNDLE_TOO_LARGE: 'Choose a smaller file.',
  BUNDLE_DAMAGED: 'Ask for the file again. This copy is not whole.',
  BUNDLE_PATH_UNSAFE: 'Do not use this file. Ask for a new one.',
  BUNDLE_SECRET_FOUND: 'Do not use this file. Ask for one with no secret value.',
  BUNDLE_INVALID: 'Ask for a file that loads, or fix the files named.',
  BUNDLE_FILE_UNSAFE: 'Choose a plain file of your own.',
  BUNDLE_FILE_FAILED: 'Check the disk and the folder, then try again.',
  BUNDLE_EXISTS: 'Choose another name.',
  IMPORT_FOLDER_HAS_HARNESS: 'Choose another folder, or an empty one.',
  FAILED: 'Try again. If it fails again, report a problem.',
  SAVE_NO_DEFINITION: 'Choose the folder again, then plan the import again.',
  SAVE_STALE: 'The folder changed since. Plan the import again.',
  SAVE_EXECUTABLE_UNACKNOWLEDGED: 'Tick that you read the files that can run, then import.',
  SAVE_RECOVERY_REQUIRED: 'Finish the stopped change first, then import.',
  NOT_THE_PLAN_SHOWN: 'The plan changed. Plan again, then approve it.',
  QUIT_BEGUN: 'Open Bowerloom again, then share again.',
  CANCELLED: 'Nothing was written. Press the button again when you are ready.',
});

/**
 * What to do next after a worker thread stopped, keyed on the cause main puts in `refusal.step`. It does not say "try again": a write that stopped may have left a stopped
 * save, and a plan is refused until that is finished.
 */
export const WORKER_NEXT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  WORKER_CRASHED: 'Open the folder again. Finish any stopped save first.',
  WORKER_OUT_OF_MEMORY: 'Choose a smaller file. Finish any stopped save first.',
  WORKER_NOT_STARTED: 'Close Bowerloom and open it again.',
  WORKER_TIMED_OUT: 'Open the folder again. Finish any stopped save first.',
});

/** The next-step line under a refusal: by the cause of a stopped worker when it names one, else by the code. Undefined when the refusal's own words are enough. */
export function nextWordsOf(refusal: { readonly code: string; readonly step?: string | undefined }): string | undefined {
  if (refusal.step !== undefined && Object.hasOwn(WORKER_NEXT_WORDS, refusal.step)) return WORKER_NEXT_WORDS[refusal.step];
  return Object.hasOwn(SHARE_REFUSAL_WORDS, refusal.code) ? SHARE_REFUSAL_WORDS[refusal.code] : undefined;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "and 12 more", under a list that main cut. */
export const moreWords = (n: number): string => `and ${n} more`;
/** The size of a file, as a person reads it. */
export function fileSizeWords(bytes: number): string {
  if (bytes < 1024) return plural(bytes, 'byte', 'bytes');
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** The file an export will offer, with its size. */
export const exportFileWords = (file: string, bytes: number): string => `${file}, ${fileSizeWords(bytes)}`;
/** The write button of an import. Before a plan is shown there is no count. */
export const importFilesWords = (n: number | null): string => (n === null ? 'Import' : `Import ${plural(n, 'file', 'files')}`);
/** What a bundle holds, in one line: the counts that are not zero, the files and the size. */
export function summaryLine(summary: ShareSummary): string {
  const c = summary.counts;
  const parts = [
    c.skills > 0 ? plural(c.skills, 'skill', 'skills') : null, c.agents > 0 ? plural(c.agents, 'agent', 'agents') : null, c.mcp > 0 ? plural(c.mcp, 'tool', 'tools') : null,
    c.hooks > 0 ? plural(c.hooks, 'hook', 'hooks') : null, c.guardrails > 0 ? plural(c.guardrails, 'guardrail', 'guardrails') : null, c.scripts > 0 ? plural(c.scripts, 'script', 'scripts') : null,
    plural(c.files, 'file', 'files'), fileSizeWords(c.bytes),
  ];
  return parts.filter((p): p is string => p !== null).join(', ');
}
/** The words for a transport. An unknown one is shown as the file wrote it, by the caller. */
export const transportWords = (transport: string | null): string | null => (transport === 'stdio' ? SHARE.hint.stdio : transport === 'http' || transport === 'sse' || transport === 'streamable-http' ? SHARE.hint.http : null);
const EVENT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  PreToolUse: 'Runs before each tool use.', PostToolUse: 'Runs after each tool use.', SessionStart: 'Runs when a session starts.', SessionEnd: 'Runs when a session ends.',
  UserPromptSubmit: 'Runs when you send a prompt.', Stop: 'Runs when the agent stops.', SubagentStop: 'Runs when a helper stops.', Notification: 'Runs on each notice.', PreCompact: 'Runs before the chat is shortened.',
});
/** The words for a hook event, or null for one that is not known. The raw event is shown beside it. */
export const eventWords = (event: string): string | null => (Object.hasOwn(EVENT_WORDS, event) ? EVENT_WORDS[event]! : null);
const DOWNLOADERS = new Set(['npx', 'uvx', 'pipx', 'bunx']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
/** The name of a program without its folder (a path may use / or \\) and without a Windows extension, in lower case. */
const baseName = (command: string): string => (command.split(/[\\/]/).pop() ?? command).replace(/\.(?:cmd|exe|bat|com)$/i, '').toLowerCase();
/** Options of `env` and `sudo` that take a value in the next word. */
const TAKES_VALUE = new Set(['-u', '--unset', '-C', '--chdir', '-P', '--default-path', '-g', '--group', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-D', '--chdir']);
/** The letters of a short option that take a value, by wrapper: `env -iu A` takes `A`, `env -iSx` splits `x`. */
const CLUSTER_VALUE: Readonly<Record<string, string>> = Object.freeze({ env: 'uCPS', sudo: 'ughprtCD', doas: 'ucC' });
/** The most wrappers followed. A line nested deeper is flagged, not passed. */
const WRAPPER_GUARD = 64;
/**
 * The program a command line really starts. `env` and `sudo` are skipped with their options (the value of `-u`, `-C`, `-P` and the like is not the program, also inside a
 * cluster such as `-iu A`), the words of `env -S` and `--split-string=` are split, and a VAR=value word is skipped. A word that is not text is ignored, so one bad row cannot
 * stop the review from drawing. `exhausted` is true when the wrappers went deeper than the guard: the callers treat that as flagged.
 */
function realCommand(command: string, args: readonly unknown[]): { command: string; args: readonly string[]; wrappers: readonly string[]; exhausted: boolean } {
  let c = baseName(command), rest: string[] = args.filter((a): a is string => typeof a === 'string');
  const wrappers: string[] = [], isWrapper = (name: string): boolean => name === 'env' || name === 'sudo' || name === 'doas';
  const split = (text: string): string[] => text.split(/\s+/).filter(x => x !== '');
  for (let guard = 0; guard < WRAPPER_GUARD && isWrapper(c); guard += 1) {
    let at = 0;
    while (at < rest.length) {
      const a = rest[at]!;
      if (c === 'env' && (a === '-S' || a === '--split-string')) { rest = [...split(rest[at + 1] ?? ''), ...rest.slice(at + 2)]; at = 0; continue; }
      if (c === 'env' && a.startsWith('--split-string=')) { rest = [...split(a.slice('--split-string='.length)), ...rest.slice(at + 1)]; at = 0; continue; }
      if (c === 'env' && a.startsWith('-S') && a.length > 2) { rest = [...split(a.slice(2)), ...rest.slice(at + 1)]; at = 0; continue; }
      if (a === '--') { at += 1; break; }
      if (a.startsWith('-')) {
        const cluster = /^-[A-Za-z]{2,}$/.test(a) ? [...a.slice(1)].findIndex(ch => (CLUSTER_VALUE[c] ?? '').includes(ch)) : -1;
        if (cluster >= 0) {
          const letter = a[cluster + 1]!;
          // `-iSx y`: the rest of the cluster is the split string. `-iu A`: the next word is the value.
          if (c === 'env' && letter === 'S' && cluster + 2 < a.length) { rest = [...split(a.slice(cluster + 2)), ...rest.slice(at + 1)]; at = 0; continue; }
          if (c === 'env' && letter === 'S') { rest = [...split(rest[at + 1] ?? ''), ...rest.slice(at + 2)]; at = 0; continue; }
          at += cluster + 2 === a.length ? 2 : 1; continue;
        }
        at += TAKES_VALUE.has(a) ? 2 : 1; continue;
      }
      if (c === 'env' && a.includes('=')) { at += 1; continue; }
      break;
    }
    wrappers.push(c);
    const next = rest[at];
    if (next === undefined) return { command: c, args: [], wrappers, exhausted: false };
    c = baseName(next); rest = rest.slice(at + 1);
  }
  return { command: c, args: rest, wrappers, exhausted: isWrapper(c) };
}
/**
 * The command lines a tool's checks read, each as a program and its words. A hook holds a whole command line in `command`, so it is split on `;`, `&&`, `||` and `|` into
 * simple commands, and each on white space; a server has the program in `command` and the words in `args`. A value that is not text gives no line, so one bad row cannot
 * stop the review from drawing.
 */
export function checkParts(tool: Pick<ShareTool, 'kind' | 'command' | 'args'>): { command: string | null; args: readonly string[] }[] {
  const args = Array.isArray(tool.args) ? tool.args.filter((a): a is string => typeof a === 'string') : [];
  if (typeof tool.command !== 'string') return [{ command: null, args }];
  if (tool.kind !== 'hook') return [{ command: tool.command, args }];
  const lines = tool.command.split(/&&|\|\||;|\|/).map(line => line.split(/\s+/).filter(x => x !== '')).filter(words => words.length > 0);
  return lines.length === 0 ? [{ command: tool.command, args }] : lines.map((words, i) => ({ command: words[0]!, args: i === lines.length - 1 ? [...words.slice(1), ...args] : words.slice(1) }));
}
/**
 * True when the command fetches code before it runs: npx, uvx, pipx, bunx, `npm exec`, `pnpm dlx`, `yarn dlx`, `bun x`, `deno run`, `uv run`, `docker run`, also behind `env` or
 * `sudo`. A hint beside the command, never a gate: silence is not safety.
 */
export const downloadsCode = (command: string | null, args: readonly unknown[]): boolean => {
  if (typeof command !== 'string') return false;
  const r = realCommand(command, args), first = r.args[0];
  if (r.exhausted) return true;
  if (DOWNLOADERS.has(r.command)) return true;
  return (r.command === 'docker' && first === 'run') || (r.command === 'npm' && first === 'exec') || ((r.command === 'pnpm' || r.command === 'yarn') && first === 'dlx')
    || (r.command === 'bun' && first === 'x') || (r.command === 'deno' && first === 'run') || (r.command === 'uv' && first === 'run');
};
/** The flags that hand an interpreter a piece of code or a command line to run. */
const INLINE: Readonly<Record<string, RegExp>> = Object.freeze({
  node: /^(?:-e|--eval\b(?:=.*)?|-p|--print(?:=.*)?)$/, ruby: /^-e$/, perl: /^-e$/, php: /^-r$/, cmd: /^\/[ck]$/i, powershell: /^-(?:c|command|e|ec|enc|encodedcommand)$/i, pwsh: /^-(?:c|command|e|ec|enc|encodedcommand)$/i,
});
/**
 * True when the command hands a shell or an interpreter a command line or code to run (`sh -c`, `bash -lc`, `node -e`, `node --eval=`, `python -c`, `python -m`, `deno eval`, `cmd /c`, `powershell -Command`), text the
 * person must read in full.
 */
export const runsShellLine = (command: string | null, args: readonly unknown[]): boolean => {
  if (typeof command !== 'string') return false;
  const r = realCommand(command, args), name = /^python[0-9.]*$/.test(r.command) ? 'python' : r.command;
  if (r.exhausted) return true;
  if (SHELLS.has(name)) return r.args.some(a => /^-[a-z]*c[a-z]*$/.test(a));
  if (name === 'python') return r.args.some(a => /^-[A-Za-z]*[cm]$/.test(a));
  if (name === 'deno') return /^eval$/.test(r.args[0] ?? '');
  const re = Object.hasOwn(INLINE, name) ? INLINE[name] : undefined;
  return re !== undefined && r.args.some(a => re.test(a));
};
/** True when the command starts with `sudo` or `doas`: it runs with admin rights. */
export const runsAsAdmin = (command: string | null, args: readonly unknown[]): boolean => {
  if (typeof command !== 'string') return false;
  const r = realCommand(command, args);
  if (r.exhausted) return true;
  return r.wrappers.includes('sudo') || r.wrappers.includes('doas');
};
/** The names of variables that make a program run extra code when it starts. */
export const CODE_ENV_NAMES: ReadonlySet<string> = new Set([
  'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_LIBRARY_PATH', 'PATH', 'BASH_ENV', 'ENV', 'PYTHONSTARTUP', 'PYTHONPATH', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'PERL5OPT', 'RUBYOPT',
  'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'PYTHONHOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'SSL_CERT_FILE', 'GIT_SSH_COMMAND', 'PROMPT_COMMAND', 'LD_AUDIT', 'DYLD_FRAMEWORK_PATH',
]);
/** The names that send the program's traffic through another host. */
export const PROXY_ENV_NAMES: ReadonlySet<string> = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']);
/** The line under a variable that changes how a program starts or where its traffic goes. */
export const envNameWords = (name: string): string | null => (PROXY_ENV_NAMES.has(name.toUpperCase()) ? SHARE.hint.proxyTraffic : changesStart(name) ? SHARE.hint.changesStart : null);
/** True when a variable name changes how a program starts. Windows names ignore case, so the check does too. */
export const changesStart = (name: string): boolean => CODE_ENV_NAMES.has(name.toUpperCase());
/** True when a value is read from this computer: a `${NAME}` reference or a keychain reference. */
export function fromThisComputer(value: string): boolean {
  const at = value.indexOf('${');
  return (at >= 0 && value.indexOf('}', at + 2) >= 0) || /^\s*\{\s*"keychain"\s*:/.test(value);
}
/** Where a reference goes: the tool, the field of it, and the host. A program with no host can send the value anywhere. */
export function sinkWords(sink: ShareSink): string {
  if (sink.host !== null) return `${sink.tool}, in ${FIELD_WORDS[sink.field]}, to ${sink.host}`;
  if (sink.field === 'env' || sink.field === 'arg' || sink.field === 'command') return `Passed to the program ${sink.tool}, in ${FIELD_WORDS[sink.field]}. It can send it anywhere.`;
  return `${sink.tool}, in ${FIELD_WORDS[sink.field]}`;
}
/** The kind of a reference, in words. */
export const secretKindWords = (secret: ShareSecret): string => (secret.kind === 'env' ? SHARE.label.variable : SHARE.label.keychain);
/** The name of a notes choice group, for a screen reader. */
export const notesChoiceName = (name: string): string => `Notes ${name}`;
/** The name of a notes choice button. */
export const notesButtonName = (choice: string, name: string): string => `${choice}: ${name}`;
/** The line under a list of files the import writes. */
export const writesCount = (n: number): string => plural(n, 'file', 'files');
/** The name of the tick that approves an import plan. */
export const approveImportName = (harness: string): string => `Import ${harness}`;

/** The rows of a list that main cut: the count of those it did not send. */
const hiddenIn = (list: { readonly rows: readonly unknown[]; readonly more: number }): number => list.more + Math.max(0, list.rows.length - SHARE_LIST_LIMIT);
/** What the summary hides: the rows past the cut, by list. */
export function hiddenCounts(summary: ShareSummary): { tools: number; codeFiles: number; secrets: number; foreignPaths: number; total: number } {
  const tools = hiddenIn(summary.tools), codeFiles = hiddenIn(summary.codeFiles), secrets = hiddenIn(summary.secrets), foreignPaths = hiddenIn(summary.foreignPaths);
  return { tools, codeFiles, secrets, foreignPaths, total: tools + codeFiles + secrets + foreignPaths };
}
const LIST_NAMES = { tools: 'tools', codeFiles: 'files', secrets: 'values', foreignPaths: 'paths' } as const;
/**
 * The words of the first tick of an import, from what the summary holds. When a list was cut, the tick says so, so a tick never claims more than was shown: one cut
 * list is named with its count, and more than one says the lists shown were read.
 */
export function importTickWords(summary: ShareSummary): string {
  const h = hiddenCounts(summary), cut = (['tools', 'codeFiles', 'secrets', 'foreignPaths'] as const).filter(key => h[key] > 0);
  const paths = summary.foreignPaths.rows.length > 0 || h.foreignPaths > 0;
  if (cut.length === 1) {
    const key = cut[0]!, name = LIST_NAMES[key];
    return paths && key !== 'foreignPaths' ? `I read ${SHARE_LIST_LIMIT} ${name} and the paths. ${h[key]} ${name} are not shown.` : `I read the ${SHARE_LIST_LIMIT} ${name} shown. ${h[key]} are not shown.`;
  }
  if (cut.length > 1) return SHARE.hint.tickFirst;
  return paths ? SHARE.hint.tickReadPaths : SHARE.hint.tickRead;
}
/** The line that counts the rows a cut hides. */
export const hiddenWords = (n: number): string => `${n} more ${n === 1 ? 'row is' : 'rows are'} not shown.`;
/** The words of the tick that approves a write: how many files, into which folder, and that install is separate. */
export const approveImportWords = (n: number, folder: string, makes: boolean): string => `${makes ? 'Make a harness and write' : 'Write'} ${n === 1 ? 'this file' : `these ${n} files`} into ${folder}. Install is separate.`;
/** The plan line for a folder with no harness. */
export const makesHarnessWords = (n: number): string => `Makes the harness. Writes ${plural(n, 'file', 'files')} in all.`;
/** The first line of the Done step. */
export const importedWords = (n: number, folder: string): string => `Imported ${plural(n, 'file', 'files')} into ${folder}.`;
/** The status line after a file is read. */
export const readFileWords = (name: string, files: number, tools: number): string => `Read ${name}. ${plural(files, 'file', 'files')}, ${plural(tools, 'tool', 'tools')}.`;
/** The words of what blocks the import button now. */
export function importBlockWords(opts: { planning: boolean; needsRead: boolean; approved: boolean; hasRead?: boolean; noop?: boolean }): string {
  if (opts.noop === true) return SHARE.hint.blockNoop;
  if (opts.planning) return SHARE.hint.blockPlanning;
  if (opts.needsRead && !opts.approved) return SHARE.hint.blockBoth;
  if (opts.needsRead) return SHARE.hint.blockRead;
  if (!opts.approved) return opts.hasRead === false ? SHARE.hint.blockOne : SHARE.hint.blockWrite;
  return SHARE.hint.blockNone;
}
/** The line that jumps to a list: what it counts, and what pressing it does. */
export const jumpName = (words: string): string => `${words}. Go to the list.`;
