/**
 * The names of the store's own actions are code, not screen words, so they live here, away from the screens. The screens call these builders and never
 * write an action name themselves.
 */
import type { StoreAction } from '../../shared/world/store.js';
import type { Bundle } from '../../shared/world/types.js';

/** Writes the draft down as a save point. `madeAt` is the time in words, read from the screen's own clock when the person pressed Save ("Today, 8:42 AM"); the store never reads a clock. */
export const saveAction = (label: string, madeAt?: string): StoreAction => (madeAt === undefined ? { type: 'apply', label } : { type: 'apply', label, madeAt });

/** Takes one skill, tool or note off one agent. The change waits in the draft until the person saves. */
export function removeAction(agentId: string, kind: 'skill' | 'tool' | 'note', itemId: string): StoreAction {
  if (kind === 'skill') return { type: 'detachSkill', agentId, skillId: itemId };
  if (kind === 'tool') return { type: 'detachTool', agentId, toolId: itemId };
  return { type: 'assignSlice', agentId, sliceId: null };
}

/** Puts the saved world back in place of the draft. */
export const discardAction = (): StoreAction => ({ type: 'discard' });

/** Makes a new save point equal to an older one. Nothing is deleted: the save point it undoes stays in the history. `madeAt` is the time in words, as for a save. */
export const goBackAction = (versionId: string, madeAt?: string): StoreAction => (madeAt === undefined ? { type: 'restore', versionId } : { type: 'restore', versionId, madeAt });

/**
 * Adds what a shared file holds (the skills, agents, tools and notes of a bundle that was read and shown first) to the draft. It is one change that waits
 * for Save. A file that adds nothing leaves the draft as it was, and the store answers with the very same state.
 */
export const importFileAction = (bundle: Bundle): StoreAction => ({ type: 'importBundle', bundle });
