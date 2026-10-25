/**
 * The names of the store's own actions are code, not screen words, so they live here, away from the screens. The screens call these builders and never
 * write an action name themselves.
 */
import type { StoreAction } from '../../shared/proto/store.js';

/** Writes the draft down as a save point. */
export const saveAction = (label: string): StoreAction => ({ type: 'apply', label });

/** Takes one skill, tool or note off one agent. The change waits in the draft until the person saves. */
export function removeAction(agentId: string, kind: 'skill' | 'tool' | 'note', itemId: string): StoreAction {
  if (kind === 'skill') return { type: 'detachSkill', agentId, skillId: itemId };
  if (kind === 'tool') return { type: 'detachTool', agentId, toolId: itemId };
  return { type: 'assignSlice', agentId, sliceId: null };
}

/** Puts the saved world back in place of the draft. */
export const discardAction = (): StoreAction => ({ type: 'discard' });

/** Makes a new save point equal to an older one. Nothing is deleted: the save point it undoes stays in the history. */
export const goBackAction = (versionId: string): StoreAction => ({ type: 'restore', versionId });
