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
export interface NotesChoice { readonly gen: number; readonly view: NotesView | null; /** How the notes step ended for `view`. */ readonly how?: string }
export const NOTES_START: NotesChoice = Object.freeze({ gen: 0, view: null });
/** The step ended with notes. Only the current step counts, and only an ending that can be attached keeps the folder. */
export const notesDone = (choice: NotesChoice, gen: number, view: NotesView, how: string): NotesChoice =>
  (gen !== choice.gen ? choice : canAttach(how) ? { gen: choice.gen, view, how } : { gen: choice.gen, view: null });
/** The step starts again, or the person went back: nothing is chosen, and the old step's answers no longer count. */
export const notesRestart = (choice: NotesChoice): NotesChoice => ({ gen: choice.gen + 1, view: null });
/** True when the form has notes it can attach. */
export const NOTES_READY = (choice: NotesChoice): boolean => choice.view !== null;

/** The folders whose harness the reader could not read, each with the reason. They add no part to the Library, so the Library names them instead of saying nothing. */
export const unreadableHarnesses = (state: HarnessState): { name: string; label: string; why: string }[] =>
  (state.harnessPlaces ?? []).filter(h => !h.readable).map(h => ({ name: h.name.replace(/ \(Bowerloom\)$/, ''), label: h.label, why: HARNESS_UNREADABLE }));

// ---- what the folder step and the skill list say

/** Whether the list of folders was read: not yet, read, or the read failed. A failed read stays failed until a read works. */
export type ListState = 'unread' | 'read' | 'failed';
/** The list state after an event: a read that worked or failed, a pick that returned the whole list, or a chooser that closed (which changes nothing). */
export const listAfter = (state: ListState, event: 'ok' | 'failed' | 'picked' | 'cancelled'): ListState =>
  (event === 'cancelled' ? state : event === 'failed' ? 'failed' : 'read');
/**
 * Two lines of the folder step. "No folder has a harness yet" is true only when the list was read and holds no folder that can take a part. A list that could not be read says
 * nothing of the kind: it says the read failed and offers Try again, for as long as it stays failed.
 */
export function folderStepLines(a: { list: ListState; usable: number; busy: boolean; bridge: boolean }): { noTargets: boolean; tryAgain: boolean } {
  return { noTargets: a.bridge && a.list === 'read' && a.usable === 0 && !a.busy, tryAgain: a.bridge && a.list === 'failed' && !a.busy };
}

/**
 * The tone of the line that says notes are chosen. Notes with a history are ready. Notes that can be attached but have none (or no git to read it) are chosen all the same,
 * and the keeper then only reports, so the line is neutral and does not say "ready".
 */
export const notesTone = (how: string | undefined): 'good' | 'quiet' => (how === 'report-only' || how === 'git-missing' ? 'quiet' : 'good');

// ---- the empty Context tab and the link flow

/** True when the Library offers "Link a notes folder": the Context tab of the person's own folders, with nothing in it and no search typed. A search that finds nothing is not the empty tab. */
export const showLinkAction = (a: { kind: PartKind; real: boolean; shown: number; query: string }): boolean => a.kind === 'context' && a.real && a.shown === 0 && a.query.trim() === '';

/**
 * What the form can say about the folder that holds the chosen notes. The window holds no folder id or real path for the notes, and a label is not an identity (two folders can share one),
 * so a label match is only a hint: it never picks the folder. The person picks the folder that gets the link from the list.
 *  - `listed`: a listed folder carries the label and its harness loads. It is marked in the list, and not picked.
 *  - `needs-harness`: a listed folder carries the label and holds no harness, or none is listed under it (`folder` null).
 *  - `blocked`: a listed folder carries the label and cannot take a change, or several carry it.
 */
export type LinkTarget =
  | { readonly kind: 'listed'; readonly folder: FolderInfo }
  | { readonly kind: 'needs-harness'; readonly folder: FolderInfo | null }
  | { readonly kind: 'blocked'; readonly folder: FolderInfo; readonly why: string };
/** The words when two folders carry the label of the notes: the person picks. */
export const LINK_WHICH_ONE = 'Which one? Several folders share that name.';
export function linkTarget(folders: readonly FolderInfo[], notes: { readonly label: string }): LinkTarget {
  const same = folders.filter(f => f.label === notes.label);
  if (same.length > 1) return { kind: 'blocked', folder: same[0]!, why: LINK_WHICH_ONE };
  const folder = same[0];
  if (folder === undefined) return { kind: 'needs-harness', folder: null };
  if (!folder.hasDefinition) return { kind: 'needs-harness', folder };
  const why = whyNot(folder);
  return why === null ? { kind: 'listed', folder } : { kind: 'blocked', folder, why };
}

/** The linked notes folders the reader could not read, one row each, with the folder that links them. They show in the Context tab, so a link that does not work is never silent. */
export interface LinkProblemRow { readonly place: string; readonly folder: string; readonly reason: 'gone' | 'form' | 'approval' | 'damaged' | 'unreadable' | 'limit'; readonly label: string }
export const linkProblems = (state: HarnessState): LinkProblemRow[] =>
  (state.harnessPlaces ?? []).flatMap(h => (h.linkProblems ?? []).map(p => ({ place: h.id, folder: h.label, reason: p.reason, label: p.label })));

/** What the empty Context tab shows: nothing special, the action to link a first folder, or the problem of a link that does not work (shown before any action). */
export const contextEmpty = (a: { kind: PartKind; real: boolean; shown: number; query: string; problems: number }): 'none' | 'link' | 'problem' =>
  (!showLinkAction(a) ? 'none' : a.problems > 0 ? 'problem' : 'link');
