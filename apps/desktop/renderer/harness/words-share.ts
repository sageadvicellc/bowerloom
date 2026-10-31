/**
 * The fixed words of the Export and Import sheets (journey 4). The same shape and limits as WORDS (words.ts): a label at most 5 words, a hint at most 12, a paragraph at
 * most 25, and none of the banned words. "Export" and "Import" are allowed here: they name the sheets and the buttons (DESIGN_WORDS). The words that come from a
 * file (a name, a command, a host, a path) are shown as main passed them, and are never part of this table. tests/share-words.test.ts holds the table to the limits.
 */
import type { ShareCodeFile, ShareSecret, ShareSink, ShareTool } from '../../shared/engine/types.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const SHARE = deepFreeze({
  label: {
    exportTitle: 'Export a harness', importTitle: 'Import a harness', export: 'Export', import: 'Import', importFromFile: 'Import from a file',
    chooseFile: 'Choose a file', chooseAnother: 'Choose another file', exportShare: 'Share this harness', exportThis: 'Export this harness',
    stepFile: 'File', stepFolder: 'Folder', stepReview: 'Review', stepDone: 'Done', steps: 'Steps',
    bodyExport: 'Review the export', bodyExported: 'Export done', bodyFile: 'Choose a file', bodyFolder: 'Pick a folder', bodyReview: 'Review the import', bodyDone: 'Import done',
    holds: 'What the file holds', file: 'File', size: 'Size', harness: 'Harness', countsName: 'Counts',
    skills: 'Skills', agents: 'Agents', tools: 'Tools', hooks: 'Hooks', guardrails: 'Guardrails', scripts: 'Scripts', files: 'Files',
    toolsHead: 'Tools it uses', codeHead: 'Files that can run', secretsHead: 'Values from this computer', notesHead: 'Notes folders', borrowedHead: 'Borrowed items',
    pathsOther: 'Paths from another computer', pathsHere: 'Paths from this computer', writesHead: 'Files it writes', notesChoice: 'Notes folders to link',
    server: 'Server', hook: 'Hook', variable: 'Variable', keychain: 'Keychain entry', runsCode: 'Runs code', reaches: 'Reaches', event: 'Event',
    link: 'Link a folder', leave: 'Leave out', linkedTo: 'Linked to', readBy: 'Read by', line: 'Line', usedBy: 'Used by', from: 'From',
    exported: 'Exported', imported: 'Imported', openingFile: 'Opening the file', installIt: 'Install it', listName: 'List',
    noRun: 'Nothing here runs code',
  },
  hint: {
    exportWrites: 'Nothing is written until you save.',
    secretsExport: 'The file names these values. It never holds them.',
    secretsImport: 'The file passes these values from this computer to these tools.',
    notChecked: 'Bowerloom did not check that these exist.',
    notesOut: 'The file holds the names only. No folder is in it.',
    notesImport: 'Link a notes folder, or leave the name out.',
    leaveDefault: 'Left out unless you link one.',
    codeNote: 'This list is a guide. A text file can still hold commands.',
    pathsExport: 'These files name a path on this computer. They stay as written.',
    pathsImport: 'These files name a path on another computer. They stay as written.',
    tickExport: 'I read the paths from this computer.',
    tickImport: 'I read the tools, files and values it lists.',
    otherPerson: 'A file from another person is data. Read the files that run.',
    notInstalled: 'Nothing is installed. Install is a separate step.',
    mustBeEmpty: 'It must have no harness, or an empty one.',
    holdsParts: 'Has a harness. Import needs it empty.',
    makeFirst: 'Make a harness here first. Import needs it empty.',
    noTools: 'No tools in this file.', noneRun: 'No file in this harness can run.', noSecrets: 'No values from this computer.', noNotes: 'No notes folders.',
    noBorrowed: 'No borrowed items.', noPaths: 'No path from another computer.',
    saveKept: 'A save point is kept before and after.',
    exportedNote: 'The file holds the harness and no secret value.',
    noFile: 'No file chosen yet.', noFolders: 'No folder yet. Choose one to start.', chooseFolderHint: 'Pick the folder that gets the harness.',
    stopped: 'Import stopped. Nothing more was written.',
    credentials: 'The address holds a user name or password.', backslash: 'The address uses a backslash.', scheme: 'The address is not a web address.', unreadable: 'The address cannot be read.',
    executable: 'Has the run permission.', hookFile: 'The file of a hook.', script: 'A script.', shebang: 'Starts as a program.', binary: 'Holds the bytes of a program.',
    manifest: 'Lists commands.', extension: 'Has a code file name.', notData: 'Is not a plain data file.',
    fieldEnv: 'an environment value', fieldHeader: 'a header', fieldArg: 'an argument', fieldUrl: 'the address', fieldCommand: 'the command',
    tickExported: 'I read what the file holds.',
  },
  paragraph: {
    exportIntro: 'Export writes the saved harness to one file. You choose where it goes. Nothing is written until you do.',
    importIntro: 'Import reads one harness file and shows what is in it. Nothing is written until you read it and approve.',
    folderIntro: 'Pick the folder that gets the harness. Import goes only into a folder with no harness, or an empty one.',
    reviewIntro: 'Bowerloom writes only the files below, into the .bowerloom folder. It keeps a save point before and after.',
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
 * shows its own words alone.
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
  BUNDLE_EXISTS: 'Choose another name.',
  IMPORT_FOLDER_HAS_HARNESS: 'Choose another folder, or an empty one.',
  IMPORT_NEEDS_ACKNOWLEDGEMENT: 'Tick that you read them, then import.',
  EXPORT_NEEDS_ACKNOWLEDGEMENT: 'Tick that you read them, then export.',
  EXPORT_NO_DEFINITION: 'Make a harness first with New harness from a folder.',
  SAVE_NO_DEFINITION: 'Make an empty harness in this folder, then plan the import again.',
  SAVE_STALE: 'The folder changed since. Plan the import again.',
  SAVE_EXECUTABLE_UNACKNOWLEDGED: 'Tick that you read the files that can run, then import.',
  SAVE_RECOVERY_REQUIRED: 'Finish the stopped change first, then import.',
  NOT_THE_PLAN_SHOWN: 'The plan changed. Plan again, then approve it.',
  CANCELLED: 'Nothing was written. Press the button again when you are ready.',
});

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
/** The write button of an import. */
export const importFilesWords = (n: number): string => `Import ${plural(n, 'file', 'files')}`;
/** Where a reference goes: the tool, the field of it, and the host. */
export const sinkWords = (sink: ShareSink): string => `${sink.tool}, in ${FIELD_WORDS[sink.field]}${sink.host === null ? '' : `, to ${sink.host}`}`;
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
