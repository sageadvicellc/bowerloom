/**
 * Library Add (issue 148, variant C): the rules of the small Add form in each Library tab. Pure: no screen, no engine call, no file.
 *  - Skills: copy a skill from another folder's harness into a folder's harness (`add-skill`).
 *  - Agents: the Notes keeper, the ready-made kit (`add-from-kit`), and nothing else.
 *  - Context: attach a notes folder the person chose or started (`set-source`).
 *  - Tools: Add is off, with a reason. Nothing edits the connections or the hooks yet.
 * Every edit is ids only, as `SaveEdit` says: never a path, never file text. The write is the save step's own: a plan, its file list, one tick, main's own question, then the write.
 */
import type { DefinitionView, FolderInfo, NotesView, SaveEdit } from '../engine/types.js';
import { KEEPER_AGENT, KEEPER_KIT } from './save-draft.js';
import { HARNESS_UNREADABLE } from './overview.js';
import type { HarnessState, PartKind } from './types.js';

/** Why Add is off for tools. */
export const TOOLS_NOT_YET = 'Not yet: tools cannot be added from the app.';

/** Whether Add works in a tab, and, when it does not, the plain reason. */
export const addState = (kind: PartKind): { readonly enabled: boolean; readonly reason: string | null } =>
  (kind === 'tool' ? { enabled: false, reason: TOOLS_NOT_YET } : { enabled: true, reason: null });

/** Why a folder cannot take a part, in a short line, or null when it can. A folder needs a harness that loads and no change that stopped part way. */
export function whyNot(folder: FolderInfo): string | null {
  if (!folder.hasDefinition) return 'No harness here yet.';
  if (folder.problem !== null) return folder.problem;
  if (folder.unfinished.adoption) return 'A change stopped part way here.';
  return null;
}

/** The folders that can take a part, and each folder left out with the reason. The engine refuses any other folder (SAVE_NO_DEFINITION), so none is offered. */
export function targetsFor(folders: readonly FolderInfo[]): { usable: FolderInfo[]; left: { folder: FolderInfo; why: string }[] } {
  const usable: FolderInfo[] = [], left: { folder: FolderInfo; why: string }[] = [];
  for (const folder of folders) {
    const why = whyNot(folder);
    if (why === null) usable.push(folder); else left.push({ folder, why });
  }
  return { usable, left };
}

/** The folders a skill can be copied from: another folder whose harness loads. */
export const copySources = (folders: readonly FolderInfo[], targetId: string): FolderInfo[] =>
  folders.filter(f => f.id !== targetId && f.hasDefinition && f.problem === null);

export const skillEdits = (skillId: string, fromFolderId: string): SaveEdit[] => [{ kind: 'add-skill', id: skillId, from: fromFolderId }];
export const KEEPER_EDITS: readonly SaveEdit[] = Object.freeze([{ kind: 'add-from-kit', kit: KEEPER_KIT } as const]);
export const notesEdits = (view: NotesView): SaveEdit[] => [{ kind: 'set-source', name: view.suggestedName, notesId: view.id }];

/** True when the harness holds the skill already. */
export const skillHeld = (harness: DefinitionView, skillId: string): boolean => harness.skills.some(s => s.id === skillId);
/** True when the harness holds the Notes keeper already. */
export const keeperHeld = (harness: DefinitionView): boolean => harness.agents.some(a => a.id === KEEPER_AGENT);

// ---- the notes the person chose in the form

/** How a finished notes step can end (renderer/harness/notes/NotesStep.tsx), and which endings leave notes that can be attached. */
const ATTACHABLE: readonly string[] = ['ready', 'parent', 'created', 'report-only', 'git-missing'];
/** True when notes that ended the step this way can be attached. A history that is refused, unreadable or without a first commit cannot. */
export const canAttach = (how: string): boolean => ATTACHABLE.includes(how);

/**
 * The notes folder the form would attach, and the number of the notes step it came from. A step that is left (Back, a restart) takes a new number, so a late answer of
 * the old step is ignored and an earlier folder never stays.
 */
export interface NotesChoice { readonly gen: number; readonly view: NotesView | null }
export const NOTES_START: NotesChoice = Object.freeze({ gen: 0, view: null });
/** The step ended with notes. Only the current step counts, and only an ending that can be attached keeps the folder. */
export const notesDone = (choice: NotesChoice, gen: number, view: NotesView, how: string): NotesChoice =>
  (gen !== choice.gen ? choice : { gen: choice.gen, view: canAttach(how) ? view : null });
/** The step starts again, or the person went back: nothing is chosen, and the old step's answers no longer count. */
export const notesRestart = (choice: NotesChoice): NotesChoice => ({ gen: choice.gen + 1, view: null });
/** True when the form has notes it can attach. */
export const NOTES_READY = (choice: NotesChoice): boolean => choice.view !== null;

/** The folders whose harness the reader could not read, each with the reason. They add no part to the Library, so the Library names them instead of saying nothing. */
export const unreadableHarnesses = (state: HarnessState): { name: string; label: string; why: string }[] =>
  (state.harnessPlaces ?? []).filter(h => !h.readable).map(h => ({ name: h.name.replace(/ \(Bowerloom\)$/, ''), label: h.label, why: HARNESS_UNREADABLE }));

// ---- what the folder step and the skill list say

/**
 * Two lines of the folder step. "No folder has a harness yet" is true only when the list was read and holds no folder that can take a part: a list that could not be read
 * says nothing of the kind, and offers Try again. A refusal of a later read does not undo a list that was read.
 */
export function folderStepLines(a: { listed: boolean; refused: boolean; usable: number; busy: boolean; bridge: boolean }): { noTargets: boolean; tryAgain: boolean } {
  return { noTargets: a.bridge && a.listed && a.usable === 0 && !a.busy, tryAgain: a.bridge && !a.listed && a.refused && !a.busy };
}
/** The "Which skill?" heading shows when the skills of the folder were read, even if there are none to show. */
export const showSkillsHeading = (skills: readonly unknown[] | null): boolean => skills !== null;
