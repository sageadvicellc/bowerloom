/**
 * The typed refusals of the notes source. Each has a fixed `NOTES_` code and a fixed message in plain words. `paths`
 * holds paths relative to the notes folder only, never an absolute path and never page content.
 */
import { DefinitionError, oneLine } from '../../contracts/src/index.js';

const MESSAGES = {
  NOTES_USAGE: 'The notes input is not valid.',
  NOTES_FOLDER_MISSING: 'The notes folder, or the folder it would go in, does not exist.',
  NOTES_PATH_UNSAFE: 'A path is not a plain absolute path to a real folder of yours, is a link, or holds a name git cannot take safely. Nothing was changed.',
  NOTES_NOT_EMPTY: 'The folder for the starter wiki is not empty. A starter wiki goes only into a new or empty folder. Nothing was written.',
  NOTES_TEMPLATE_INVALID: 'The starter template is not a list of plain relative files within the limits. Nothing was written.',
  NOTES_STALE: 'The folder changed after the plan, or the approval is for another plan. Nothing was changed. Plan again.',
  NOTES_ALREADY_REPOSITORY: 'The folder already has version history (.git). Nothing was changed.',
  NOTES_PARENT_REPOSITORY: 'This folder already has history in a larger repository, so Bowerloom starts no new one inside it. Nothing was changed.',
  NOTES_NESTED_REPOSITORY: 'A folder inside the notes has its own version history (.git), so one first commit cannot hold it. Nothing was changed.',
  NOTES_GIT_FILES: 'The folder holds a git settings file (.gitignore, .gitattributes, or .gitmodules), which would change what the first commit holds. Nothing was changed.',
  NOTES_NOTHING_TO_COMMIT: 'The folder holds no file for the first commit. Nothing was changed.',
  NOTES_TOO_LARGE: 'The folder holds more entries than Bowerloom lists in one plan. Nothing was changed.',
  NOTES_GIT_MISSING: 'Git is not installed. On a Mac, install the Command Line Tools for Xcode, then try again.',
  NOTES_GIT_ARGV: 'Bowerloom refused to run a git command that is not one of its fixed forms.',
  NOTES_GIT_CONFIG: 'The repository\'s own git settings hold a setting Bowerloom does not allow, such as a filter, an ssh command, a mailmap, or an include, or point git at another folder, which could make git start a program or read outside the repository. Bowerloom runs no git command there. Nothing was changed.',
  NOTES_GIT_TIMEOUT: 'Git took too long, so Bowerloom stopped it.',
  NOTES_GIT_OUTPUT: 'Git printed more than Bowerloom reads, so Bowerloom stopped it.',
  NOTES_GIT_FAILED: 'Git stopped with an error.',
  NOTES_PARTIAL: 'The step stopped part way. The paths listed were written and are left as they are.',
} as const;

export type NotesCode = keyof typeof MESSAGES;
export const NOTES_REFUSAL_CODES: readonly NotesCode[] = Object.freeze(Object.keys(MESSAGES) as NotesCode[]);

/**
 * A notes refusal. `paths` names what it is about, relative to the notes folder. `step`, on NOTES_PARTIAL only, is the
 * refusal that stopped the step part way.
 */
export class NotesRefusal extends DefinitionError {
  declare readonly code: NotesCode;
  constructor(code: NotesCode, readonly paths: readonly string[] = [], readonly step?: NotesCode) {
    super(code, `${MESSAGES[code]}${paths.length ? ` ${oneLine(paths.slice(0, 20).join(', '))}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}.` : ''}`);
    this.name = 'NotesRefusal';
  }
}

export function refuse(code: NotesCode, paths: readonly string[] = []): never { throw new NotesRefusal(code, paths); }
export const isNotesRefusal = (e: unknown, code?: NotesCode): e is NotesRefusal => e instanceof NotesRefusal && (code === undefined || e.code === code);
